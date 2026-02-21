import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';
import { broadcastOrderBookUpdate } from '../ws';

const router = Router();

// GET /api/orderbook/:marketId/:side — aggregated orderbook for a market side
router.get('/:marketId/:side', async (req, res: Response) => {
  const { marketId, side } = req.params;
  if (!marketId || (side !== 'yes' && side !== 'no')) {
    res.status(400).json({ error: 'Invalid marketId or side' });
    return;
  }

  try {
    const db = getDb();

    // Bids = buy orders (grouped by price, descending)
    const bidsRes = await db.query(
      `SELECT price, SUM(amount - filled) AS amount, COUNT(*)::int AS count
       FROM open_orders
       WHERE market_id = $1 AND side = $2 AND order_side = 'buy' AND status = 'open' AND amount > filled
       GROUP BY price ORDER BY price DESC LIMIT 50`,
      [marketId, side]
    );

    // Asks = sell orders (grouped by price, ascending)
    const asksRes = await db.query(
      `SELECT price, SUM(amount - filled) AS amount, COUNT(*)::int AS count
       FROM open_orders
       WHERE market_id = $1 AND side = $2 AND order_side = 'sell' AND status = 'open' AND amount > filled
       GROUP BY price ORDER BY price ASC LIMIT 50`,
      [marketId, side]
    );

    const bids = bidsRes.rows.map(r => ({
      price: Number(r.price),
      amount: Number(r.amount),
      count: r.count,
    }));
    const asks = asksRes.rows.map(r => ({
      price: Number(r.price),
      amount: Number(r.amount),
      count: r.count,
    }));

    const bestBid = bids[0]?.price ?? 0;
    const bestAsk = asks[0]?.price ?? 1;
    const spread = bestAsk - bestBid;
    const midPrice = bids.length > 0 && asks.length > 0 ? (bestBid + bestAsk) / 2 : 0;

    res.json({ bids, asks, spread, midPrice });
  } catch (err) {
    console.error('Orderbook fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orderbook/open — user's open orders
router.get('/open', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const result = await db.query(
      `SELECT id, market_id, side, order_side, price, cost_basis, amount, filled, status, created_at
       FROM open_orders WHERE user_address = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 100`,
      [req.userAddress]
    );
    res.json({ orders: result.rows });
  } catch (err) {
    console.error('Open orders fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/orderbook/limit — place a limit order
router.post('/limit', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { marketId, side, orderSide, price, amount } = req.body;
  const userAddress = req.userAddress!;

  if (!marketId || !side || !orderSide || price == null || amount == null) {
    res.status(400).json({ error: 'marketId, side, orderSide, price, and amount are required' });
    return;
  }

  const p = Number(price);
  const a = Number(amount);
  if (p < 0.01 || p > 0.99) {
    res.status(400).json({ error: 'Price must be between 0.01 and 0.99' });
    return;
  }
  if (a <= 0 || a > 1_000_000) {
    res.status(400).json({ error: 'Amount must be between 0 and 1,000,000' });
    return;
  }

  try {
    const db = getDb();

    // Verify market exists and is active
    const marketRes = await db.query('SELECT id, status FROM markets WHERE id = $1', [marketId]);
    if (!marketRes.rows[0]) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }
    if (marketRes.rows[0].status !== 'active') {
      res.status(400).json({ error: 'Market is not active' });
      return;
    }

    // For buy orders, lock funds from balance
    if (orderSide === 'buy') {
      const cost = p * a;
      const balRes = await db.query('SELECT available FROM balances WHERE user_address = $1', [userAddress]);
      const available = Number(balRes.rows[0]?.available ?? 0);
      if (available < cost) {
        res.status(400).json({ error: 'Insufficient balance' });
        return;
      }
      await db.query(
        'UPDATE balances SET available = available - $1, locked = locked + $1 WHERE user_address = $2',
        [cost, userAddress]
      );
    }

    // For sell orders, lock shares from position
    if (orderSide === 'sell') {
      const posRes = await db.query(
        'SELECT shares FROM positions WHERE user_address = $1 AND market_id = $2 AND side = $3',
        [userAddress, marketId, side]
      );
      const shares = Number(posRes.rows[0]?.shares ?? 0);
      if (shares < a) {
        res.status(400).json({ error: 'Insufficient shares' });
        return;
      }
      await db.query(
        'UPDATE positions SET shares = shares - $1 WHERE user_address = $2 AND market_id = $3 AND side = $4',
        [a, userAddress, marketId, side]
      );
    }

    const orderId = `lo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.query(
      `INSERT INTO open_orders (id, user_address, market_id, side, order_side, price, amount, filled, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'open', $8)`,
      [orderId, userAddress, marketId, side, orderSide, p, a, Date.now()]
    );

    // Broadcast orderbook update
    try {
      const bidsRes = await db.query(
        `SELECT price, SUM(amount - filled) AS amount, COUNT(*)::int AS count
         FROM open_orders WHERE market_id = $1 AND side = $2 AND order_side = 'buy' AND status = 'open' AND amount > filled
         GROUP BY price ORDER BY price DESC LIMIT 50`,
        [marketId, side]
      );
      const asksRes = await db.query(
        `SELECT price, SUM(amount - filled) AS amount, COUNT(*)::int AS count
         FROM open_orders WHERE market_id = $1 AND side = $2 AND order_side = 'sell' AND status = 'open' AND amount > filled
         GROUP BY price ORDER BY price ASC LIMIT 50`,
        [marketId, side]
      );
      broadcastOrderBookUpdate(marketId, side, {
        bids: bidsRes.rows.map(r => ({ price: Number(r.price), amount: Number(r.amount), count: r.count })),
        asks: asksRes.rows.map(r => ({ price: Number(r.price), amount: Number(r.amount), count: r.count })),
      });
    } catch { /* non-critical */ }

    res.json({ order: { orderId } });
  } catch (err) {
    console.error('Limit order error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/orderbook/market — place a market order (AMM)
router.post('/market', authMiddleware, async (req: AuthRequest, res: Response) => {
  // Market orders go through the AMM, redirect to /api/orders
  res.status(400).json({ error: 'Use /api/orders for AMM market orders' });
});

// DELETE /api/orderbook/:orderId — cancel an open order
router.delete('/:orderId', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { orderId } = req.params;
  const userAddress = req.userAddress!;

  try {
    const db = getDb();
    const orderRes = await db.query(
      'SELECT id, market_id, side, order_side, price, amount, filled FROM open_orders WHERE id = $1 AND user_address = $2 AND status = $3',
      [orderId, userAddress, 'open']
    );
    if (!orderRes.rows[0]) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    const order = orderRes.rows[0];
    const remaining = Number(order.amount) - Number(order.filled);

    // Unlock funds/shares
    if (order.order_side === 'buy') {
      const refund = Number(order.price) * remaining;
      await db.query(
        'UPDATE balances SET available = available + $1, locked = locked - $1 WHERE user_address = $2',
        [refund, userAddress]
      );
    } else {
      await db.query(
        'UPDATE positions SET shares = shares + $1 WHERE user_address = $2 AND market_id = $3 AND side = $4',
        [remaining, userAddress, order.market_id, order.side]
      );
    }

    await db.query("UPDATE open_orders SET status = 'cancelled' WHERE id = $1", [orderId]);

    res.json({ success: true });
  } catch (err) {
    console.error('Cancel order error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
