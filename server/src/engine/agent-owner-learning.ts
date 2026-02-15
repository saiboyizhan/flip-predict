import { Pool } from 'pg';

/**
 * Agent Owner Learning Module
 *
 * Reads the owner's historical trades from the `orders` table,
 * computes a trading profile (side bias, category preferences,
 * position sizing habits, win rate, risk tendency), and exposes
 * an OwnerInfluence object that the decision pipeline can use
 * to nudge Agent behaviour towards the owner's style.
 *
 * Gated by agents.learn_from_owner flag (default 0 = off).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OwnerProfile {
  agentId: string;
  ownerAddress: string;
  totalTrades: number;
  yesRatio: number;           // 0-1, proportion of YES trades
  categoryWeights: Record<string, number>; // category -> proportion
  avgAmount: number;
  riskScore: number;          // 0-1, higher = more aggressive
  contrarianScore: number;    // 0-1, how often owner bets against consensus
  winRate: number;            // 0-1, based on settled positions
  topMarketIds: string[];     // most-traded market ids
  lastSyncedOrderAt: number;
}

export interface OwnerInfluence {
  /** Probability of flipping the agent's side to match owner preference. 0 = no influence, max 0.4 */
  sideBias: 'yes' | 'no' | null;
  sideBiasStrength: number;
  /** Categories the owner trades most, sorted by weight desc */
  preferredCategories: string[];
  /** Multiplier for position sizing: 0.5x - 2.0x */
  sizingMultiplier: number;
  /** Risk adjustment: positive = push towards riskier, negative = more conservative */
  riskAdjustment: number;
  /** How contrarian the owner is (affects contrarian strategy weight) */
  contrarianAdjustment: number;
  /** Specific markets the owner trades frequently */
  marketPreferences: string[];
  /** Raw profile for display */
  profile: OwnerProfile;
}

// ---------------------------------------------------------------------------
// Core: syncOwnerProfile
// ---------------------------------------------------------------------------

export async function syncOwnerProfile(db: Pool, agentId: string): Promise<OwnerProfile | null> {
  // Load agent
  const agentRow = (await db.query(
    'SELECT id, owner_address, learn_from_owner FROM agents WHERE id = $1',
    [agentId]
  )).rows[0] as { id: string; owner_address: string; learn_from_owner: number } | undefined;

  if (!agentRow || !agentRow.learn_from_owner) return null;

  const ownerAddress = agentRow.owner_address;

  // Fetch all owner orders joined with market category
  const ordersResult = await db.query(`
    SELECT o.side, o.amount, o.market_id, o.created_at,
           m.category, m.yes_price, m.status
    FROM orders o
    LEFT JOIN markets m ON o.market_id = m.id
    WHERE LOWER(o.user_address) = LOWER($1)
    ORDER BY o.created_at DESC
  `, [ownerAddress]);

  const orders = ordersResult.rows as {
    side: string;
    amount: number;
    market_id: string;
    created_at: number;
    category: string | null;
    yes_price: number | null;
    status: string | null;
  }[];

  const totalTrades = orders.length;

  if (totalTrades === 0) {
    // UPSERT empty profile
    const emptyProfile: OwnerProfile = {
      agentId,
      ownerAddress,
      totalTrades: 0,
      yesRatio: 0.5,
      categoryWeights: {},
      avgAmount: 0,
      riskScore: 0.5,
      contrarianScore: 0,
      winRate: 0,
      topMarketIds: [],
      lastSyncedOrderAt: 0,
    };
    await upsertProfile(db, emptyProfile);
    return emptyProfile;
  }

  // --- Compute metrics ---

  // 1. Side ratio
  const yesCount = orders.filter(o => o.side === 'yes').length;
  const yesRatio = yesCount / totalTrades;

  // 2. Category weights
  const categoryCounts: Record<string, number> = {};
  for (const o of orders) {
    const cat = o.category || 'unknown';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }
  const categoryWeights: Record<string, number> = {};
  for (const [cat, count] of Object.entries(categoryCounts)) {
    categoryWeights[cat] = count / totalTrades;
  }

  // 3. Average amount
  const totalAmount = orders.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
  const avgAmount = totalAmount / totalTrades;

  // 4. Risk score: based on avg position size relative to a baseline (50)
  // Higher amounts = riskier. Also factor in concentration.
  const maxAmount = Math.max(...orders.map(o => Number(o.amount) || 0));
  const amountVariance = maxAmount > 0 ? avgAmount / maxAmount : 0.5;
  const riskScore = Math.min(1, Math.max(0,
    (avgAmount / 100) * 0.5 + // larger bets = higher risk
    amountVariance * 0.3 +     // consistent sizing = moderate
    (1 - Object.keys(categoryCounts).length / Math.max(4, Object.keys(categoryCounts).length)) * 0.2
  ));

  // 5. Contrarian score: how often owner bets against consensus
  let contrarianCount = 0;
  let contrarianEligible = 0;
  for (const o of orders) {
    const yp = Number(o.yes_price);
    if (!Number.isFinite(yp) || Math.abs(yp - 0.5) < 0.05) continue;
    contrarianEligible++;
    const consensus = yp > 0.5 ? 'yes' : 'no';
    if (o.side !== consensus) contrarianCount++;
  }
  const contrarianScore = contrarianEligible > 0 ? contrarianCount / contrarianEligible : 0;

  // 6. Win rate: based on settled positions
  const positionsResult = await db.query(`
    SELECT p.side, p.shares, m.status,
           CASE WHEN mr.outcome = p.side THEN 1 ELSE 0 END as won
    FROM positions p
    JOIN markets m ON p.market_id = m.id
    LEFT JOIN market_resolution mr ON p.market_id = mr.market_id
    WHERE LOWER(p.user_address) = LOWER($1)
      AND m.status = 'resolved'
      AND mr.outcome IS NOT NULL
  `, [ownerAddress]);
  const settledPositions = positionsResult.rows as { won: number }[];
  const winCount = settledPositions.filter(p => p.won === 1).length;
  const winRate = settledPositions.length > 0 ? winCount / settledPositions.length : 0;

  // 7. Top markets (most traded)
  const marketCounts: Record<string, number> = {};
  for (const o of orders) {
    marketCounts[o.market_id] = (marketCounts[o.market_id] || 0) + 1;
  }
  const topMarketIds = Object.entries(marketCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(e => e[0]);

  const lastSyncedOrderAt = orders[0]?.created_at || 0;

  const profile: OwnerProfile = {
    agentId,
    ownerAddress,
    totalTrades,
    yesRatio,
    categoryWeights,
    avgAmount: Math.round(avgAmount * 100) / 100,
    riskScore: Math.round(riskScore * 1000) / 1000,
    contrarianScore: Math.round(contrarianScore * 1000) / 1000,
    winRate: Math.round(winRate * 1000) / 1000,
    topMarketIds,
    lastSyncedOrderAt,
  };

  await upsertProfile(db, profile);
  return profile;
}

// ---------------------------------------------------------------------------
// Derive OwnerInfluence from profile
// ---------------------------------------------------------------------------

export function deriveOwnerInfluence(profile: OwnerProfile): OwnerInfluence {
  // Side bias: if owner strongly prefers YES or NO
  let sideBias: 'yes' | 'no' | null = null;
  let sideBiasStrength = 0;
  if (profile.totalTrades >= 3) {
    if (profile.yesRatio > 0.6) {
      sideBias = 'yes';
      sideBiasStrength = Math.min(0.4, (profile.yesRatio - 0.5) * 0.8);
    } else if (profile.yesRatio < 0.4) {
      sideBias = 'no';
      sideBiasStrength = Math.min(0.4, (0.5 - profile.yesRatio) * 0.8);
    }
  }

  // Preferred categories sorted by weight
  const preferredCategories = Object.entries(profile.categoryWeights)
    .sort((a, b) => b[1] - a[1])
    .filter(([, w]) => w > 0.1)
    .map(([cat]) => cat);

  // Sizing multiplier: owner risk score maps to 0.5x - 2.0x
  // risk 0 -> 0.5x, risk 0.5 -> 1.0x, risk 1.0 -> 2.0x
  const sizingMultiplier = Math.max(0.5, Math.min(2.0, 0.5 + profile.riskScore * 1.5));

  // Risk adjustment: -0.3 to +0.3
  const riskAdjustment = (profile.riskScore - 0.5) * 0.6;

  // Contrarian adjustment
  const contrarianAdjustment = profile.contrarianScore;

  return {
    sideBias,
    sideBiasStrength,
    preferredCategories,
    sizingMultiplier,
    riskAdjustment,
    contrarianAdjustment,
    marketPreferences: profile.topMarketIds,
    profile,
  };
}

// ---------------------------------------------------------------------------
// getOwnerInfluence: high-level API for the decision pipeline
// ---------------------------------------------------------------------------

export async function getOwnerInfluence(db: Pool, agentId: string): Promise<OwnerInfluence | null> {
  // Check flag
  const agentRow = (await db.query(
    'SELECT learn_from_owner FROM agents WHERE id = $1',
    [agentId]
  )).rows[0] as { learn_from_owner: number } | undefined;

  if (!agentRow || !agentRow.learn_from_owner) return null;

  // Read cached profile
  const cached = (await db.query(
    'SELECT * FROM agent_owner_profile WHERE agent_id = $1',
    [agentId]
  )).rows[0] as any;

  if (!cached || cached.total_trades === 0) return null;

  const profile: OwnerProfile = {
    agentId: cached.agent_id,
    ownerAddress: cached.owner_address,
    totalTrades: cached.total_trades,
    yesRatio: cached.yes_ratio,
    categoryWeights: typeof cached.category_weights === 'string'
      ? JSON.parse(cached.category_weights)
      : (cached.category_weights || {}),
    avgAmount: cached.avg_amount,
    riskScore: cached.risk_score,
    contrarianScore: cached.contrarian_score,
    winRate: cached.win_rate,
    topMarketIds: typeof cached.top_market_ids === 'string'
      ? JSON.parse(cached.top_market_ids)
      : (cached.top_market_ids || []),
    lastSyncedOrderAt: cached.last_synced_order_at,
  };

  return deriveOwnerInfluence(profile);
}

// ---------------------------------------------------------------------------
// Format owner influence as natural language for LLM prompt injection
// ---------------------------------------------------------------------------

export function formatOwnerInfluenceForLlm(influence: OwnerInfluence): string {
  const lines: string[] = [];
  const p = influence.profile;

  lines.push(`[Owner Trading Profile - ${p.totalTrades} historical trades]`);

  if (influence.sideBias) {
    const pct = Math.round(p.yesRatio * 100);
    lines.push(`- Owner side preference: ${influence.sideBias.toUpperCase()} (${pct}% YES trades). Lean towards ${influence.sideBias} when uncertain.`);
  }

  if (influence.preferredCategories.length > 0) {
    lines.push(`- Owner preferred categories: ${influence.preferredCategories.join(', ')}. Prioritize markets in these categories.`);
  }

  if (p.riskScore > 0.65) {
    lines.push(`- Owner trading style: aggressive (risk score ${p.riskScore.toFixed(2)}). You may take larger positions.`);
  } else if (p.riskScore < 0.35) {
    lines.push(`- Owner trading style: conservative (risk score ${p.riskScore.toFixed(2)}). Keep positions small and safe.`);
  }

  if (p.contrarianScore > 0.5) {
    lines.push(`- Owner is contrarian (${Math.round(p.contrarianScore * 100)}% against consensus). Consider contrarian positions.`);
  }

  if (p.winRate > 0) {
    lines.push(`- Owner historical win rate: ${Math.round(p.winRate * 100)}%.`);
  }

  if (p.avgAmount > 0) {
    lines.push(`- Owner average trade size: $${p.avgAmount.toFixed(2)}.`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function upsertProfile(db: Pool, profile: OwnerProfile): Promise<void> {
  await db.query(`
    INSERT INTO agent_owner_profile
      (agent_id, owner_address, total_trades, yes_ratio, category_weights,
       avg_amount, risk_score, contrarian_score, win_rate, top_market_ids,
       last_synced_order_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (agent_id) DO UPDATE SET
      owner_address = EXCLUDED.owner_address,
      total_trades = EXCLUDED.total_trades,
      yes_ratio = EXCLUDED.yes_ratio,
      category_weights = EXCLUDED.category_weights,
      avg_amount = EXCLUDED.avg_amount,
      risk_score = EXCLUDED.risk_score,
      contrarian_score = EXCLUDED.contrarian_score,
      win_rate = EXCLUDED.win_rate,
      top_market_ids = EXCLUDED.top_market_ids,
      last_synced_order_at = EXCLUDED.last_synced_order_at,
      updated_at = EXCLUDED.updated_at
  `, [
    profile.agentId,
    profile.ownerAddress,
    profile.totalTrades,
    profile.yesRatio,
    JSON.stringify(profile.categoryWeights),
    profile.avgAmount,
    profile.riskScore,
    profile.contrarianScore,
    profile.winRate,
    JSON.stringify(profile.topMarketIds),
    profile.lastSyncedOrderAt,
    Date.now(),
  ]);
}
