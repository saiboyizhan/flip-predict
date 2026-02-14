import { Request, Response } from 'express';
import {
  SwarmAnalyzeRequest,
  AgentAnalysisResult,
  DiscussionMessage,
  AGENT_TEAMS,
} from './swarm-types';
import {
  AGENT_SYSTEM_PROMPTS,
  buildAnalysisUserPrompt,
  buildDiscussionPrompt,
  buildRevisionPrompt,
} from './swarm-prompts';
import { getDb } from '../db';

const BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

function getApiKey(): string {
  return process.env.ZHIPU_API_KEY || '';
}

function getModel(): string {
  return process.env.ZHIPU_MODEL || 'glm-4-flash';
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function parseJSON<T>(text: string): T | null {
  // Try direct parse first
  try {
    return JSON.parse(text) as T;
  } catch {
    // Regex extract: find first { ... } or [ ... ]
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]) as T; } catch { /* fall through */ }
    }
    const arrMatch = text.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try { return JSON.parse(arrMatch[0]) as T; } catch { /* fall through */ }
    }
    return null;
  }
}

async function fetchDynamicWeights(agents: string[]): Promise<{ weights: number[]; isDynamic: boolean }> {
  try {
    const db = getDb();
    const res = await db.query(
      'SELECT agent_id, total_analyses, accuracy FROM swarm_agent_stats WHERE agent_id = ANY($1)',
      [agents]
    );
    const statsMap = new Map<string, { total: number; accuracy: number }>();
    for (const row of res.rows) {
      statsMap.set(row.agent_id, {
        total: Number(row.total_analyses),
        accuracy: Number(row.accuracy),
      });
    }

    // Need all agents to have >= 5 analyses for dynamic weights
    const allQualified = agents.every(id => {
      const s = statsMap.get(id);
      return s && s.total >= 5;
    });

    if (!allQualified) {
      return { weights: agents.map(() => 25), isDynamic: false };
    }

    const rawWeights = agents.map(id => {
      const s = statsMap.get(id)!;
      return s.accuracy * Math.log(s.total + 1);
    });
    const totalRaw = rawWeights.reduce((a, b) => a + b, 0);
    if (totalRaw === 0) {
      return { weights: agents.map(() => 25), isDynamic: false };
    }

    const normalized = rawWeights.map(w => Math.round((w / totalRaw) * 100));
    // Fix rounding to sum to 100
    const diff = 100 - normalized.reduce((a, b) => a + b, 0);
    if (diff !== 0) normalized[0] += diff;

    return { weights: normalized, isDynamic: true };
  } catch (err) {
    console.error('[Swarm] Failed to fetch dynamic weights:', err);
    return { weights: agents.map(() => 25), isDynamic: false };
  }
}

async function fetchCoinGeckoPrice(tokenName: string): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const id = tokenName.toLowerCase().replace(/\s+/g, '-');
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json() as Record<string, { usd?: number }>;
    return data[id]?.usd ?? null;
  } catch {
    return null;
  }
}

async function callGLM(
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: getModel(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 512,
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }

  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content || '';
}

export async function runSwarmAnalysis(req: Request, res: Response): Promise<void> {
  const { tokenName, tokenAddress, chain, category } = req.body as SwarmAnalyzeRequest;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  function sendSSE(event: string, data: object): void {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    // ── Phase 0: Create team + dynamic weights ──
    sendSSE('phase', { phase: 'creating_team' });

    const teamKey = category && AGENT_TEAMS[category] ? category : 'default';
    const agents = AGENT_TEAMS[teamKey];
    const { weights, isDynamic } = await fetchDynamicWeights(agents);

    for (let i = 0; i < agents.length; i++) {
      if (i > 0) await delay(300);
      sendSSE('agent_join', { agentId: agents[i], weight: weights[i] });
      sendSSE('agent_status', { agentId: agents[i], status: 'joining' });
    }

    // ── Phase 1: Independent analysis ──
    sendSSE('phase', { phase: 'phase1' });

    const userPrompt = buildAnalysisUserPrompt(tokenName, tokenAddress, chain);
    const phase1Results: Record<string, AgentAnalysisResult> = {};

    // Mark all agents as analyzing
    for (const agentId of agents) {
      sendSSE('agent_status', { agentId, status: 'analyzing' });
    }

    const phase1Promises = agents.map(async (agentId) => {
      try {
        const systemPrompt = AGENT_SYSTEM_PROMPTS[agentId];
        if (!systemPrompt) throw new Error(`No prompt for agent: ${agentId}`);

        const raw = await callGLM(systemPrompt, userPrompt, abortController.signal);
        const parsed = parseJSON<AgentAnalysisResult>(raw);

        if (!parsed || typeof parsed.score !== 'number') {
          throw new Error(`Invalid response from ${agentId}`);
        }

        const result: AgentAnalysisResult = {
          score: Math.max(0, Math.min(100, Math.round(parsed.score))),
          findings: parsed.findings || 'No findings available.',
        };

        phase1Results[agentId] = result;

        sendSSE('typing', { agentId });
        sendSSE('message', {
          fromAgentId: agentId,
          toAgentId: 'all',
          content: result.findings,
          type: 'finding',
          phase: 1,
        });
        sendSSE('score', { agentId, field: 'initialScore', score: result.score });
        sendSSE('agent_status', { agentId, status: 'phase1_complete' });
      } catch (err) {
        const fallback: AgentAnalysisResult = { score: 50, findings: 'Analysis unavailable due to service error.' };
        phase1Results[agentId] = fallback;

        sendSSE('error', { message: `Agent ${agentId} failed: ${(err as Error).message}`, agentId });
        sendSSE('score', { agentId, field: 'initialScore', score: 50 });
        sendSSE('agent_status', { agentId, status: 'phase1_complete' });
      }
    });

    await Promise.allSettled(phase1Promises);

    if (abortController.signal.aborted) return;

    // ── Phase 2: Discussion ──
    sendSSE('phase', { phase: 'phase2' });

    for (const agentId of agents) {
      sendSSE('agent_status', { agentId, status: 'communicating' });
    }

    let discussionMessages: DiscussionMessage[] = [];
    try {
      const discussionPrompt = buildDiscussionPrompt(tokenName, phase1Results);
      const raw = await callGLM(
        'You are a swarm discussion moderator. Generate realistic inter-agent discussions.',
        discussionPrompt,
        abortController.signal,
      );
      const parsed = parseJSON<DiscussionMessage[]>(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        discussionMessages = parsed;
      }
    } catch (err) {
      sendSSE('error', { message: `Discussion generation failed: ${(err as Error).message}` });
    }

    // Fallback: generate minimal discussion if parse failed
    if (discussionMessages.length === 0) {
      discussionMessages = [
        { from: agents[0], to: 'all', content: `My ${agents[0]} analysis scored ${phase1Results[agents[0]]?.score ?? 50}. Key concern noted.`, type: 'finding' },
        { from: agents[1], to: agents[0], content: `Interesting. My ${agents[1]} perspective suggests caution as well.`, type: 'response' },
        { from: agents[2], to: 'all', content: `From a ${agents[2]} angle, the data supports moderate confidence.`, type: 'finding' },
        { from: agents[3], to: 'all', content: `Agreed. Let me reconsider my score in light of this discussion.`, type: 'response' },
      ];
    }

    for (let i = 0; i < discussionMessages.length; i++) {
      if (abortController.signal.aborted) return;
      if (i > 0) await delay(500);
      const msg = discussionMessages[i];
      sendSSE('typing', { agentId: msg.from });
      sendSSE('message', {
        fromAgentId: msg.from,
        toAgentId: msg.to,
        content: msg.content,
        type: msg.type,
        phase: 2,
      });
    }

    if (abortController.signal.aborted) return;

    // ── Phase 3: Revision ──
    sendSSE('phase', { phase: 'phase3' });

    const discussionText = discussionMessages
      .map(m => `[${m.from} → ${m.to}]: ${m.content}`)
      .join('\n');

    const revisedScores: Record<string, number> = {};

    for (const agentId of agents) {
      sendSSE('agent_status', { agentId, status: 'revising' });
    }

    const phase3Promises = agents.map(async (agentId) => {
      try {
        const original = phase1Results[agentId];
        const revisionPrompt = buildRevisionPrompt(
          agentId,
          original.score,
          original.findings,
          discussionText,
        );

        const raw = await callGLM(
          AGENT_SYSTEM_PROMPTS[agentId],
          revisionPrompt,
          abortController.signal,
        );

        const parsed = parseJSON<{ revisedScore: number; revision: string }>(raw);

        let revisedScore = original.score;
        let revision = 'No revision.';

        if (parsed && typeof parsed.revisedScore === 'number') {
          revisedScore = Math.max(0, Math.min(100, Math.round(parsed.revisedScore)));
          revision = parsed.revision || 'Score maintained.';
        }

        revisedScores[agentId] = revisedScore;

        sendSSE('typing', { agentId });
        sendSSE('message', {
          fromAgentId: agentId,
          toAgentId: 'all',
          content: revision,
          type: 'revision',
          phase: 3,
        });
        sendSSE('score', { agentId, field: 'revisedScore', score: revisedScore });
        sendSSE('agent_status', { agentId, status: 'complete' });
      } catch (err) {
        const fallbackScore = phase1Results[agentId]?.score ?? 50;
        revisedScores[agentId] = fallbackScore;

        sendSSE('error', { message: `Agent ${agentId} revision failed: ${(err as Error).message}`, agentId });
        sendSSE('score', { agentId, field: 'revisedScore', score: fallbackScore });
        sendSSE('agent_status', { agentId, status: 'complete' });
      }
    });

    await Promise.allSettled(phase3Promises);

    if (abortController.signal.aborted) return;

    // ── Phase 4: Consensus + DB persistence ──
    sendSSE('phase', { phase: 'phase4' });

    const initialScoresArr = agents.map(a => phase1Results[a]?.score ?? 50);
    const finalScoresArr = agents.map(a => revisedScores[a] ?? 50);
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    const initialScore = Math.round(
      initialScoresArr.reduce((sum, s, i) => sum + s * weights[i], 0) / totalWeight,
    );
    const finalScore = Math.round(
      finalScoresArr.reduce((sum, s, i) => sum + s * weights[i], 0) / totalWeight,
    );

    const direction = finalScore > 50 ? 'BULLISH' : finalScore < 50 ? 'BEARISH' : 'NEUTRAL';
    const shift = finalScore - initialScore;
    const shiftText = shift > 0 ? `+${shift}` : `${shift}`;

    sendSSE('message', {
      fromAgentId: 'leader',
      toAgentId: 'all',
      content: `Consensus reached: ${finalScore}/100 (${direction}). Initial ${initialScore} → Final ${finalScore} (${shiftText}). ${tokenName.toUpperCase()} outlook: ${direction.toLowerCase()}.`,
      type: 'consensus',
      phase: 4,
    });

    sendSSE('consensus', { initialScore, finalScore, isDynamic, weights });
    sendSSE('phase', { phase: 'complete' });

    // ── Persist to DB (non-blocking, non-fatal) ──
    try {
      const db = getDb();
      const priceAtAnalysis = await fetchCoinGeckoPrice(tokenName);

      const initialScoresJson: Record<string, number> = {};
      const revisedScoresJson: Record<string, number> = {};
      agents.forEach(a => {
        initialScoresJson[a] = phase1Results[a]?.score ?? 50;
        revisedScoresJson[a] = revisedScores[a] ?? 50;
      });

      const analysisRes = await db.query(
        `INSERT INTO swarm_analyses
          (token_name, token_address, chain, category, team_agents, team_weights,
           initial_scores, revised_scores, discussion_messages,
           initial_consensus, final_consensus, price_at_analysis)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          tokenName, tokenAddress || null, chain || null, category || null,
          agents, weights,
          JSON.stringify(initialScoresJson), JSON.stringify(revisedScoresJson),
          JSON.stringify(discussionMessages),
          initialScore, finalScore, priceAtAnalysis,
        ]
      );

      const analysisId = analysisRes.rows[0].id;

      for (const agentId of agents) {
        await db.query(
          `INSERT INTO swarm_agent_scores (analysis_id, agent_id, initial_score, revised_score, findings)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            analysisId, agentId,
            phase1Results[agentId]?.score ?? 50,
            revisedScores[agentId] ?? 50,
            phase1Results[agentId]?.findings || null,
          ]
        );
      }
    } catch (dbErr) {
      console.error('[Swarm] DB persistence failed (non-fatal):', dbErr);
    }
  } catch (err) {
    if (!abortController.signal.aborted) {
      sendSSE('error', { message: `Swarm analysis failed: ${(err as Error).message}` });
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}
