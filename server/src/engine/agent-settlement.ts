import { Pool } from 'pg';

const roundTo = (n: number, decimals: number): number => {
  const multiplier = 10 ** decimals;
  return Math.round(n * multiplier) / multiplier;
};

/**
 * Settle all pending agent trades for a resolved market.
 * Called after market resolution (keeper oracle or on-chain MarketResolved event).
 *
 * 1. Updates trade records with real outcome/profit
 * 2. Returns principal+profit for winners
 * 3. Recalculates agent stats
 *
 * On-chain claims (claimWinnings) are now executed by the user's wallet on the frontend.
 */
export async function settleAgentTrades(db: Pool, marketId: string, outcome: string): Promise<number> {
  const trades = await db.query(
    "SELECT * FROM agent_trades WHERE market_id = $1 AND status = 'pending'",
    [marketId]
  );
  if (trades.rows.length === 0) return 0;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    for (const trade of trades.rows) {
      const won = trade.side === outcome;
      const profit = won ? roundTo(trade.amount * (1 / trade.price - 1), 2) : -trade.amount;
      const tradeOutcome = won ? 'win' : 'loss';

      await client.query(
        "UPDATE agent_trades SET outcome=$1, profit=$2, status='settled', settled_at=$3 WHERE id=$4",
        [tradeOutcome, profit, Date.now(), trade.id]
      );

      // Winner: return principal + profit (DB-level tracking)
      if (won) {
        await client.query(
          "UPDATE agents SET wallet_balance = wallet_balance + $1 WHERE id = $2",
          [roundTo(trade.amount + profit, 2), trade.agent_id]
        );
      }
    }

    // Recalculate stats for all affected agents
    const agentIds = [...new Set(trades.rows.map((t: any) => t.agent_id))];
    for (const agentId of agentIds) {
      await recalcAgentStats(client, agentId);
    }

    await client.query('COMMIT');
    console.info(`[agent-settlement] Settled ${trades.rows.length} agent trades for market ${marketId} (outcome=${outcome})`);
    return trades.rows.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Recalculate agent stats from settled trades (source of truth).
 */
async function recalcAgentStats(client: any, agentId: string): Promise<void> {
  const stats = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE status='settled') as settled_count,
      COUNT(*) FILTER (WHERE outcome='win') as win_count,
      COALESCE(SUM(profit) FILTER (WHERE status='settled'), 0) as total_profit
    FROM agent_trades WHERE agent_id = $1
  `, [agentId]);

  const { settled_count, win_count, total_profit } = stats.rows[0];
  const winRate = Number(settled_count) > 0 ? Math.round((Number(win_count) / Number(settled_count)) * 100) : 0;

  const agent = await client.query('SELECT wallet_balance FROM agents WHERE id=$1', [agentId]);
  const currentBalance = Number(agent.rows[0]?.wallet_balance || 0);
  const initialBalance = Math.max(1, currentBalance - Number(total_profit));
  const roi = Math.round((Number(total_profit) / initialBalance) * 100);

  await client.query(`
    UPDATE agents SET winning_trades=$1, total_profit=$2, win_rate=$3, roi=$4 WHERE id=$5
  `, [Number(win_count), roundTo(Number(total_profit), 2), winRate, roi, agentId]);
}
