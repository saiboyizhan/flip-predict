import { Pool } from 'pg';
import { randomUUID } from 'crypto';

export async function executeCopyTrades(
  db: Pool,
  agentId: string,
  agentTradeId: string,
  trade: { marketId: string; side: string; amount: number; price: number; optionId?: string }
): Promise<void> {
  const followers = (await db.query(
    "SELECT * FROM agent_followers WHERE agent_id = $1 AND status = 'active'",
    [agentId]
  )).rows;

  if (followers.length === 0) return;

  const onChainFollowers = followers.filter(f => f.on_chain === 1);
  const dbFollowers = followers.filter(f => f.on_chain !== 1);

  // Process on-chain followers (create pending records)
  for (const follower of onChainFollowers) {
    try {
      let copyAmount = trade.amount * (follower.copy_percentage / 100);

      // Cap at max_per_trade
      if (follower.max_per_trade && copyAmount > follower.max_per_trade) {
        copyAmount = follower.max_per_trade;
      }

      copyAmount = Math.round(copyAmount * 100) / 100;
      if (copyAmount < 0.01) continue;

      // Check daily limit
      const dailyUsed = Number(follower.daily_used) || 0;
      const dailyLimit = Number(follower.daily_limit) || 0;
      if (dailyLimit > 0 && dailyUsed + copyAmount > dailyLimit) {
        continue;
      }

      const shares = copyAmount / trade.price;
      const roundedShares = Math.round(shares * 100) / 100;
      const roundedPrice = Math.round(trade.price * 10000) / 10000;

      // Insert pending on-chain trade (no tx_hash yet)
      const copyTradeId = randomUUID();
      await db.query(`
        INSERT INTO copy_trades (id, agent_id, follower_address, agent_trade_id, market_id, side, amount, shares, price, on_chain, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, 'pending', $10)
      `, [
        copyTradeId,
        agentId,
        follower.follower_address,
        agentTradeId,
        trade.marketId,
        trade.side,
        copyAmount,
        roundedShares,
        roundedPrice,
        Date.now()
      ]);

      // Update daily_used
      await db.query(
        'UPDATE agent_followers SET daily_used = daily_used + $1 WHERE id = $2',
        [copyAmount, follower.id]
      );
    } catch (err) {
      console.error(`On-chain copy trade creation failed for follower ${follower.follower_address}:`, (err as Error).message);
    }
  }

  // Process database followers (same as before)
  for (const follower of dbFollowers) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      let copyAmount = trade.amount * (follower.copy_percentage / 100);

      // Cap at max_per_trade
      if (follower.max_per_trade && copyAmount > follower.max_per_trade) {
        copyAmount = follower.max_per_trade;
      }

      copyAmount = Math.round(copyAmount * 100) / 100;
      if (copyAmount < 0.01) {
        await client.query('ROLLBACK');
        continue;
      }

      // Check daily limit
      const dailyUsed = Number(follower.daily_used) || 0;
      const dailyLimit = Number(follower.daily_limit) || 0;
      if (dailyLimit > 0 && dailyUsed + copyAmount > dailyLimit) {
        await client.query('ROLLBACK');
        continue;
      }

      // Check follower balance
      const balanceRow = (await client.query(
        'SELECT available FROM balances WHERE user_address = $1 FOR UPDATE',
        [follower.follower_address]
      )).rows[0];

      if (!balanceRow || balanceRow.available < copyAmount) {
        await client.query('ROLLBACK');
        continue;
      }

      // Deduct from follower balance
      await client.query(
        'UPDATE balances SET available = available - $1 WHERE user_address = $2',
        [copyAmount, follower.follower_address]
      );

      // Create position record so the follower can earn from this trade
      const shares = copyAmount / trade.price;
      const roundedShares = Math.round(shares * 100) / 100;
      const roundedPrice = Math.round(trade.price * 10000) / 10000;
      await client.query(`
        INSERT INTO positions (id, user_address, market_id, side, shares, avg_cost, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_address, market_id, side)
        DO UPDATE SET
          avg_cost = CASE
            WHEN positions.shares + EXCLUDED.shares > 0
            THEN ((positions.shares * positions.avg_cost) + (EXCLUDED.shares * EXCLUDED.avg_cost))
                 / (positions.shares + EXCLUDED.shares)
            ELSE positions.avg_cost
          END,
          shares = positions.shares + EXCLUDED.shares
      `, [
        randomUUID(),
        follower.follower_address,
        trade.marketId,
        trade.side,
        roundedShares,
        roundedPrice,
        Date.now()
      ]);

      // Insert into copy_trades
      const copyTradeId = randomUUID();
      await client.query(`
        INSERT INTO copy_trades (id, agent_id, follower_address, agent_trade_id, market_id, side, amount, shares, price, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10)
      `, [
        copyTradeId,
        agentId,
        follower.follower_address,
        agentTradeId,
        trade.marketId,
        trade.side,
        copyAmount,
        roundedShares,
        roundedPrice,
        Date.now()
      ]);

      // Update daily_used
      await client.query(
        'UPDATE agent_followers SET daily_used = daily_used + $1 WHERE id = $2',
        [copyAmount, follower.id]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Copy trade failed for follower ${follower.follower_address}:`, (err as Error).message);
    } finally {
      client.release();
    }
  }
}
