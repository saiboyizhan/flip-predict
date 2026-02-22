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

function buildMarketPrompt(
  markets: { id: string; title: string; yes_price: number; category: string }[],
  strategy: string,
  walletBalance: number
): string {
  const marketList = markets
    .slice(0, 20)
    .map((m, i) => `${i + 1}. [${m.id}] "${m.title}" (YES: ${m.yes_price.toFixed(2)}, NO: ${(1 - m.yes_price).toFixed(2)}, Category: ${m.category})`)
    .join('\n');

  return `You are a prediction market trading agent with strategy "${strategy}".
Your wallet balance is $${walletBalance.toFixed(2)}.

Active markets:
${marketList}

Based on your strategy, select 1-3 markets to trade. For each trade, specify:
- action: "buy" to open a position, or "sell" to close an existing position (take profit / stop loss)
- marketId: the market ID in brackets
- side: "yes" or "no"
- amount: dollar amount (reasonable % of balance based on strategy)
- confidence: 0-1
- reasoning: brief explanation

Respond ONLY with a JSON array:
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
  // Use dynamic import for openai SDK
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
  // Try to extract JSON array from response
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

    // Fetch active markets
    const markets = (await db.query(
      "SELECT id, title, yes_price, category FROM markets WHERE status = 'active'"
    )).rows as { id: string; title: string; yes_price: number; category: string }[];

    if (markets.length === 0 || walletBalance < 1) return [];

    const userPrompt = buildMarketPrompt(markets, strategy, walletBalance);

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
