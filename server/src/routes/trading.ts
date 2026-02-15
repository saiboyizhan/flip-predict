import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';
import { executeBuy, executeSell } from '../engine/matching';
import { executeBuyMulti, executeSellMulti } from '../engine/matching-multi';
import { broadcastPriceUpdate, broadcastNewTrade, broadcastMultiPriceUpdate } from '../ws';
import { createNotification } from './notifications';

const router = Router();

// POST /api/orders — buy shares
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { marketId, side, amount, optionId } = req.body;
  const userAddress = req.userAddress!;

  if (!marketId || amount == null) {
    res.status(400).json({ error: 'marketId and amount are required' });
    return;
  }

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }

  // Bug D24 Fix: Cap maximum single trade amount to prevent absurd orders
  // that could destabilize the AMM or cause floating-point issues.
  if (parsedAmount > 1_000_000) {
    res.status(400).json({ error: 'amount must not exceed 1,000,000' });
    return;
  }

  try {
    const db = getDb();

    // Check if this is a multi-option market
    if (optionId) {
      const marketRes = await db.query('SELECT market_type FROM markets WHERE id = $1', [marketId]);
      if (marketRes.rows[0]?.market_type === 'multi') {
        const result = await executeBuyMulti(db, userAddress, marketId, optionId, parsedAmount);

        broadcastMultiPriceUpdate(marketId, result.newPrices);
        broadcastNewTrade({
          orderId: result.orderId,
          marketId,
          userAddress,
          side: optionId,
          type: 'buy',
          amount: parsedAmount,
          shares: result.shares,
          price: result.price,
          timestamp: Date.now(),
        });

        // Notify user
        createNotification({
          userAddress,
          type: 'trade',
          title: 'Buy Order Filled',
          message: `Bought ${result.shares.toFixed(2)} shares of "${optionId}" for $${parsedAmount.toFixed(2)}`,
          metadata: { marketId, side: optionId, amount: parsedAmount, shares: result.shares },
        }).catch(err => console.error('Notification error:', err));

        res.json({ success: true, order: result });
        return;
      }
    }

    // Binary market flow (unchanged)
    if (!side || (side !== 'yes' && side !== 'no')) {
      res.status(400).json({ error: 'side must be "yes" or "no"' });
      return;
    }

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

    // Notify user
    createNotification({
      userAddress,
      type: 'trade',
      title: 'Buy Order Filled',
      message: `Bought ${result.shares.toFixed(2)} ${side.toUpperCase()} shares for $${parsedAmount.toFixed(2)}`,
      metadata: { marketId, side, amount: parsedAmount, shares: result.shares },
    }).catch(err => console.error('Notification error:', err));

    res.json({
      success: true,
      order: result,
    });
  } catch (err: any) {
    const safeMessages = ['Market not found', 'Market is not active', 'Insufficient balance', 'AMM buy calculation failed', 'Invalid AMM reserves', 'Invalid buy amount', 'Trade too large', 'LMSR', 'Option not found', 'not multi-option'];
    const isSafe = safeMessages.some(m => err.message?.includes(m));
    if (isSafe) {
      res.status(400).json({ error: err.message });
    } else {
      console.error('Buy order error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// POST /api/orders/sell — sell shares
router.post('/sell', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { marketId, side, shares, optionId } = req.body;
  const userAddress = req.userAddress!;

  if (!marketId || shares == null) {
    res.status(400).json({ error: 'marketId and shares are required' });
    return;
  }

  const parsedShares = Number(shares);
  if (!Number.isFinite(parsedShares) || parsedShares <= 0) {
    res.status(400).json({ error: 'shares must be a positive number' });
    return;
  }

  // Bug D24 Fix: Cap maximum single sell amount.
  if (parsedShares > 1_000_000) {
    res.status(400).json({ error: 'shares must not exceed 1,000,000' });
    return;
  }

  try {
    const db = getDb();

    // Check if this is a multi-option market
    if (optionId) {
      const marketRes = await db.query('SELECT market_type FROM markets WHERE id = $1', [marketId]);
      if (marketRes.rows[0]?.market_type === 'multi') {
        const result = await executeSellMulti(db, userAddress, marketId, optionId, parsedShares);

        broadcastMultiPriceUpdate(marketId, result.newPrices);
        broadcastNewTrade({
          orderId: result.orderId,
          marketId,
          userAddress,
          side: optionId,
          type: 'sell',
          amount: result.amountOut,
          shares: parsedShares,
          price: result.price,
          timestamp: Date.now(),
        });

        // Notify user
        createNotification({
          userAddress,
          type: 'trade',
          title: 'Sell Order Filled',
          message: `Sold ${parsedShares.toFixed(2)} shares of "${optionId}" for $${result.amountOut.toFixed(2)}`,
          metadata: { marketId, side: optionId, shares: parsedShares, amountOut: result.amountOut },
        }).catch(err => console.error('Notification error:', err));

        res.json({ success: true, order: result });
        return;
      }
    }

    // Binary market flow (unchanged)
    if (!side || (side !== 'yes' && side !== 'no')) {
      res.status(400).json({ error: 'side must be "yes" or "no"' });
      return;
    }

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

    // Notify user
    createNotification({
      userAddress,
      type: 'trade',
      title: 'Sell Order Filled',
      message: `Sold ${parsedShares.toFixed(2)} ${side.toUpperCase()} shares for $${result.amountOut.toFixed(2)}`,
      metadata: { marketId, side, shares: parsedShares, amountOut: result.amountOut },
    }).catch(err => console.error('Notification error:', err));

    res.json({
      success: true,
      order: result,
    });
  } catch (err: any) {
    const safeMessages = ['Market not found', 'Market is not active', 'Insufficient shares', 'AMM sell calculation failed', 'Invalid AMM reserves', 'Invalid sell shares', 'Trade too large', 'LMSR', 'Option not found', 'not multi-option'];
    const isSafe = safeMessages.some(m => err.message?.includes(m));
    if (isSafe) {
      res.status(400).json({ error: err.message });
    } else {
      console.error('Sell order error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;
