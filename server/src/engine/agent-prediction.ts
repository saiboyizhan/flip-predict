import { Pool } from 'pg';
import { getOwnerInfluence } from './agent-owner-learning';

function generateId(): string {
  return 'pred-' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

export interface PredictionInput {
  agentId: string;
  marketId: string;
  prediction: 'yes' | 'no';
  confidence: number;
  reasoning?: string;
}

export interface PredictionResult {
  id: string;
  agentId: string;
  marketId: string;
  prediction: string;
  confidence: number;
  reasoning: string | null;
  category: string | null;
  createdAt: number;
}

export interface PredictionStyleReport {
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;
  categoryBreakdown: Record<string, { total: number; correct: number; accuracy: number }>;
  riskPreference: number;       // 0-1, 0=conservative, 1=aggressive
  confidenceCalibration: number; // positive=overconfident, negative=underconfident
  contrarianTendency: number;    // 0-1
  currentStreak: number;
  bestStreak: number;
  reputationScore: number;
  styleTags: string[];
  ownerInfluenceActive?: boolean;
  ownerTradeCount?: number;
  ownerWinRate?: number;
}

/**
 * Record a prediction for an agent
 */
export async function recordPrediction(db: Pool, input: PredictionInput): Promise<PredictionResult> {
  const { agentId, marketId, prediction, confidence, reasoning } = input;

  // Validate
  if (!['yes', 'no'].includes(prediction)) throw new Error('Prediction must be yes or no');
  if (confidence < 0 || confidence > 1) throw new Error('Confidence must be between 0 and 1');

  const id = generateId();
  const now = Date.now();
  let marketCategory: string | null = null;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Serialize writes for the same (agent, market) pair to avoid duplicate predictions
    // under concurrent requests.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [agentId, marketId]);

    const agent = (await client.query('SELECT id FROM agents WHERE id = $1', [agentId])).rows[0];
    if (!agent) throw new Error('Agent not found');

    const market = (await client.query('SELECT id, category, status FROM markets WHERE id = $1', [marketId])).rows[0] as any;
    if (!market) throw new Error('Market not found');
    if (market.status !== 'active') throw new Error('Market is not active');
    marketCategory = market.category || null;

    const existing = (await client.query(
      'SELECT id FROM agent_predictions WHERE agent_id = $1 AND market_id = $2',
      [agentId, marketId]
    )).rows[0];
    if (existing) throw new Error('Agent already has a prediction for this market');

    await client.query(`
      INSERT INTO agent_predictions (id, agent_id, market_id, prediction, confidence, reasoning, category, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [id, agentId, marketId, prediction, confidence, reasoning || null, marketCategory, now]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Update style profile
  await updateStyleProfile(db, agentId);

  return {
    id,
    agentId,
    marketId,
    prediction,
    confidence,
    reasoning: reasoning || null,
    category: marketCategory,
    createdAt: now,
  };
}

/**
 * Resolve predictions when a market is settled
 */
export async function resolvePredictions(db: Pool, marketId: string, outcome: string): Promise<number> {
  const predictions = (await db.query(
    'SELECT id, agent_id, prediction, confidence FROM agent_predictions WHERE market_id = $1 AND actual_outcome IS NULL',
    [marketId]
  )).rows as any[];

  if (predictions.length === 0) return 0;

  const now = Date.now();

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const pred of predictions) {
      const isCorrect = pred.prediction === outcome ? 1 : 0;
      await client.query(
        'UPDATE agent_predictions SET actual_outcome = $1, is_correct = $2, resolved_at = $3 WHERE id = $4',
        [outcome, isCorrect, now, pred.id]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Update style profiles for all affected agents
  const agentIds = [...new Set(predictions.map((p: any) => p.agent_id))];
  for (const agentId of agentIds) {
    await updateStyleProfile(db, agentId as string);
    await updateReputationScore(db, agentId as string);
  }

  return predictions.length;
}

/**
 * Analyze prediction style for an agent
 */
export async function analyzeStyle(db: Pool, agentId: string): Promise<PredictionStyleReport> {
  const predictions = (await db.query(
    `SELECT p.*, m.yes_price, m.no_price
     FROM agent_predictions p
     LEFT JOIN markets m ON p.market_id = m.id
     WHERE p.agent_id = $1
     ORDER BY p.created_at DESC`,
    [agentId]
  )).rows as any[];

  const resolved = predictions.filter((p: any) => p.actual_outcome !== null);
  const totalPredictions = predictions.length;
  const correctPredictions = resolved.filter((p: any) => p.is_correct === 1).length;
  const accuracy = resolved.length > 0 ? correctPredictions / resolved.length : 0;

  // Category breakdown
  const categoryBreakdown: Record<string, { total: number; correct: number; accuracy: number }> = {};
  for (const pred of resolved) {
    const cat = pred.category || 'unknown';
    if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { total: 0, correct: 0, accuracy: 0 };
    categoryBreakdown[cat].total++;
    if (pred.is_correct === 1) categoryBreakdown[cat].correct++;
  }
  for (const cat in categoryBreakdown) {
    const c = categoryBreakdown[cat];
    c.accuracy = c.total > 0 ? c.correct / c.total : 0;
  }

  // Risk preference: high confidence + high volume = aggressive
  const avgConfidence = predictions.length > 0
    ? predictions.reduce((s: number, p: any) => s + p.confidence, 0) / predictions.length
    : 0.5;
  const riskPreference = Math.min(1, Math.max(0, avgConfidence * 1.2));

  // Confidence calibration: how well does confidence match actual accuracy?
  const confidenceCalibration = resolved.length >= 5
    ? avgConfidence - accuracy
    : 0;

  // Contrarian tendency: how often does agent bet against majority?
  const contrarianCount = predictions.filter((p: any) => {
    const yesPrice = Number(p.yes_price);
    const noPrice = Number(p.no_price);
    const pred = String(p.prediction ?? '').toLowerCase();

    if (!Number.isFinite(yesPrice) || !Number.isFinite(noPrice)) return false;
    if (Math.abs(yesPrice - noPrice) < 0.05) return false; // treat near-50/50 as neutral
    if (pred !== 'yes' && pred !== 'no') return false;

    const consensus = yesPrice > noPrice ? 'yes' : 'no';
    return pred !== consensus;
  }).length;
  const contrarianTendency = predictions.length > 0 ? contrarianCount / predictions.length : 0;

  // Streak calculation
  let currentStreak = 0;
  let bestStreak = 0;
  let tempStreak = 0;
  for (const pred of resolved) {
    if (pred.is_correct === 1) {
      tempStreak++;
      if (tempStreak > bestStreak) bestStreak = tempStreak;
    } else {
      tempStreak = 0;
    }
  }
  // Current streak from most recent
  for (let i = 0; i < resolved.length; i++) {
    if (resolved[i].is_correct === 1) currentStreak++;
    else break;
  }

  // Reputation score
  const reputationScore = calculateReputation(accuracy, totalPredictions, currentStreak);

  // Style tags
  const styleTags = generateStyleTags_internal(accuracy, riskPreference, contrarianTendency, categoryBreakdown, currentStreak, totalPredictions);

  // Check owner influence status
  let ownerInfluenceActive = false;
  let ownerTradeCount = 0;
  let ownerWinRate = 0;
  try {
    const influence = await getOwnerInfluence(db, agentId);
    if (influence) {
      ownerInfluenceActive = true;
      ownerTradeCount = influence.profile.totalTrades;
      ownerWinRate = influence.profile.winRate;
    }
  } catch {}

  return {
    totalPredictions,
    correctPredictions,
    accuracy,
    categoryBreakdown,
    riskPreference,
    confidenceCalibration,
    contrarianTendency,
    currentStreak,
    bestStreak,
    reputationScore,
    styleTags,
    ownerInfluenceActive,
    ownerTradeCount,
    ownerWinRate,
  };
}

/**
 * Generate style tags for an agent
 */
export async function generateStyleTags(db: Pool, agentId: string): Promise<string[]> {
  const report = await analyzeStyle(db, agentId);
  return report.styleTags;
}

function generateStyleTags_internal(
  accuracy: number,
  riskPreference: number,
  contrarianTendency: number,
  categoryBreakdown: Record<string, { total: number; correct: number; accuracy: number }>,
  currentStreak: number,
  totalPredictions: number
): string[] {
  const tags: string[] = [];

  // Accuracy-based tags
  if (accuracy >= 0.75 && totalPredictions >= 10) tags.push('预测大师');
  else if (accuracy >= 0.60 && totalPredictions >= 5) tags.push('精准射手');
  else if (accuracy < 0.40 && totalPredictions >= 10) tags.push('反向指标');

  // Risk-based tags
  if (riskPreference >= 0.7) tags.push('高风险玩家');
  else if (riskPreference <= 0.3) tags.push('稳健派');

  // Contrarian tags
  if (contrarianTendency >= 0.6) tags.push('逆势猎手');

  // Category specialist tags
  for (const [cat, stats] of Object.entries(categoryBreakdown)) {
    if (stats.total >= 5 && stats.accuracy >= 0.7) {
      const catNames: Record<string, string> = {
        'four-meme': 'Meme 猎手',
        'flap': '发射台专家',
        'nfa': 'Agent 先知',
        'hackathon': '黑客松预言家',
      };
      if (catNames[cat]) tags.push(catNames[cat]);
    }
  }

  // Streak tags
  if (currentStreak >= 5) tags.push('连胜狂魔');
  else if (currentStreak >= 3) tags.push('势不可挡');

  // Volume tags
  if (totalPredictions >= 50) tags.push('预测狂人');
  else if (totalPredictions >= 20) tags.push('活跃分子');

  return tags.length > 0 ? tags : ['新手预测员'];
}

function calculateReputation(accuracy: number, totalPredictions: number, consistency: number): number {
  // reputation = accuracy * log(predictions+1) * consistency_factor * time_decay
  const volumeFactor = Math.log(totalPredictions + 1) / Math.log(100); // normalize
  const consistencyFactor = 1 + (consistency * 0.05); // streak bonus
  const score = accuracy * volumeFactor * consistencyFactor * 1000;
  return Math.round(Math.max(0, Math.min(9999, score)));
}

async function updateStyleProfile(db: Pool, agentId: string): Promise<void> {
  const report = await analyzeStyle(db, agentId);

  await db.query(`
    INSERT INTO agent_style_profile (agent_id, category_stats, risk_preference, confidence_calibration, contrarian_tendency, streak_current, streak_best, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT(agent_id) DO UPDATE SET
      category_stats = EXCLUDED.category_stats,
      risk_preference = EXCLUDED.risk_preference,
      confidence_calibration = EXCLUDED.confidence_calibration,
      contrarian_tendency = EXCLUDED.contrarian_tendency,
      streak_current = EXCLUDED.streak_current,
      streak_best = EXCLUDED.streak_best,
      updated_at = EXCLUDED.updated_at
  `, [
    agentId,
    JSON.stringify(report.categoryBreakdown),
    report.riskPreference,
    report.confidenceCalibration,
    report.contrarianTendency,
    report.currentStreak,
    report.bestStreak,
    Date.now()
  ]);
}

async function updateReputationScore(db: Pool, agentId: string): Promise<void> {
  const report = await analyzeStyle(db, agentId);
  await db.query('UPDATE agents SET reputation_score = $1 WHERE id = $2',
    [report.reputationScore, agentId]);
}
