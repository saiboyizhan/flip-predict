/**
 * Limit order matching engine.
 * After each AMM price change, checks if any limit orders can be filled.
 * Fills are executed through the AMM (CPMM), updating reserves, price_history (K-line), and positions.
 */
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { calculateBuy, calculateSell, getPrice } from './amm';
import { broadcastPriceUpdate, broadcastNewTrade, broadcastOrderBookUpdate } from '../ws';

const TRADE_FEE_RATE = 0.01;

/**
 * Try to match and fill limit orders for a given market.
 * Called after every price change (from event-listener or AMM trade).
 */
export async function matchLimitOrders(db: Pool, marketId: string): Promise<number> {
  let filled = 0;

  // Fetch current market state
  const marketRes = await db.query('SELECT * FROM markets WHERE id = $1', [marketId]);
  const market = marketRes.rows[0];
  if (!market || market.status !== 'active') return 0;

  const yesPrice = Number(market.yes_price);
  const noPrice = Number(market.no_price);

  // Find fillable limit orders:
  // Buy limit at price P → fill when current AMM price ≤ P
  // Sell limit at price P → fill when current AMM price ≥ P
  const ordersRes = await db.query(`
    SELECT * FROM open_orders
    WHERE market_id = $1 AND status = 'open' AND amount > filled
    AND (
      (order_side = 'buy' AND side = 'yes' AND price >= $2) OR
      (order_side = 'buy' AND side = 'no'  AND price >= $3) OR
      (order_side = 'sell' AND side = 'yes' AND price <= $2) OR
      (order_side = 'sell' AND side = 'no'  AND price <= $3)
    )
    ORDER BY created_at ASC
    LIMIT 10
  `, [marketId, yesPrice, noPrice]);

  for (const order of ordersRes.rows) {
    try {
      const didFill = await fillLimitOrder(db, order);
      if (didFill) filled++;
    } catch (err) {
      console.error(`[limit-orders] Failed to fill order ${order.id}:`, err);
    }
  }

  return filled;
}

async function fillLimitOrder(db: Pool, order: any): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Re-fetch market with lock
    const marketRes = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE', [order.market_id]);
    const market = marketRes.rows[0];
    if (!market || market.status !== 'active') {
      await client.query('ROLLBACK');
      return false;
    }

    // Re-check order is still open
    const orderRes = await client.query('SELECT * FROM open_orders WHERE id = $1 AND status = $2 FOR UPDATE', [order.id, 'open']);
    if (!orderRes.rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    const freshOrder = orderRes.rows[0];

    const remaining = Number(freshOrder.amount) - Number(freshOrder.filled);
    if (remaining <= 0) {
      await client.query('ROLLBACK');
      return false;
    }

    const yesReserve = Number(market.yes_reserve);
    const noReserve = Number(market.no_reserve);
    const side = freshOrder.side as 'yes' | 'no';
    const currentPrice = side === 'yes'
      ? noReserve / (yesReserve + noReserve)
      : yesReserve / (yesReserve + noReserve);

    const now = Date.now();
    const orderId = randomUUID();

    if (freshOrder.order_side === 'buy') {
      // Buy limit: fill when current price ≤ limit price
      if (currentPrice > Number(freshOrder.price)) {
        await client.query('ROLLBACK');
        return false;
      }

      // The order locked (price * remaining) USDT. Use all remaining USDT to buy.
      const lockedUsdt = Number(freshOrder.price) * remaining;
      const fee = Math.round(lockedUsdt * TRADE_FEE_RATE * 10000) / 10000;
      const effectiveAmount = lockedUsdt - fee;

      let result;
      try {
        result = calculateBuy(yesReserve, noReserve, side, effectiveAmount);
      } catch {
        await client.query('ROLLBACK');
        return false;
      }

      // LP fee splitting
      const totalLpShares = Number(market.total_lp_shares) || 0;
      const lpFee = totalLpShares > 0 ? fee * 0.8 : 0;
      const protocolFee = fee - lpFee;

      let finalYesReserve = result.newYesReserve;
      let finalNoReserve = result.newNoReserve;
      if (lpFee > 0) {
        const postPool = result.newYesReserve + result.newNoReserve;
        const yesRatio = result.newYesReserve / postPool;
        finalYesReserve += lpFee * yesRatio;
        finalNoReserve += lpFee * (1 - yesRatio);
      }

      // Move locked funds (already locked at order placement)
      await client.query(
        'UPDATE balances SET locked = GREATEST(locked - $1, 0) WHERE user_address = $2',
        [lockedUsdt, freshOrder.user_address]
      );

      // Update market reserves & prices
      await client.query(
        `UPDATE markets SET yes_reserve = $1, no_reserve = $2, yes_price = $3, no_price = $4, volume = volume + $5 WHERE id = $6`,
        [finalYesReserve, finalNoReserve, result.newYesPrice, result.newNoPrice, lockedUsdt, order.market_id]
      );

      // Write price_history (K-line)
      await client.query(
        'INSERT INTO price_history (market_id, yes_price, no_price, volume) VALUES ($1, $2, $3, $4)',
        [order.market_id, result.newYesPrice, result.newNoPrice, lockedUsdt]
      );

      // Create order record
      await client.query(
        `INSERT INTO orders (id, user_address, market_id, side, type, amount, shares, price, status, created_at)
         VALUES ($1, $2, $3, $4, 'buy', $5, $6, $7, 'filled', $8)`,
        [orderId, freshOrder.user_address, order.market_id, side, lockedUsdt, result.sharesOut, result.pricePerShare, now]
      );

      // Update position
      await client.query(`
        INSERT INTO positions (id, user_address, market_id, side, shares, avg_cost, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_address, market_id, side)
        DO UPDATE SET
          avg_cost = COALESCE(
            ((positions.shares * positions.avg_cost) + (EXCLUDED.shares * EXCLUDED.avg_cost))
            / NULLIF(positions.shares + EXCLUDED.shares, 0),
            EXCLUDED.avg_cost
          ),
          shares = positions.shares + EXCLUDED.shares
      `, [randomUUID(), freshOrder.user_address, order.market_id, side, result.sharesOut, result.pricePerShare, now]);

      // Record protocol fee
      if (protocolFee > 0) {
        await client.query(
          'INSERT INTO fee_records (id, user_address, market_id, type, amount, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [randomUUID(), freshOrder.user_address, order.market_id, 'trade_fee', protocolFee, now]
        );
      }

      // Mark order filled
      await client.query("UPDATE open_orders SET filled = amount, status = 'filled' WHERE id = $1", [freshOrder.id]);

      await client.query('COMMIT');

      // Broadcast
      broadcastPriceUpdate(order.market_id, result.newYesPrice, result.newNoPrice);
      broadcastNewTrade({
        orderId,
        marketId: order.market_id,
        userAddress: freshOrder.user_address,
        side,
        type: 'buy',
        amount: lockedUsdt,
        shares: result.sharesOut,
        price: result.pricePerShare,
        timestamp: now,
      });

      console.info(`[limit-orders] Filled BUY ${side} limit: ${result.sharesOut.toFixed(2)} shares @ ${result.pricePerShare.toFixed(4)} for ${freshOrder.user_address}`);
      return true;

    } else {
      // Sell limit: fill when current price ≥ limit price
      if (currentPrice < Number(freshOrder.price)) {
        await client.query('ROLLBACK');
        return false;
      }

      // Shares were already deducted from position at order placement
      const sharesToSell = remaining;

      let result;
      try {
        result = calculateSell(yesReserve, noReserve, side, sharesToSell);
      } catch {
        await client.query('ROLLBACK');
        return false;
      }

      const grossOut = result.amountOut;
      const fee = Math.round(grossOut * TRADE_FEE_RATE * 10000) / 10000;
      const netOut = grossOut - fee;

      const totalLpShares = Number(market.total_lp_shares) || 0;
      const lpFee = totalLpShares > 0 ? fee * 0.8 : 0;
      const protocolFee = fee - lpFee;

      let finalYesReserve = result.newYesReserve;
      let finalNoReserve = result.newNoReserve;
      if (lpFee > 0) {
        const postPool = result.newYesReserve + result.newNoReserve;
        const yesRatio = result.newYesReserve / postPool;
        finalYesReserve += lpFee * yesRatio;
        finalNoReserve += lpFee * (1 - yesRatio);
      }

      // Credit payout to user
      await client.query(
        `INSERT INTO balances (user_address, available, locked) VALUES ($1, $2, 0)
         ON CONFLICT (user_address) DO UPDATE SET available = balances.available + EXCLUDED.available`,
        [freshOrder.user_address, netOut]
      );

      // Update market
      await client.query(
        `UPDATE markets SET yes_reserve = $1, no_reserve = $2, yes_price = $3, no_price = $4, volume = volume + $5 WHERE id = $6`,
        [finalYesReserve, finalNoReserve, result.newYesPrice, result.newNoPrice, grossOut, order.market_id]
      );

      // Write price_history (K-line)
      await client.query(
        'INSERT INTO price_history (market_id, yes_price, no_price, volume) VALUES ($1, $2, $3, $4)',
        [order.market_id, result.newYesPrice, result.newNoPrice, grossOut]
      );

      // Create order record
      await client.query(
        `INSERT INTO orders (id, user_address, market_id, side, type, amount, shares, price, status, created_at)
         VALUES ($1, $2, $3, $4, 'sell', $5, $6, $7, 'filled', $8)`,
        [orderId, freshOrder.user_address, order.market_id, side, netOut, sharesToSell, result.pricePerShare, now]
      );

      // Record protocol fee
      if (protocolFee > 0) {
        await client.query(
          'INSERT INTO fee_records (id, user_address, market_id, type, amount, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [randomUUID(), freshOrder.user_address, order.market_id, 'trade_fee', protocolFee, now]
        );
      }

      // Mark order filled
      await client.query("UPDATE open_orders SET filled = amount, status = 'filled' WHERE id = $1", [freshOrder.id]);

      await client.query('COMMIT');

      broadcastPriceUpdate(order.market_id, result.newYesPrice, result.newNoPrice);
      broadcastNewTrade({
        orderId,
        marketId: order.market_id,
        userAddress: freshOrder.user_address,
        side,
        type: 'sell',
        amount: netOut,
        shares: sharesToSell,
        price: result.pricePerShare,
        timestamp: now,
      });

      console.info(`[limit-orders] Filled SELL ${side} limit: ${sharesToSell.toFixed(2)} shares @ ${result.pricePerShare.toFixed(4)} for ${freshOrder.user_address}`);
      return true;
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Check all active markets for fillable limit orders.
 * Called periodically by the keeper as a safety net.
 */
export async function matchAllLimitOrders(db: Pool): Promise<number> {
  const res = await db.query(
    "SELECT DISTINCT market_id FROM open_orders WHERE status = 'open' AND amount > filled"
  );
  let total = 0;
  for (const row of res.rows) {
    total += await matchLimitOrders(db, row.market_id);
  }
  return total;
}
