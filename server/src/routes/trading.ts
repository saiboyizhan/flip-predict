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

  if (!marketId || !side || amount == null) {
    res.status(400).json({ error: 'marketId, side, and amount are required' });
    return;
  }

  if (side !== 'yes' && side !== 'no') {
    res.status(400).json({ error: 'side must be "yes" or "no"' });
    return;
  }

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }

  try {
    const db = getDb();
    const result = await executeBuy(db, userAddress, marketId, side, parsedAmount);

    // Broadcast via WebSocket
    broadcastPriceUpdate(marketId, result.newYesPrice, result.newNoPrice);
    broadcastNewTrade({
      orderId: result.orderId,
      marketId,
      userAddress,
      side,
      type: 'buy',
      amount: parsedAmount,
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

  if (!marketId || !side || shares == null) {
    res.status(400).json({ error: 'marketId, side, and shares are required' });
    return;
  }

  if (side !== 'yes' && side !== 'no') {
    res.status(400).json({ error: 'side must be "yes" or "no"' });
    return;
  }

  const parsedShares = Number(shares);
  if (!Number.isFinite(parsedShares) || parsedShares <= 0) {
    res.status(400).json({ error: 'shares must be a positive number' });
    return;
  }

  try {
    const db = getDb();
    const result = await executeSell(db, userAddress, marketId, side, parsedShares);

    // Broadcast via WebSocket
    broadcastPriceUpdate(marketId, result.newYesPrice, result.newNoPrice);
    broadcastNewTrade({
      orderId: result.orderId,
      marketId,
      userAddress,
      side,
      type: 'sell',
      amount: result.amountOut,
      shares: parsedShares,
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
