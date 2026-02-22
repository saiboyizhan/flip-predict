import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';
import { calculateBuy, calculateSell, getPrice } from '../engine/amm';

const router = Router();

/**
 * Generate synthetic orderbook from AMM (CPMM) reserves.
 * Asks = cost to buy token at increasing sizes (price goes up)
 * Bids = payout for selling token at increasing sizes (price goes down)
 */
function generateSyntheticOrderbook(
  yesReserve: number,
  noReserve: number,
  side: 'yes' | 'no'
) {
  const FEE_BPS = 100; // 1% fee (matches contract)
  const feeMul = 1 - FEE_BPS / 10000; // 0.99

  // Step sizes as percentage of the smaller reserve (adaptive to liquidity)
  const minReserve = Math.min(yesReserve, noReserve);
  const stepPcts = [0.01, 0.02, 0.05, 0.10, 0.15, 0.20, 0.30, 0.40];
  const asks: { price: number; amount: number; count: number }[] = [];
  const bids: { price: number; amount: number; count: number }[] = [];

  // --- Asks: simulate buying `side` at increasing USDT amounts ---
  let cumShares = 0;
  let yR = yesReserve;
  let nR = noReserve;
  for (const pct of stepPcts) {
    const usdtIn = minReserve * pct;
    const effectiveIn = usdtIn * feeMul;
    try {
      const result = calculateBuy(yR, nR, side, effectiveIn);
      const avgPrice = usdtIn / result.sharesOut; // actual cost per share (including fee)
      asks.push({
        price: Math.round(avgPrice * 100) / 100,
        amount: Math.round(result.sharesOut * 100) / 100,
        count: 1,
      });
      cumShares += result.sharesOut;
      yR = result.newYesReserve;
      nR = result.newNoReserve;
    } catch {
      break; // reserve depleted
    }
  }

  // --- Bids: simulate selling `side` at increasing share amounts ---
  yR = yesReserve;
  nR = noReserve;
  for (const pct of stepPcts) {
    const sharesToSell = minReserve * pct;
    try {
      const result = calculateSell(yR, nR, side, sharesToSell);
      const payout = result.amountOut * feeMul; // after fee
      const avgPrice = payout / sharesToSell;
      bids.push({
        price: Math.round(avgPrice * 100) / 100,
        amount: Math.round(sharesToSell * 100) / 100,
        count: 1,
      });
      yR = result.newYesReserve;
      nR = result.newNoReserve;
    } catch {
      break;
    }
  }

  // Bids should be sorted descending by price
  bids.sort((a, b) => b.price - a.price);
  // Asks should be sorted ascending by price
  asks.sort((a, b) => a.price - b.price);

  // Deduplicate same-price levels
  const dedup = (levels: typeof asks) => {
    const map = new Map<number, { price: number; amount: number; count: number }>();
    for (const l of levels) {
      const existing = map.get(l.price);
      if (existing) {
        existing.amount += l.amount;
        existing.count += l.count;
      } else {
        map.set(l.price, { ...l });
      }
    }
    return Array.from(map.values());
  };

  const dedupAsks = dedup(asks).sort((a, b) => a.price - b.price);
  const dedupBids = dedup(bids).sort((a, b) => b.price - a.price);

  const bestBid = dedupBids[0]?.price ?? 0;
  const bestAsk = dedupAsks[0]?.price ?? 1;
  const spread = Math.round((bestAsk - bestBid) * 100) / 100;
  const midPrice = dedupBids.length > 0 && dedupAsks.length > 0
    ? Math.round(((bestBid + bestAsk) / 2) * 100) / 100
    : Math.round(getPrice(yesReserve, noReserve)[side === 'yes' ? 'yesPrice' : 'noPrice'] * 100) / 100;

  return { bids: dedupBids, asks: dedupAsks, spread, midPrice };
}

// GET /api/orderbook/:marketId/:side — synthetic orderbook from AMM reserves
router.get('/:marketId/:side', async (req, res: Response) => {
  const { marketId, side } = req.params;
  if (!marketId || (side !== 'yes' && side !== 'no')) {
    res.status(400).json({ error: 'Invalid marketId or side' });
    return;
  }

  try {
    const db = getDb();
    const marketRes = await db.query(
      'SELECT yes_reserve, no_reserve, status FROM markets WHERE id = $1',
      [marketId]
    );
    if (!marketRes.rows[0]) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }
    const { yes_reserve, no_reserve, status } = marketRes.rows[0];
    if (status !== 'active') {
      res.json({ bids: [], asks: [], spread: 0, midPrice: 0 });
      return;
    }

    const yesR = Number(yes_reserve);
    const noR = Number(no_reserve);
    if (yesR <= 0 || noR <= 0) {
      res.json({ bids: [], asks: [], spread: 0, midPrice: 0 });
      return;
    }

    const orderbook = generateSyntheticOrderbook(yesR, noR, side as 'yes' | 'no');
    res.json(orderbook);
  } catch (err) {
    console.error('Orderbook fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orderbook/open — user's open limit orders
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
  if (side !== 'yes' && side !== 'no') {
    res.status(400).json({ error: 'side must be "yes" or "no"' });
    return;
  }
  if (orderSide !== 'buy' && orderSide !== 'sell') {
    res.status(400).json({ error: 'orderSide must be "buy" or "sell"' });
    return;
  }

  const p = Number(price);
  const a = Number(amount);
  if (!Number.isFinite(p) || p < 0.01 || p > 0.99) {
    res.status(400).json({ error: 'Price must be between 0.01 and 0.99' });
    return;
  }
  if (!Number.isFinite(a) || a <= 0 || a > 1_000_000) {
    res.status(400).json({ error: 'Amount must be between 0 and 1,000,000' });
    return;
  }

  try {
    const db = getDb();

    // Verify market exists and is active
    const marketRes = await db.query('SELECT id, status, end_time FROM markets WHERE id = $1', [marketId]);
    if (!marketRes.rows[0]) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }
    if (marketRes.rows[0].status !== 'active') {
      res.status(400).json({ error: 'Market is not active' });
      return;
    }
    if (Number(marketRes.rows[0].end_time) <= Date.now()) {
      res.status(400).json({ error: 'Market has expired' });
      return;
    }

    if (orderSide === 'buy') {
      // Lock cost = price * amount (USDT)
      const cost = p * a;
      const balRes = await db.query('SELECT available FROM balances WHERE user_address = $1', [userAddress]);
      const available = Number(balRes.rows[0]?.available ?? 0);
      if (available < cost) {
        res.status(400).json({ error: `Insufficient balance: need ${cost.toFixed(2)}, have ${available.toFixed(2)}` });
        return;
      }
      await db.query(
        'UPDATE balances SET available = available - $1, locked = locked + $1 WHERE user_address = $2',
        [cost, userAddress]
      );
    } else {
      // Lock shares from position
      const posRes = await db.query(
        'SELECT shares FROM positions WHERE user_address = $1 AND market_id = $2 AND side = $3',
        [userAddress, marketId, side]
      );
      const shares = Number(posRes.rows[0]?.shares ?? 0);
      if (shares < a) {
        res.status(400).json({ error: `Insufficient shares: need ${a.toFixed(2)}, have ${shares.toFixed(2)}` });
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

    // Try to immediately match this order
    const { matchLimitOrders } = await import('../engine/limit-orders');
    const filled = await matchLimitOrders(db, marketId);

    res.json({ order: { orderId }, filled });
  } catch (err) {
    console.error('Limit order error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/orderbook/market — market order goes through AMM
router.post('/market', authMiddleware, async (req: AuthRequest, res: Response) => {
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
