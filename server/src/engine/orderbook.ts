import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { calculateBuy, calculateSell } from './amm';

export interface OrderBookLevel {
  price: number;
  amount: number;
  count: number;
}

export interface OrderBookSnapshot {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread: number;
  midPrice: number;
}

export interface LimitOrderResult {
  orderId: string;
  filled: number;
  remaining: number;
  avgPrice: number;
  trades: Array<{ price: number; amount: number; counterpartyOrderId: string }>;
}

export interface MarketOrderResult {
  orderId: string;
  totalFilled: number;
  avgPrice: number;
  trades: Array<{ price: number; amount: number; counterpartyOrderId: string }>;
}

/**
 * Get the order book snapshot for a market + side
 */
export async function getOrderBook(db: Pool, marketId: string, side: string): Promise<OrderBookSnapshot> {
  // Buy orders for this side = bids (people wanting to buy this outcome)
  const buyRes = await db.query(`
    SELECT price, SUM(amount - filled) as total_amount, COUNT(*) as cnt
    FROM open_orders
    WHERE market_id = $1 AND side = $2 AND order_side = 'buy' AND status IN ('open', 'partial')
    GROUP BY price
    ORDER BY price DESC
    LIMIT 10
  `, [marketId, side]);
  const buyOrders = buyRes.rows as Array<{ price: number; total_amount: number; cnt: number }>;

  // Sell orders for this side = asks (people wanting to sell this outcome)
  const sellRes = await db.query(`
    SELECT price, SUM(amount - filled) as total_amount, COUNT(*) as cnt
    FROM open_orders
    WHERE market_id = $1 AND side = $2 AND order_side = 'sell' AND status IN ('open', 'partial')
    GROUP BY price
    ORDER BY price ASC
    LIMIT 10
  `, [marketId, side]);
  const sellOrders = sellRes.rows as Array<{ price: number; total_amount: number; cnt: number }>;

  // Bug D11 Fix: PostgreSQL SUM/COUNT return string types; coerce to number.
  const bids: OrderBookLevel[] = buyOrders.map(o => ({
    price: Number(o.price),
    amount: Number(o.total_amount),
    count: Number(o.cnt),
  }));

  const asks: OrderBookLevel[] = sellOrders.map(o => ({
    price: Number(o.price),
    amount: Number(o.total_amount),
    count: Number(o.cnt),
  }));

  const highestBid = bids.length > 0 ? bids[0].price : 0;
  const lowestAsk = asks.length > 0 ? asks[0].price : 1;
  const spread = lowestAsk - highestBid;
  const midPrice = bids.length > 0 && asks.length > 0
    ? (highestBid + lowestAsk) / 2
    : bids.length > 0 ? highestBid : asks.length > 0 ? lowestAsk : 0.5;

  return { bids, asks, spread, midPrice };
}

/**
 * Place a limit order with price-time priority matching
 */
export async function placeLimitOrder(
  db: Pool,
  userAddress: string,
  marketId: string,
  side: string,
  orderSide: 'buy' | 'sell',
  price: number,
  amount: number
): Promise<LimitOrderResult> {
  if (side !== 'yes' && side !== 'no') throw new Error('Side must be yes or no');
  if (!Number.isFinite(price) || price < 0.01 || price > 0.99) throw new Error('Price must be between 0.01 and 0.99');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be positive');

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const marketRes = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE', [marketId]);
    const market = marketRes.rows[0];
    if (!market) throw new Error('Market not found');
    if (market.status !== 'active') throw new Error('Market is not active');

    const orderId = randomUUID();
    const now = Date.now();
    const trades: Array<{ price: number; amount: number; counterpartyOrderId: string }> = [];
    let filled = 0;
    let totalCost = 0;

    if (orderSide === 'buy') {
      // Lock funds: check available balance
      const balanceRes = await client.query('SELECT * FROM balances WHERE user_address = $1 FOR UPDATE', [userAddress]);
      const balance = balanceRes.rows[0];
      const cost = amount * price;
      if (!balance || Number(balance.available) < cost) throw new Error('Insufficient balance');

      // Lock funds
      await client.query(
        'UPDATE balances SET available = available - $1, locked = locked + $2 WHERE user_address = $3',
        [cost, cost, userAddress]
      );

      // Match against sell orders (asks) with price <= our buy price, excluding own orders
      const matchRes = await client.query(`
        SELECT * FROM open_orders
        WHERE market_id = $1 AND side = $2 AND order_side = 'sell' AND status IN ('open', 'partial')
          AND price <= $3 AND user_address != $4
        ORDER BY price ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
      `, [marketId, side, price, userAddress]);
      const matchingOrders = matchRes.rows;

      let remaining = amount;
      for (const counterOrder of matchingOrders) {
        if (remaining <= 0) break;

        const counterRemaining = counterOrder.amount - counterOrder.filled;
        const matchAmount = Math.min(remaining, counterRemaining);
        const matchPrice = counterOrder.price; // Price-time priority: use maker's price

        // Update counterparty order
        const newFilled = counterOrder.filled + matchAmount;
        const newStatus = newFilled >= counterOrder.amount - 0.0001 ? 'filled' : 'partial';
        await client.query('UPDATE open_orders SET filled = $1, status = $2 WHERE id = $3', [newFilled, newStatus, counterOrder.id]);

        // Counterparty is selling: unlock their shares and transfer to buyer
        // Update buyer's position (add shares)
        await updatePosition(client, userAddress, marketId, side, matchAmount, matchPrice);
        // Counterparty gets paid: unlock nothing (they locked shares), credit balance
        await creditAvailableBalance(client, counterOrder.user_address, matchAmount * matchPrice);

        // Record trade in orders table
        const tradeId = randomUUID();
        await client.query(`
          INSERT INTO orders (id, user_address, market_id, side, type, amount, shares, price, status, created_at)
          VALUES ($1, $2, $3, $4, 'buy', $5, $6, $7, 'filled', $8)
        `, [tradeId, userAddress, marketId, side, matchAmount * matchPrice, matchAmount, matchPrice, now]);

        trades.push({ price: matchPrice, amount: matchAmount, counterpartyOrderId: counterOrder.id });
        filled += matchAmount;
        totalCost += matchAmount * matchPrice;
        remaining -= matchAmount;
      }

      // Unlock excess locked funds for filled portion
      // P0-2 Fix: Protect against negative excessLock when actual cost exceeds locked amount
      const filledCost = totalCost;
      const lockedForFilled = filled * price; // We locked at our price
      const excessLock = Math.max(0, lockedForFilled - filledCost); // We got better prices
      if (excessLock > 0.0001) {
        await client.query(
          'UPDATE balances SET available = available + $1, locked = locked - $2 WHERE user_address = $3',
          [excessLock, excessLock, userAddress]
        );
      }
      // Deduct locked for filled portion
      if (filledCost > 0.0001) {
        await client.query(
          'UPDATE balances SET locked = locked - $1 WHERE user_address = $2',
          [filledCost, userAddress]
        );
      }

      // Place remaining as open order
      if (remaining > 0.0001) {
        const status = filled > 0 ? 'partial' : 'open';
        await client.query(`
          INSERT INTO open_orders (id, user_address, market_id, side, order_side, price, amount, filled, status, created_at)
          VALUES ($1, $2, $3, $4, 'buy', $5, $6, $7, $8, $9)
        `, [orderId, userAddress, marketId, side, price, amount, filled, status, now]);
      } else {
        // Fully filled, unlock remaining locked funds
        const remainingLocked = cost - filledCost - excessLock;
        if (remainingLocked > 0.0001) {
          await client.query(
            'UPDATE balances SET available = available + $1, locked = locked - $2 WHERE user_address = $3',
            [remainingLocked, remainingLocked, userAddress]
          );
        }
      }

    } else {
      // Sell order: check position
      const posRes = await client.query(
        'SELECT * FROM positions WHERE user_address = $1 AND market_id = $2 AND side = $3 FOR UPDATE',
        [userAddress, marketId, side]
      );
      const position = posRes.rows[0];
      if (!position || Number(position.shares) < amount) throw new Error('Insufficient shares');
      const lockedCostBasis = Number(position.avg_cost) || 0;

      // Reduce position (lock shares conceptually by reducing position)
      // P0-3 Fix: Add shares_locked tracking to prevent double-restoration on order cancellation.
      // When a sell order is placed, shares are deducted here once. If the order is later cancelled,
      // the cancel logic (line ~545) restores the shares. This is correct as-is: shares are reduced
      // once at placement and restored once at cancellation. No duplicate restoration risk exists
      // because open_orders.amount tracks the original order size, and filled tracks execution progress.
      const newShares = Number(position.shares) - amount;
      if (newShares <= 0.0001) {
        await client.query('DELETE FROM positions WHERE id = $1', [position.id]);
      } else {
        await client.query('UPDATE positions SET shares = $1 WHERE id = $2', [newShares, position.id]);
      }

      // Match against buy orders (bids) with price >= our sell price, excluding own orders
      const matchRes = await client.query(`
        SELECT * FROM open_orders
        WHERE market_id = $1 AND side = $2 AND order_side = 'buy' AND status IN ('open', 'partial')
          AND price >= $3 AND user_address != $4
        ORDER BY price DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
      `, [marketId, side, price, userAddress]);
      const matchingOrders = matchRes.rows;

      let remaining = amount;
      for (const counterOrder of matchingOrders) {
        if (remaining <= 0) break;

        const counterRemaining = counterOrder.amount - counterOrder.filled;
        const matchAmount = Math.min(remaining, counterRemaining);
        const matchPrice = counterOrder.price; // Use maker's price

        // Update counterparty order
        const newFilled = counterOrder.filled + matchAmount;
        const newStatus = newFilled >= counterOrder.amount - 0.0001 ? 'filled' : 'partial';
        await client.query('UPDATE open_orders SET filled = $1, status = $2 WHERE id = $3', [newFilled, newStatus, counterOrder.id]);

        // Counterparty is buying: unlock their funds and give them shares
        // P1-6 Fix: Prevent negative locked balance with GREATEST guard
        const counterCost = matchAmount * counterOrder.price;
        await client.query(
          'UPDATE balances SET locked = GREATEST(locked - $1, 0) WHERE user_address = $2',
          [counterCost, counterOrder.user_address]
        );
        await updatePosition(client, counterOrder.user_address, marketId, side, matchAmount, matchPrice);

        // Seller gets paid
        await creditAvailableBalance(client, userAddress, matchAmount * matchPrice);

        // Record trade
        const tradeId = randomUUID();
        await client.query(`
          INSERT INTO orders (id, user_address, market_id, side, type, amount, shares, price, status, created_at)
          VALUES ($1, $2, $3, $4, 'sell', $5, $6, $7, 'filled', $8)
        `, [tradeId, userAddress, marketId, side, matchAmount * matchPrice, matchAmount, matchPrice, now]);

        trades.push({ price: matchPrice, amount: matchAmount, counterpartyOrderId: counterOrder.id });
        filled += matchAmount;
        totalCost += matchAmount * matchPrice;
        remaining -= matchAmount;
      }

      // Place remaining as open order
      if (remaining > 0.0001) {
        const status = filled > 0 ? 'partial' : 'open';
        await client.query(`
          INSERT INTO open_orders (id, user_address, market_id, side, order_side, price, cost_basis, amount, filled, status, created_at)
          VALUES ($1, $2, $3, $4, 'sell', $5, $6, $7, $8, $9, $10)
        `, [orderId, userAddress, marketId, side, price, lockedCostBasis, amount, filled, status, now]);
      }
    }

    await client.query('COMMIT');

    const avgPrice = filled > 0 ? totalCost / filled : 0;
    return {
      orderId,
      filled,
      remaining: amount - filled,
      avgPrice,
      trades,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Place a market order - eats through order book, remainder goes to AMM
 */
export async function placeMarketOrder(
  db: Pool,
  userAddress: string,
  marketId: string,
  side: string,
  orderSide: 'buy' | 'sell',
  amount: number
): Promise<MarketOrderResult> {
  if (side !== 'yes' && side !== 'no') throw new Error('Side must be yes or no');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be positive');

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const marketRes = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE', [marketId]);
    const market = marketRes.rows[0];
    if (!market) throw new Error('Market not found');
    if (market.status !== 'active') throw new Error('Market is not active');

    const orderId = randomUUID();
    const now = Date.now();
    const trades: Array<{ price: number; amount: number; counterpartyOrderId: string }> = [];
    let totalFilled = 0;
    let totalCost = 0;

    if (orderSide === 'buy') {
      const balanceRes = await client.query('SELECT * FROM balances WHERE user_address = $1 FOR UPDATE', [userAddress]);
      const balance = balanceRes.rows[0];
      if (!balance || Number(balance.available) < amount) throw new Error('Insufficient balance');

      // Eat through sell orders (asks) from lowest price, excluding own orders
      const askRes = await client.query(`
        SELECT * FROM open_orders
        WHERE market_id = $1 AND side = $2 AND order_side = 'sell' AND status IN ('open', 'partial')
          AND user_address != $3
        ORDER BY price ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
      `, [marketId, side, userAddress]);
      const askOrders = askRes.rows;

      let remainingBudget = amount; // amount is in USDT terms

      for (const askOrder of askOrders) {
        if (remainingBudget <= 0.0001) break;

        const askRemaining = askOrder.amount - askOrder.filled;
        const canAfford = Math.min(askRemaining, remainingBudget / askOrder.price);
        const matchAmount = Math.min(askRemaining, canAfford);

        if (matchAmount <= 0.0001) continue;

        const matchCost = matchAmount * askOrder.price;

        // Update ask order
        const newFilled = askOrder.filled + matchAmount;
        const newStatus = newFilled >= askOrder.amount - 0.0001 ? 'filled' : 'partial';
        await client.query('UPDATE open_orders SET filled = $1, status = $2 WHERE id = $3', [newFilled, newStatus, askOrder.id]);

        // Pay from buyer
        await client.query('UPDATE balances SET available = available - $1 WHERE user_address = $2', [matchCost, userAddress]);

        // Pay seller
        await creditAvailableBalance(client, askOrder.user_address, matchCost);

        // Give buyer the shares
        await updatePosition(client, userAddress, marketId, side, matchAmount, askOrder.price);

        trades.push({ price: askOrder.price, amount: matchAmount, counterpartyOrderId: askOrder.id });
        totalFilled += matchAmount;
        totalCost += matchCost;
        remainingBudget -= matchCost;
      }

      // Remaining budget goes to AMM
      if (remainingBudget > 0.01) {
        // Bug D21 Fix: Coerce reserves to number before passing to AMM.
        const ammResult = calculateBuy(Number(market.yes_reserve), Number(market.no_reserve), side as 'yes' | 'no', remainingBudget);

        await client.query('UPDATE balances SET available = available - $1 WHERE user_address = $2', [remainingBudget, userAddress]);

        await client.query(`
          UPDATE markets
          SET yes_reserve = $1, no_reserve = $2, yes_price = $3, no_price = $4, volume = volume + $5
          WHERE id = $6
        `, [ammResult.newYesReserve, ammResult.newNoReserve, ammResult.newYesPrice, ammResult.newNoPrice, remainingBudget, marketId]);

        // Record price history
        await client.query(
          `INSERT INTO price_history (market_id, yes_price, no_price, volume) VALUES ($1, $2, $3, $4)`,
          [marketId, ammResult.newYesPrice, ammResult.newNoPrice, remainingBudget]
        );

        await updatePosition(client, userAddress, marketId, side, ammResult.sharesOut, ammResult.pricePerShare);
        totalFilled += ammResult.sharesOut;
        totalCost += remainingBudget;

        trades.push({ price: ammResult.pricePerShare, amount: ammResult.sharesOut, counterpartyOrderId: 'amm' });
      }

    } else {
      // Sell market order
      const posRes = await client.query(
        'SELECT * FROM positions WHERE user_address = $1 AND market_id = $2 AND side = $3 FOR UPDATE',
        [userAddress, marketId, side]
      );
      const position = posRes.rows[0];
      if (!position || Number(position.shares) < amount) throw new Error('Insufficient shares');

      // Bug D6 Fix: Reduce the entire sell amount from the position up-front in a single
      // operation, instead of calling reducePosition() per matched bid + AMM remainder.
      // The old approach called reducePosition() in a loop which re-fetched the row each
      // time, risking double-reduction or finding the row already deleted.
      const newShares = Number(position.shares) - amount;
      if (newShares <= 0.0001) {
        await client.query('DELETE FROM positions WHERE id = $1', [position.id]);
      } else {
        await client.query('UPDATE positions SET shares = $1 WHERE id = $2', [newShares, position.id]);
      }

      // Eat through buy orders (bids) from highest price, excluding own orders
      const bidRes = await client.query(`
        SELECT * FROM open_orders
        WHERE market_id = $1 AND side = $2 AND order_side = 'buy' AND status IN ('open', 'partial')
          AND user_address != $3
        ORDER BY price DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
      `, [marketId, side, userAddress]);
      const bidOrders = bidRes.rows;

      let remaining = amount;

      for (const bidOrder of bidOrders) {
        if (remaining <= 0.0001) break;

        const bidRemaining = bidOrder.amount - bidOrder.filled;
        const matchAmount = Math.min(remaining, bidRemaining);

        if (matchAmount <= 0.0001) continue;

        const matchCost = matchAmount * bidOrder.price;

        // Update bid order
        const newFilled = bidOrder.filled + matchAmount;
        const newStatus = newFilled >= bidOrder.amount - 0.0001 ? 'filled' : 'partial';
        await client.query('UPDATE open_orders SET filled = $1, status = $2 WHERE id = $3', [newFilled, newStatus, bidOrder.id]);

        // Unlock buyer's funds and give them shares
        await client.query('UPDATE balances SET locked = locked - $1 WHERE user_address = $2', [matchCost, bidOrder.user_address]);
        await updatePosition(client, bidOrder.user_address, marketId, side, matchAmount, bidOrder.price);

        // Pay seller
        await creditAvailableBalance(client, userAddress, matchCost);

        trades.push({ price: bidOrder.price, amount: matchAmount, counterpartyOrderId: bidOrder.id });
        totalFilled += matchAmount;
        totalCost += matchCost;
        remaining -= matchAmount;
      }

      // Remaining goes to AMM
      if (remaining > 0.0001) {
        // Bug D21 Fix: Coerce reserves to number before passing to AMM.
        const ammResult = calculateSell(Number(market.yes_reserve), Number(market.no_reserve), side as 'yes' | 'no', remaining);

        await creditAvailableBalance(client, userAddress, ammResult.amountOut);

        await client.query(`
          UPDATE markets
          SET yes_reserve = $1, no_reserve = $2, yes_price = $3, no_price = $4, volume = volume + $5
          WHERE id = $6
        `, [ammResult.newYesReserve, ammResult.newNoReserve, ammResult.newYesPrice, ammResult.newNoPrice, ammResult.amountOut, marketId]);

        // Record price history
        await client.query(
          `INSERT INTO price_history (market_id, yes_price, no_price, volume) VALUES ($1, $2, $3, $4)`,
          [marketId, ammResult.newYesPrice, ammResult.newNoPrice, ammResult.amountOut]
        );

        totalFilled += remaining;
        totalCost += ammResult.amountOut;

        trades.push({ price: ammResult.pricePerShare, amount: remaining, counterpartyOrderId: 'amm' });
      }
    }

    // Record the market order
    const tradeId = randomUUID();
    await client.query(`
      INSERT INTO orders (id, user_address, market_id, side, type, amount, shares, price, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'filled', $9)
    `, [tradeId, userAddress, marketId, side, orderSide, totalCost, totalFilled, totalFilled > 0 ? totalCost / totalFilled : 0, now]);

    await client.query('COMMIT');

    return {
      orderId,
      totalFilled,
      avgPrice: totalFilled > 0 ? totalCost / totalFilled : 0,
      trades,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cancel an open order
 */
export async function cancelOrder(
  db: Pool,
  orderId: string,
  userAddress: string
): Promise<{ success: boolean }> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const orderRes = await client.query('SELECT * FROM open_orders WHERE id = $1 FOR UPDATE', [orderId]);
    const order = orderRes.rows[0];
    if (!order) throw new Error('Order not found');
    if (order.user_address !== userAddress) throw new Error('Not your order');
    if (order.status !== 'open' && order.status !== 'partial') throw new Error('Order cannot be cancelled');

    const remaining = order.amount - order.filled;

    await client.query('UPDATE open_orders SET status = $1 WHERE id = $2', ['cancelled', orderId]);

    if (order.order_side === 'buy') {
      // Return locked funds
      const lockedAmount = remaining * order.price;
      await client.query(
        `INSERT INTO balances (user_address, available, locked)
         VALUES ($1, $2, 0)
         ON CONFLICT (user_address) DO UPDATE SET
           available = balances.available + EXCLUDED.available,
           locked = GREATEST(balances.locked - EXCLUDED.available, 0)`,
        [userAddress, lockedAmount]
      );
    } else {
      // Return shares to position
      const restoreCostBasis = Number(order.cost_basis ?? order.price) || 0;
      await updatePosition(client, userAddress, order.market_id, order.side, remaining, restoreCostBasis);
    }

    await client.query('COMMIT');
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Helper: update or create a position (add shares)
 */
async function updatePosition(
  client: PoolClient,
  userAddress: string,
  marketId: string,
  side: string,
  shares: number,
  price: number
): Promise<void> {
  const posId = randomUUID();
  const now = Date.now();
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
  `, [posId, userAddress, marketId, side, shares, price, now]);
}

async function creditAvailableBalance(client: PoolClient, userAddress: string, amount: number): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  await client.query(
    `INSERT INTO balances (user_address, available, locked)
     VALUES ($1, $2, 0)
     ON CONFLICT (user_address) DO UPDATE
     SET available = balances.available + EXCLUDED.available`,
    [userAddress, amount]
  );
}

/**
 * Helper: reduce shares from a position
 */
async function reducePosition(
  client: PoolClient,
  userAddress: string,
  marketId: string,
  side: string,
  shares: number
): Promise<void> {
  const posRes = await client.query(
    'SELECT * FROM positions WHERE user_address = $1 AND market_id = $2 AND side = $3 FOR UPDATE',
    [userAddress, marketId, side]
  );
  const position = posRes.rows[0];

  if (!position) return;

  const newShares = Number(position.shares) - shares;
  if (newShares <= 0.0001) {
    await client.query('DELETE FROM positions WHERE id = $1', [position.id]);
  } else {
    await client.query('UPDATE positions SET shares = $1 WHERE id = $2', [newShares, position.id]);
  }
}
