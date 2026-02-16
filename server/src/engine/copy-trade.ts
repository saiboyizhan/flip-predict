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

  // Process database followers -- execute real AMM trades
  for (const follower of dbFollowers) {
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
      if (dailyLimit > 0 && dailyUsed + copyAmount > dailyLimit) continue;

      // Execute real AMM buy (handles balance check, AMM pricing, orders, positions)
      const orderResult = await executeBuy(
        db,
        follower.follower_address,
        trade.marketId,
        trade.side as 'yes' | 'no',
        copyAmount
      );

      // Record in copy_trades table
      const copyTradeId = randomUUID();
      await db.query(`
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
        Math.round(orderResult.shares * 100) / 100,
        Math.round(orderResult.price * 10000) / 10000,
        Date.now()
      ]);

      // Update daily_used
      await db.query(
        'UPDATE agent_followers SET daily_used = daily_used + $1 WHERE id = $2',
        [copyAmount, follower.id]
      );
    } catch (err) {
      console.error(`Copy trade failed for follower ${follower.follower_address}:`, (err as Error).message);
    }
  }
}
