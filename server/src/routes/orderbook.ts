import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';
import { getOrderBook, placeLimitOrder, placeMarketOrder, cancelOrder } from '../engine/orderbook';
import { broadcastOrderBookUpdate } from '../ws';

const router = Router();

// GET /api/orderbook/open — my open orders (auth required)
// NOTE: This must be before /:marketId/:side to avoid route conflict
router.get('/open', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userAddress = req.userAddress!;

  try {
    const db = getDb();
    const { rows: orders } = await db.query(`
      SELECT * FROM open_orders
      WHERE user_address = $1 AND status IN ('open', 'partial')
      ORDER BY created_at DESC
    `, [userAddress]);

    res.json({ orders });
  } catch (err: any) {
    console.error('Open orders error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orderbook/:marketId/:side — get order book (no auth required)
router.get('/:marketId/:side', async (req, res) => {
  const { marketId, side } = req.params;

  if (side !== 'yes' && side !== 'no') {
    res.status(400).json({ error: 'side must be "yes" or "no"' });
    return;
  }

  try {
    const db = getDb();
    const orderbook = await getOrderBook(db, marketId, side);
    res.json(orderbook);
  } catch (err: any) {
    console.error('Orderbook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/orderbook/limit — place limit order (auth required)
router.post('/limit', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { marketId, side, orderSide, price, amount } = req.body;
  const userAddress = req.userAddress!;

  if (!marketId || !side || !orderSide || price == null || amount == null) {
    res.status(400).json({ error: 'marketId, side, orderSide, price, and amount are required' });
    return;
  }

  if (side !== 'yes' && side !== 'no') {
    res.status(400).json({ error: 'side must be "yes" or "no"' });
    return;
  }

  if (orderSide !== 'buy' && orderSide !== 'sell') {
    res.status(400).json({ error: 'orderSide must be "buy" or "sell"' });
    return;
  }

  const parsedPrice = Number(price);
  const parsedAmount = Number(amount);

  if (!Number.isFinite(parsedPrice)) {
    res.status(400).json({ error: 'price must be a finite number' });
    return;
  }

  if (!Number.isFinite(parsedAmount)) {
    res.status(400).json({ error: 'amount must be a finite number' });
    return;
  }

  if (parsedPrice < 0.01 || parsedPrice > 0.99) {
    res.status(400).json({ error: 'price must be between 0.01 and 0.99' });
    return;
  }

  if (parsedAmount <= 0) {
    res.status(400).json({ error: 'amount must be positive' });
    return;
  }

  // Bug D25 Fix: Cap maximum order amount.
  if (parsedAmount > 1_000_000) {
    res.status(400).json({ error: 'amount must not exceed 1,000,000' });
    return;
  }

  try {
    const db = getDb();
    const result = await placeLimitOrder(db, userAddress, marketId, side, orderSide, parsedPrice, parsedAmount);

    // Broadcast updated order book
    const orderbook = await getOrderBook(db, marketId, side);
    broadcastOrderBookUpdate(marketId, side, orderbook);

    res.json({ success: true, order: result });
  } catch (err: any) {
    const safeOrderbookMessages = ['Market not found', 'Market is not active', 'Insufficient balance', 'Insufficient shares', 'Side must be', 'Price must be', 'Amount must be', 'Trade too large'];
    const isSafe = safeOrderbookMessages.some(m => err.message?.includes(m));
    if (isSafe) {
      res.status(400).json({ error: err.message });
    } else {
      console.error('Limit order error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// POST /api/orderbook/market — place market order (auth required)
router.post('/market', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { marketId, side, orderSide, amount } = req.body;
  const userAddress = req.userAddress!;

  if (!marketId || !side || !orderSide || amount == null) {
    res.status(400).json({ error: 'marketId, side, orderSide, and amount are required' });
    return;
  }

  if (side !== 'yes' && side !== 'no') {
    res.status(400).json({ error: 'side must be "yes" or "no"' });
    return;
  }

  if (orderSide !== 'buy' && orderSide !== 'sell') {
    res.status(400).json({ error: 'orderSide must be "buy" or "sell"' });
    return;
  }

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount)) {
    res.status(400).json({ error: 'amount must be a finite number' });
    return;
  }

  if (parsedAmount <= 0) {
    res.status(400).json({ error: 'amount must be positive' });
    return;
  }

  // Bug D25 Fix: Cap maximum order amount.
  if (parsedAmount > 1_000_000) {
    res.status(400).json({ error: 'amount must not exceed 1,000,000' });
    return;
  }

  try {
    const db = getDb();
    const result = await placeMarketOrder(db, userAddress, marketId, side, orderSide, parsedAmount);

    // Broadcast updated order book
    const orderbook = await getOrderBook(db, marketId, side);
    broadcastOrderBookUpdate(marketId, side, orderbook);

    res.json({ success: true, order: result });
  } catch (err: any) {
    const safeOrderbookMessages = ['Market not found', 'Market is not active', 'Insufficient balance', 'Insufficient shares', 'Side must be', 'Amount must be', 'Trade too large'];
    const isSafe = safeOrderbookMessages.some(m => err.message?.includes(m));
    if (isSafe) {
      res.status(400).json({ error: err.message });
    } else {
      console.error('Market order error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// DELETE /api/orderbook/:orderId — cancel order (auth required)
router.delete('/:orderId', authMiddleware, async (req: AuthRequest, res: Response) => {
  const orderId = req.params.orderId as string;
  const userAddress = req.userAddress!;

  try {
    const db = getDb();

    // Get order info before cancelling for broadcast
    const orderResult = await db.query('SELECT * FROM open_orders WHERE id = $1', [orderId]);
    const order = orderResult.rows[0] as any;

    const result = await cancelOrder(db, orderId, userAddress);

    if (order) {
      const orderbook = await getOrderBook(db, order.market_id, order.side);
      broadcastOrderBookUpdate(order.market_id, order.side, orderbook);
    }

    res.json(result);
  } catch (err: any) {
    const safeCancelMessages = ['Order not found', 'Not your order', 'Order cannot be cancelled'];
    const isSafe = safeCancelMessages.some(m => err.message?.includes(m));
    if (isSafe) {
      res.status(400).json({ error: err.message });
    } else {
      console.error('Cancel order error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;
