import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { StrategyType } from './agent-strategy';
import { executeCopyTrades } from './copy-trade';
import { generateLlmDecisions } from './agent-llm-adapter';
import { syncOwnerProfile, getOwnerInfluence } from './agent-owner-learning';
import { executeBuy, executeSell } from './matching';

interface AutoTradeAgent {
  id: string;
  strategy: StrategyType;
  status: string;
  wallet_balance: number;
  total_trades: number;
  winning_trades: number;
  total_profit: number;
  experience: number;
  level: number;
  prediction_mode: string;
  auto_trade_enabled: number;
  max_per_trade: number;
  max_daily_amount: number;
  daily_trade_used: number;
  auto_trade_expires: number | null;
  last_trade_at: number | null;
  combo_weights: string | null;
}

/**
 * Run auto trade cycle only for agents with prediction_mode = 'auto_trade' and auto_trade_enabled = 1
 */
export async function runAutoTradeCycle(db: Pool, agentId: string): Promise<void> {
  const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [agentId])).rows[0] as AutoTradeAgent | undefined;
  if (!agent) return;
  if (agent.status !== 'active') return;
  if (agent.prediction_mode !== 'auto_trade' || !agent.auto_trade_enabled) return;
  if (agent.wallet_balance < 1) return;

  // Check expiration
  if (agent.auto_trade_expires && agent.auto_trade_expires < Date.now()) {
    await db.query('UPDATE agents SET auto_trade_enabled = 0 WHERE id = $1', [agentId]);
    return;
  }

  // Check daily limit
  let dailyUsed = agent.daily_trade_used || 0;
  const now = Date.now();
  const todayDay = Math.floor(now / 86400000);
  const lastTradeDay = agent.last_trade_at != null ? Math.floor(agent.last_trade_at / 86400000) : null;

  // Reset daily usage when date changes (or if stale usage exists without a last trade timestamp).
  if (dailyUsed > 0 && (lastTradeDay === null || lastTradeDay !== todayDay)) {
    dailyUsed = 0;
    await db.query('UPDATE agents SET daily_trade_used = 0 WHERE id = $1', [agentId]);
  }

  const maxDaily = agent.max_daily_amount || 500;

  if (dailyUsed >= maxDaily) {
    return; // Daily limit reached
  }

  const strategy = agent.strategy as StrategyType;

  // Sync owner profile if learn_from_owner is enabled
  try {
    await syncOwnerProfile(db, agentId);
  } catch (err: any) {
    console.error(`Owner profile sync error for agent ${agentId}:`, err.message);
  }
  const ownerInfluence = await getOwnerInfluence(db, agentId);

  // Use LLM-enhanced decisions (falls back to rule-based if no LLM config)
  const comboWeights = agent.combo_weights
    ? (typeof agent.combo_weights === 'string' ? (() => { try { return JSON.parse(agent.combo_weights as string); } catch { return null; } })() : agent.combo_weights)
    : null;
  const decisions = await generateLlmDecisions(db, agentId, strategy, agent.wallet_balance, comboWeights, ownerInfluence);

  if (decisions.length === 0) return;

  const maxPerTrade = agent.max_per_trade || 100;

  const initialWalletBalance = agent.wallet_balance;
  let { wallet_balance, total_trades, experience, level } = agent;
  let totalDailyUsed = dailyUsed;
  let executedTrades = 0;

  // NO outer transaction -- executeBuy/executeSell each manage their own transactions.
  // Wrapping them in an outer BEGIN would cause deadlocks (connection A holds row lock,
  // executeBuy gets connection B which waits for the same lock).
  const agentAddress = `agent:${agentId}`;

  // Ensure agent has a balances row for AMM trading (DO NOTHING to avoid overwriting
  // keeper settlement rewards with stale wallet_balance)
  await db.query(`
    INSERT INTO balances (user_address, available, locked)
    VALUES ($1, $2, 0)
    ON CONFLICT (user_address) DO NOTHING
  `, [agentAddress, wallet_balance]);

  for (const d of decisions) {
    if (d.action === 'hold') continue;
    if (d.action !== 'buy' && d.action !== 'sell') continue;

    // Circuit breaker: stop if daily losses exceed 20% of max daily
    const todayStartMs = todayDay * 86400000;
    const dailyProfit = (await db.query(
      "SELECT COALESCE(SUM(profit), 0) as total FROM agent_trades WHERE agent_id = $1 AND created_at >= $2",
      [agentId, todayStartMs]
    )).rows[0] as any;

    if (dailyProfit && dailyProfit.total < -(maxDaily * 0.2)) {
      break;
    }

    if (d.action === 'buy') {
      // === BUY ===
      const tradeAmount = Math.min(d.amount, maxPerTrade);
      if (tradeAmount > wallet_balance || tradeAmount < 0.01) continue;
      if (totalDailyUsed + tradeAmount > maxDaily) continue;

      let orderResult;
      try {
        orderResult = await executeBuy(db, agentAddress, d.marketId, d.side as 'yes' | 'no', tradeAmount);
      } catch (buyErr: any) {
        console.error(`Agent ${agentId} AMM buy failed for market ${d.marketId}:`, buyErr.message);
        continue;
      }

      wallet_balance -= tradeAmount;
      total_trades += 1;
      totalDailyUsed += tradeAmount;
      executedTrades += 1;
      experience += 10;

      const newLevel = Math.min(10, Math.floor(experience / 100) + 1);
      if (newLevel > level) level = newLevel;

      const tradeId = randomUUID();
      await db.query(`
        INSERT INTO agent_trades (id, agent_id, market_id, side, amount, shares, price, outcome, profit, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 0, $8)
      `, [
        tradeId, agentId, d.marketId, d.side,
        tradeAmount,
        Math.round(orderResult.shares * 100) / 100,
        Math.round(orderResult.price * 10000) / 10000,
        Date.now()
      ]);

      // Copy trades for followers
      try {
        await executeCopyTrades(db, agentId, tradeId, {
          marketId: d.marketId,
          side: d.side,
          amount: tradeAmount,
          price: Math.round(orderResult.price * 10000) / 10000,
        });
      } catch (copyErr: any) {
        console.error(`Copy trade execution error for agent ${agentId}:`, copyErr.message);
      }

    } else if (d.action === 'sell') {
      // === SELL (take profit / stop loss) ===
      const posRes = await db.query(
        'SELECT shares, avg_cost FROM positions WHERE user_address = $1 AND market_id = $2 AND side = $3',
        [agentAddress, d.marketId, d.side]
      );
      const pos = posRes.rows[0];
      if (!pos || Number(pos.shares) < 0.01) continue;

      // LLM d.amount is in USDT, pos.shares is in shares -- units don't match.
      // For hackathon: sell entire position when LLM triggers sell.
      const sharesToSell = Number(pos.shares);
      if (sharesToSell < 0.01) continue;

      const costBasis = Number(pos.avg_cost) * sharesToSell;

      let sellResult;
      try {
        sellResult = await executeSell(db, agentAddress, d.marketId, d.side as 'yes' | 'no', sharesToSell);
      } catch (sellErr: any) {
        console.error(`Agent ${agentId} AMM sell failed for market ${d.marketId}:`, sellErr.message);
        continue;
      }

      const realProfit = sellResult.amountOut - costBasis;

      wallet_balance += sellResult.amountOut;
      total_trades += 1;
      executedTrades += 1;
      experience += 10;

      const newLevel = Math.min(10, Math.floor(experience / 100) + 1);
      if (newLevel > level) level = newLevel;

      const tradeId = randomUUID();
      await db.query(`
        INSERT INTO agent_trades (id, agent_id, market_id, side, amount, shares, price, outcome, profit, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'sold', $8, $9)
      `, [
        tradeId, agentId, d.marketId, d.side,
        Math.round(sellResult.amountOut * 100) / 100,
        Math.round(sharesToSell * 100) / 100,
        Math.round(sellResult.price * 10000) / 10000,
        Math.round(realProfit * 100) / 100,
        Date.now()
      ]);

      // Note: Copy-trade followers use Buy & Hold model -- agent sells do not
      // trigger follower sells. Followers hold until market settlement.
      // This is by design for the hackathon version to avoid complex partial
      // liquidation logic. The UI displays a disclaimer about this behavior.
    }
  }

  // P0 Fix: Delta-based wallet_balance sync to avoid overwriting concurrent changes
  // Compute the delta from in-memory tracking, then read actual DB balance for accuracy.
  const finalBal = (await db.query(
    'SELECT available FROM balances WHERE user_address = $1', [agentAddress]
  )).rows[0];
  if (finalBal) wallet_balance = Number(finalBal.available);
  const balanceDelta = wallet_balance - initialWalletBalance;

  // Update agent stats (no wrapping transaction needed -- single atomic UPDATE)
  // Use delta-based update for wallet_balance to prevent overwriting concurrent settlement rewards
  await db.query(`
    UPDATE agents SET
      wallet_balance = wallet_balance + $1,
      total_trades = $2,
      experience = $3,
      level = $4,
      daily_trade_used = $5,
      last_trade_at = $6
    WHERE id = $7
  `, [
    Math.round(balanceDelta * 100) / 100,
    total_trades,
    experience,
    level,
    totalDailyUsed,
    executedTrades > 0 ? now : agent.last_trade_at,
    agentId
  ]);
}

export function startAutoTrader(db: Pool, intervalMs: number = 60000): NodeJS.Timeout {
  console.info(`Auto Trader started (${intervalMs / 1000}s interval)`);
  let isRunning = false;

  const run = async () => {
    if (isRunning) {
      return;
    }

    isRunning = true;
    try {
      // Only run for agents with auto_trade mode
      const agents = (await db.query(
        "SELECT id FROM agents WHERE status = 'active' AND prediction_mode = 'auto_trade' AND auto_trade_enabled = 1"
      )).rows as { id: string }[];

      for (const agent of agents) {
        try {
          await runAutoTradeCycle(db, agent.id);
        } catch (err: any) {
          console.error(`AutoTrader ${agent.id} cycle error:`, err.message);
        }
      }
    } catch (err: any) {
      console.error('AutoTrader run error:', err.message);
    } finally {
      isRunning = false;
    }
  };

  setTimeout(() => { void run(); }, 15000);
  return setInterval(() => { void run(); }, intervalMs);
}
