import { Pool } from 'pg';
import { decrypt } from '../utils/crypto';
import { generateDecisions, comboStrategy, StrategyType, AgentDecision } from './agent-strategy';

interface LlmConfig {
  agent_id: string;
  provider: string;
  model: string;
  api_key_encrypted: string;
  base_url: string | null;
  system_prompt: string | null;
  temperature: number;
  max_tokens: number;
  enabled: number;
}

interface EnrichedMarket {
  id: string;
  title: string;
  yes_price: number;
  category: string;
  description: string | null;
  end_time: number;
  volume: number;
  liquidity: number;
  total_lp_shares: number;
  comment_count: number;
}

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/',
};

async function getAgentLlmConfig(db: Pool, agentId: string): Promise<LlmConfig | null> {
  const result = await db.query(
    'SELECT * FROM agent_llm_config WHERE agent_id = $1 AND enabled = 1',
    [agentId]
  );
  return (result.rows[0] as LlmConfig) || null;
}

async function fetchPriceTrends(db: Pool, marketIds: string[]): Promise<Map<string, string>> {
  if (marketIds.length === 0) return new Map();

  const result = await db.query(`
    SELECT market_id, yes_price, timestamp
    FROM price_history
    WHERE market_id = ANY($1)
    ORDER BY market_id, timestamp DESC
  `, [marketIds]);

  const trends = new Map<string, string>();
  const byMarket = new Map<string, number[]>();

  for (const row of result.rows) {
    const arr = byMarket.get(row.market_id) || [];
    arr.push(Number(row.yes_price));
    byMarket.set(row.market_id, arr);
  }

  for (const [mId, prices] of byMarket) {
    const recent5 = prices.slice(0, 5);
    if (recent5.length < 2) { trends.set(mId, 'stable'); continue; }
    const diff = recent5[0] - recent5[recent5.length - 1];
    trends.set(mId, diff > 0.05 ? 'rising' : diff < -0.05 ? 'falling' : 'stable');
  }
  return trends;
}

async function fetchAgentHistory(db: Pool, agentId: string): Promise<string> {
  const trades = await db.query(`
    SELECT market_id, side, amount, outcome, profit, created_at
    FROM agent_trades WHERE agent_id = $1 AND status = 'settled'
    ORDER BY created_at DESC LIMIT 10
  `, [agentId]);

  if (trades.rows.length === 0) return 'No trade history yet.';

  const wins = trades.rows.filter(t => t.outcome === 'win').length;
  const totalProfit = trades.rows.reduce((s, t) => s + Number(t.profit || 0), 0);

  return `Recent ${trades.rows.length} trades: ${wins} wins, ${trades.rows.length - wins} losses, net P&L: $${totalProfit.toFixed(2)}`;
}

async function fetchOwnerProfile(db: Pool, agentId: string): Promise<string> {
  const profile = await db.query(
    'SELECT * FROM agent_owner_profile WHERE agent_id = $1', [agentId]
  );
  if (profile.rows.length === 0) return '';
  const p = profile.rows[0];
  return `Owner profile: yes_ratio=${p.yes_ratio}, risk_score=${p.risk_score}, contrarian=${p.contrarian_score}`;
}

function buildMarketPrompt(
  markets: EnrichedMarket[],
  strategy: string,
  walletBalance: number,
  priceTrends: Map<string, string>,
  agentHistory: string,
  ownerProfile: string,
): string {
  const marketList = markets.slice(0, 15).map((m, i) => {
    const trend = priceTrends.get(m.id) || 'unknown';
    const hoursLeft = Math.max(0, Math.round((m.end_time - Math.floor(Date.now() / 1000)) / 3600));
    return `${i + 1}. [${m.id}] "${m.title}"
   YES: ${m.yes_price.toFixed(2)} | Trend: ${trend} | Volume: $${m.volume || 0} | Liquidity: $${m.liquidity || 0}
   Category: ${m.category} | Ends in: ${hoursLeft}h | Comments: ${m.comment_count || 0}${m.description ? `\n   Desc: ${m.description.slice(0, 100)}` : ''}`;
  }).join('\n');

  let strategyHint = '';
  switch (strategy) {
    case 'conservative': strategyHint = 'Focus on markets with clear trends, bet 3-5% of balance'; break;
    case 'aggressive': strategyHint = 'Look for mispriced markets, bet 10-20% of balance'; break;
    case 'contrarian': strategyHint = 'Bet against consensus when confidence is high'; break;
    case 'momentum': strategyHint = 'Follow strong trends, avoid stale markets'; break;
  }

  return `You are a prediction market trading agent with strategy "${strategy}".
Wallet: $${walletBalance.toFixed(2)}

${agentHistory}
${ownerProfile}

Active markets:
${marketList}

Instructions:
- Analyze price trends, time remaining, and market context
${strategyHint ? `- ${strategyHint}` : ''}
- Use your trade history to avoid repeating mistakes

Select 1-3 markets. Respond ONLY with JSON array:
[{"action":"buy","marketId":"...","side":"yes","amount":50,"confidence":0.7,"reasoning":"..."}]`;
}

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string | null,
  userPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<string> {
  const messages: any[] = [{ role: 'user', content: userPrompt }];
  const body: any = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages,
  };
  if (systemPrompt) body.system = systemPrompt;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((c: any) => c.type === 'text');
  return textBlock?.text || '';
}

async function callOpenAICompatible(
  apiKey: string,
  baseUrl: string,
  model: string,
  systemPrompt: string | null,
  userPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<string> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey, baseURL: baseUrl });

  const messages: any[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  });

  return response.choices[0]?.message?.content || '';
}

function parseLlmResponse(text: string): AgentDecision[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((d: any) =>
        (d.action === 'buy' || d.action === 'sell') &&
        typeof d.marketId === 'string' &&
        (d.side === 'yes' || d.side === 'no') &&
        typeof d.amount === 'number' && d.amount > 0 &&
        typeof d.confidence === 'number'
      )
      .map((d: any) => ({
        action: d.action as 'buy' | 'sell',
        marketId: d.marketId,
        side: d.side as 'yes' | 'no',
        amount: Math.round(d.amount * 100) / 100,
        confidence: Math.max(0, Math.min(1, d.confidence)),
        reasoning: String(d.reasoning || 'LLM decision'),
      }));
  } catch (err) {
    console.warn('LLM response JSON parse failed:', err instanceof Error ? err.message : 'unknown error');
    return [];
  }
}

export async function generateLlmDecisions(
  db: Pool,
  agentId: string,
  strategy: StrategyType,
  walletBalance: number,
  comboWeights?: Record<string, number> | null
): Promise<AgentDecision[]> {
  // Check for LLM config
  const config = await getAgentLlmConfig(db, agentId);
  if (!config) {
    // No LLM config -- fallback to rule-based
    let decisions: AgentDecision[];
    if (comboWeights) {
      try {
        decisions = await comboStrategy(db, comboWeights, walletBalance);
      } catch {
        decisions = await generateDecisions(db, strategy, walletBalance);
      }
    } else {
      decisions = await generateDecisions(db, strategy, walletBalance);
    }
    return decisions;
  }

  try {
    const apiKey = decrypt(config.api_key_encrypted);

    // Fetch active markets with enriched data
    const markets = (await db.query(`
      SELECT m.id, m.title, m.yes_price, m.category, m.description, m.end_time,
             m.volume, m.total_liquidity as liquidity, m.total_lp_shares,
             (SELECT COUNT(*) FROM comments c WHERE c.market_id = m.id) as comment_count
      FROM markets m WHERE m.status = 'active'
    `)).rows as EnrichedMarket[];

    if (markets.length === 0 || walletBalance < 1) return [];

    const marketIds = markets.map(m => m.id);
    const [priceTrends, agentHistory, ownerProfile] = await Promise.all([
      fetchPriceTrends(db, marketIds),
      fetchAgentHistory(db, agentId),
      fetchOwnerProfile(db, agentId),
    ]);

    const userPrompt = buildMarketPrompt(markets, strategy, walletBalance, priceTrends, agentHistory, ownerProfile);

    let responseText: string;

    if (config.provider === 'anthropic') {
      responseText = await callAnthropic(
        apiKey,
        config.model,
        config.system_prompt,
        userPrompt,
        config.temperature,
        config.max_tokens
      );
    } else {
      const baseUrl = config.base_url || PROVIDER_BASE_URLS[config.provider];
      if (!baseUrl) throw new Error(`No base URL for provider: ${config.provider}`);

      responseText = await callOpenAICompatible(
        apiKey,
        baseUrl,
        config.model,
        config.system_prompt,
        userPrompt,
        config.temperature,
        config.max_tokens
      );
    }

    let decisions = parseLlmResponse(responseText);

    // Update stats
    await db.query(
      'UPDATE agent_llm_config SET last_used_at = $1, total_calls = total_calls + 1 WHERE agent_id = $2',
      [Date.now(), agentId]
    );

    if (decisions.length > 0) {
      return decisions;
    }

    // Empty result -- fallback
    console.warn(`LLM returned no valid decisions for agent ${agentId}, falling back to rule-based`);
  } catch (err: any) {
    console.error(`LLM call failed for agent ${agentId}:`, err.message);
    // Update error count
    await db.query(
      'UPDATE agent_llm_config SET total_errors = total_errors + 1 WHERE agent_id = $1',
      [agentId]
    ).catch(() => {});
  }

  // Fallback to rule-based
  let fallbackDecisions: AgentDecision[];
  if (comboWeights) {
    try {
      fallbackDecisions = await comboStrategy(db, comboWeights, walletBalance);
    } catch {
      fallbackDecisions = await generateDecisions(db, strategy, walletBalance);
    }
  } else {
    fallbackDecisions = await generateDecisions(db, strategy, walletBalance);
  }
  return fallbackDecisions;
}

export async function generateLlmSuggestion(
  db: Pool,
  agentId: string,
  marketId: string,
  strategy: string,
  walletBalance: number
): Promise<{ side: 'yes' | 'no'; confidence: number; reasoning: string } | null> {
  const config = await getAgentLlmConfig(db, agentId);
  if (!config) return null;

  try {
    const apiKey = decrypt(config.api_key_encrypted);

    const market = (await db.query(
      'SELECT id, title, yes_price, category, description FROM markets WHERE id = $1',
      [marketId]
    )).rows[0] as any;
    if (!market) return null;

    const prompt = `You are a prediction market advisor with strategy "${strategy}".
Market: "${market.title}"
${market.description ? `Description: ${market.description}` : ''}
Current YES price: ${market.yes_price.toFixed(2)}, NO price: ${(1 - market.yes_price).toFixed(2)}
Category: ${market.category}
Agent wallet balance: $${walletBalance.toFixed(2)}

Provide your trading advice for this specific market.
Respond ONLY with JSON:
{"side":"yes","confidence":0.7,"reasoning":"brief explanation"}`;

    let responseText: string;
    if (config.provider === 'anthropic') {
      responseText = await callAnthropic(apiKey, config.model, config.system_prompt, prompt, config.temperature, config.max_tokens);
    } else {
      const baseUrl = config.base_url || PROVIDER_BASE_URLS[config.provider];
      if (!baseUrl) return null;
      responseText = await callOpenAICompatible(apiKey, baseUrl, config.model, config.system_prompt, prompt, config.temperature, config.max_tokens);
    }

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if ((parsed.side === 'yes' || parsed.side === 'no') && typeof parsed.confidence === 'number') {
        await db.query(
          'UPDATE agent_llm_config SET last_used_at = $1, total_calls = total_calls + 1 WHERE agent_id = $2',
          [Date.now(), agentId]
        );
        return {
          side: parsed.side,
          confidence: Math.max(0, Math.min(1, parsed.confidence)),
          reasoning: String(parsed.reasoning || 'LLM suggestion'),
        };
      }
    } catch (err) {
      console.warn('LLM suggestion JSON parse failed:', err instanceof Error ? err.message : 'unknown error');
    }
    return null;
  } catch (err: any) {
    console.error(`LLM suggestion failed for agent ${agentId}:`, err.message);
    await db.query(
      'UPDATE agent_llm_config SET total_errors = total_errors + 1 WHERE agent_id = $1',
      [agentId]
    ).catch(() => {});
    return null;
  }
}
