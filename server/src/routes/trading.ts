import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';
import { executeBuy, executeSell } from '../engine/matching';
import { broadcastPriceUpdate, broadcastNewTrade } from '../ws';

const router = Router();

// POST /api/orders — buy shares
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { marketId, side, amount } = req.body;
  const userAddress = req.userAddress!;

  if (!marketId || !side || !amount) {
    res.status(400).json({ error: 'marketId, side, and amount are required' });
    return;
  }

  if (side !== 'yes' && side !== 'no') {
    res.status(400).json({ error: 'side must be "yes" or "no"' });
    return;
  }

  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }

  try {
    const db = getDb();
    const result = await executeBuy(db, userAddress, marketId, side, amount);

    // Broadcast via WebSocket
    broadcastPriceUpdate(marketId, result.newYesPrice, result.newNoPrice);
    broadcastNewTrade({
      orderId: result.orderId,
      marketId,
      userAddress,
      side,
      type: 'buy',
      amount,
      shares: result.shares,
      price: result.price,
      timestamp: Date.now(),
    });

    res.json({
      success: true,
      order: result,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/orders/sell — sell shares
router.post('/sell', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { marketId, side, shares } = req.body;
  const userAddress = req.userAddress!;

  if (!marketId || !side || !shares) {
    res.status(400).json({ error: 'marketId, side, and shares are required' });
    return;
  }

  if (side !== 'yes' && side !== 'no') {
    res.status(400).json({ error: 'side must be "yes" or "no"' });
    return;
  }

  if (typeof shares !== 'number' || shares <= 0) {
    res.status(400).json({ error: 'shares must be a positive number' });
    return;
  }

  try {
    const db = getDb();
    const result = await executeSell(db, userAddress, marketId, side, shares);

    // Broadcast via WebSocket
    broadcastPriceUpdate(marketId, result.newYesPrice, result.newNoPrice);
    broadcastNewTrade({
      orderId: result.orderId,
      marketId,
      userAddress,
      side,
      type: 'sell',
      amount: result.amountOut,
      shares,
      price: result.price,
      timestamp: Date.now(),
    });

    res.json({
      success: true,
      order: result,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
