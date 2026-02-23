import { Pool } from 'pg';
import { generateLlmSuggestion } from './agent-llm-adapter';

function generateId(): string {
  return 'sug-' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

export interface TradeSuggestion {
  id: string;
  agentId: string;
  marketId: string;
  suggestedSide: 'yes' | 'no';
  confidence: number;
  reasoning: string;
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  potentialProfit: number;
  potentialLoss: number;
  suggestedAmount: number;
  onChainMarketId: number | null;
}

export interface RiskAssessment {
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  riskScore: number; // 0-100
  warnings: string[];
  maxLoss: number;
  potentialProfit: number;
  riskRewardRatio: number;
}

/**
 * Generate a trade suggestion for an agent on a specific market
 */
export async function generateSuggestion(db: Pool, agentId: string, marketId: string): Promise<TradeSuggestion> {
  // Get agent info
  const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [agentId])).rows[0] as any;
  if (!agent) throw new Error('Agent not found');

  // Get market info (include on_chain_market_id for frontend execution)
  const market = (await db.query('SELECT *, on_chain_market_id FROM markets WHERE id = $1', [marketId])).rows[0] as any;
  if (!market) throw new Error('Market not found');
  if (market.status !== 'active') throw new Error('Market is not active');

  const onChainMarketId: number | null = market.on_chain_market_id != null ? Number(market.on_chain_market_id) : null;

  // Get agent's style profile
  const profile = (await db.query('SELECT * FROM agent_style_profile WHERE agent_id = $1', [agentId])).rows[0] as any;

  // Simple suggestion logic based on strategy + market price + profile
  const strategy = agent.strategy || 'conservative';
  let suggestedSide: 'yes' | 'no';
  let confidence: number;
  let reasoning: string;

  const yesPrice = market.yes_price || 0.5;

  // Try LLM-enhanced suggestion first
  const llmResult = await generateLlmSuggestion(db, agentId, marketId, strategy, agent.wallet_balance || 1000);
  if (llmResult) {
    suggestedSide = llmResult.side;
    confidence = llmResult.confidence;
    reasoning = llmResult.reasoning;
  } else {
  // Fallback to rule-based
  switch (strategy) {
    case 'conservative':
      suggestedSide = yesPrice >= 0.5 ? 'yes' : 'no';
      confidence = 0.55 + Math.random() * 0.15;
      reasoning = `稳健策略: 价格 ${yesPrice.toFixed(2)} ${yesPrice >= 0.5 ? '偏向 YES' : '偏向 NO'}，建议跟随多数`;
      break;
    case 'aggressive':
      suggestedSide = yesPrice > 0.7 ? 'yes' : yesPrice < 0.3 ? 'no' : (Math.random() > 0.5 ? 'yes' : 'no');
      confidence = 0.65 + Math.random() * 0.25;
      reasoning = `激进策略: 价格 ${yesPrice.toFixed(2)}，极端价格机会，高信心下注`;
      break;
    case 'contrarian':
      suggestedSide = yesPrice >= 0.5 ? 'no' : 'yes';
      confidence = 0.50 + Math.random() * 0.20;
      reasoning = `逆势策略: 价格 ${yesPrice.toFixed(2)}，逆大众预期操作`;
      break;
    case 'momentum':
      suggestedSide = yesPrice >= 0.5 ? 'yes' : 'no';
      confidence = 0.55 + Math.random() * 0.20;
      reasoning = `趋势策略: 价格 ${yesPrice.toFixed(2)}，顺势而为`;
      break;
    default:
      suggestedSide = Math.random() > 0.5 ? 'yes' : 'no';
      confidence = Math.random();
      reasoning = `随机策略: 抛硬币决定 ${suggestedSide}`;
  }
  } // end fallback

  // Calculate risk
  const potentialLoss = agent.wallet_balance * 0.1; // max 10% of balance
  const potentialProfit = potentialLoss * (1 / (suggestedSide === 'yes' ? yesPrice : 1 - yesPrice) - 1);
  const riskLevel = calculateRiskLevel(confidence, potentialLoss, agent.wallet_balance);

  const id = generateId();
  const now = Date.now();

  await db.query(`
    INSERT INTO agent_trade_suggestions (id, agent_id, market_id, suggested_side, confidence, reasoning, risk_level, potential_profit, potential_loss, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [id, agentId, marketId, suggestedSide, confidence, reasoning, riskLevel, Math.round(potentialProfit * 100) / 100, Math.round(potentialLoss * 100) / 100, now]);

  const suggestedAmount = Math.round(potentialLoss * 100) / 100;

  return {
    id,
    agentId,
    marketId,
    suggestedSide,
    confidence,
    reasoning,
    riskLevel,
    potentialProfit: Math.round(potentialProfit * 100) / 100,
    potentialLoss: Math.round(potentialLoss * 100) / 100,
    suggestedAmount,
    onChainMarketId,
  };
}

/**
 * Calculate risk assessment for a potential trade
 */
export async function calculateRisk(
  db: Pool,
  marketId: string,
  side: string,
  amount: number,
  userBalance: number
): Promise<RiskAssessment> {
  const market = (await db.query('SELECT * FROM markets WHERE id = $1', [marketId])).rows[0] as any;
  if (!market) throw new Error('Market not found');

  const price = side === 'yes' ? market.yes_price : market.no_price;
  const maxLoss = amount;
  const potentialProfit = amount * (1 / price - 1);
  const riskRewardRatio = potentialProfit / maxLoss;

  const warnings: string[] = [];
  let riskScore = 0;

  // Balance percentage risk
  const balancePct = amount / Math.max(userBalance, 1);
  if (balancePct > 0.5) {
    warnings.push(`交易金额占余额 ${(balancePct * 100).toFixed(0)}%，风险极高`);
    riskScore += 40;
  } else if (balancePct > 0.2) {
    warnings.push(`交易金额占余额 ${(balancePct * 100).toFixed(0)}%`);
    riskScore += 20;
  }

  // Price extreme risk
  if (price < 0.1 || price > 0.9) {
    warnings.push('价格处于极端区间，概率可能被高估/低估');
    riskScore += 20;
  }

  // Time risk
  const timeLeft = market.end_time - Date.now();
  if (timeLeft < 3600000) { // less than 1 hour
    warnings.push('市场即将结束，注意流动性风险');
    riskScore += 15;
  }

  // Volume risk
  if (market.volume < 10000) {
    warnings.push('市场交易量较低，注意流动性');
    riskScore += 10;
  }

  // Risk reward ratio
  if (riskRewardRatio < 0.5) {
    warnings.push('风险回报比低于 0.5');
    riskScore += 15;
  }

  const riskLevel: 'low' | 'medium' | 'high' | 'extreme' =
    riskScore >= 60 ? 'extreme' :
    riskScore >= 40 ? 'high' :
    riskScore >= 20 ? 'medium' : 'low';

  return {
    riskLevel,
    riskScore: Math.min(100, riskScore),
    warnings,
    maxLoss,
    potentialProfit: Math.round(potentialProfit * 100) / 100,
    riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
  };
}

function calculateRiskLevel(confidence: number, potentialLoss: number, balance: number): 'low' | 'medium' | 'high' | 'extreme' {
  const lossPct = potentialLoss / Math.max(balance, 1);
  if (lossPct > 0.3 || confidence < 0.4) return 'extreme';
  if (lossPct > 0.15 || confidence < 0.5) return 'high';
  if (lossPct > 0.05 || confidence < 0.6) return 'medium';
  return 'low';
}
