import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { executeBuy } from './matching';

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

  // Helper: compute today's used amount from copy_trades (not stale daily_used column)
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  // P0 Fix: Batch-fetch daily usage for ALL followers BEFORE the loop to prevent N+1 queries
  const allFollowerAddresses = followers.map(f => f.follower_address);
  const dailyUsageRes = await db.query(
    `SELECT follower_address, COALESCE(SUM(amount), 0) as total
     FROM copy_trades
     WHERE follower_address = ANY($1) AND created_at >= $2
     GROUP BY follower_address`,
    [allFollowerAddresses, todayStartMs]
  );
  const dailyUsageMap = new Map<string, number>();
  for (const row of dailyUsageRes.rows) {
    dailyUsageMap.set(row.follower_address, Number(row.total));
  }

  function getDailyUsed(followerAddress: string): number {
    return dailyUsageMap.get(followerAddress) || 0;
  }

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

      // Check daily limit using actual copy_trades flow (resets naturally each day)
      const dailyLimit = Number(follower.daily_limit) || 0;
      if (dailyLimit > 0) {
        const dailyUsed = getDailyUsed(follower.follower_address);
        if (dailyUsed + copyAmount > dailyLimit) continue;
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

    } catch (err) {
      console.error(`On-chain copy trade creation failed for follower ${follower.follower_address}:`, (err as Error).message);
    }
  }

  // Process database followers -- execute real AMM trades
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

      // P0 Fix: Lock the agent_followers row to serialize daily limit checks
      const lockedFollowerRes = await client.query(
        'SELECT * FROM agent_followers WHERE agent_id = $1 AND follower_address = $2 FOR UPDATE',
        [agentId, follower.follower_address]
      );
      if (lockedFollowerRes.rows.length === 0) {
        await client.query('ROLLBACK');
        continue;
      }

      // P0 Fix: Check daily limit INSIDE the transaction to prevent race conditions
      const dailyLimit = Number(follower.daily_limit) || 0;
      if (dailyLimit > 0) {
        const dailyUsedRes = await client.query(
          `SELECT COALESCE(SUM(amount), 0) as total FROM copy_trades WHERE follower_address = $1 AND created_at >= $2`,
          [follower.follower_address, todayStartMs]
        );
        const dailyUsed = Number(dailyUsedRes.rows[0].total);
        if (dailyUsed + copyAmount > dailyLimit) {
          await client.query('ROLLBACK');
          continue;
        }
      }

      // Slippage circuit breaker
      const mktRes = await client.query('SELECT yes_price, no_price FROM markets WHERE id = $1', [trade.marketId]);
      if (mktRes.rows[0]) {
        const currentPrice = trade.side === 'yes' ? Number(mktRes.rows[0].yes_price) : Number(mktRes.rows[0].no_price);
        // P2 Fix: For side='no', invert slippage check (price dropped too much)
        if (trade.side === 'yes' && currentPrice > trade.price * 1.10) {
          console.log(`Skipping copy trade for ${follower.follower_address}: slippage too high (${currentPrice} vs ${trade.price})`);
          await client.query('ROLLBACK');
          continue;
        }
        if (trade.side === 'no' && currentPrice < trade.price * 0.90) {
          console.log(`Skipping copy trade for ${follower.follower_address}: slippage too high (${currentPrice} vs ${trade.price})`);
          await client.query('ROLLBACK');
          continue;
        }
      }

      // Insert pending record BEFORE executing trade to prevent data loss
      const copyTradeId = randomUUID();
      const now = Date.now();
      await client.query(`
        INSERT INTO copy_trades (id, agent_id, follower_address, agent_trade_id, market_id, side, amount, shares, price, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, 'pending', $8)
      `, [copyTradeId, agentId, follower.follower_address, agentTradeId, trade.marketId, trade.side, copyAmount, now]);

      await client.query('COMMIT');

      // Execute real AMM buy OUTSIDE the lock transaction (executeBuy manages its own tx)
      const orderResult = await executeBuy(
        db,
        follower.follower_address,
        trade.marketId,
        trade.side as 'yes' | 'no',
        copyAmount
      );

      // Update copy_trade record with actual execution data
      await db.query(`
        UPDATE copy_trades SET shares = $1, price = $2, status = 'open' WHERE id = $3
      `, [
        Math.round(orderResult.shares * 100) / 100,
        Math.round(orderResult.price * 10000) / 10000,
        copyTradeId
      ]);

      // daily_used is now computed from copy_trades table, no need to update agent_followers
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`Copy trade failed for follower ${follower.follower_address}:`, (err as Error).message);
    } finally {
      client.release();
    }
  }
}
