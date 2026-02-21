import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';
import { addLiquidity, removeLiquidity, getLpInfo } from '../engine/lp';

const router = Router();

// POST /api/markets/:id/liquidity/add
router.post('/:id/liquidity/add', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const marketId = req.params.id as string;
    const userAddress = req.userAddress!;
    const { amount } = req.body;

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ error: 'amount 必须是正数' });
      return;
    }

    const result = await addLiquidity(db, userAddress, marketId, parsedAmount);
    res.json(result);
  } catch (err: any) {
    const msg = err.message || 'Internal server error';
    const status = msg.includes('not found') ? 404
      : msg.includes('Insufficient') || msg.includes('not active') || msg.includes('expired') || msg.includes('only supported') ? 400
      : 500;
    res.status(status).json({ error: msg });
  }
});

// POST /api/markets/:id/liquidity/remove
router.post('/:id/liquidity/remove', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const marketId = req.params.id as string;
    const userAddress = req.userAddress!;
    const { shares } = req.body;

    const parsedShares = Number(shares);
    if (!Number.isFinite(parsedShares) || parsedShares <= 0) {
      res.status(400).json({ error: 'shares 必须是正数' });
      return;
    }

    const result = await removeLiquidity(db, userAddress, marketId, parsedShares);
    res.json(result);
  } catch (err: any) {
    const msg = err.message || 'Internal server error';
    const status = msg.includes('not found') ? 404
      : msg.includes('Insufficient') || msg.includes('not active') || msg.includes('Cannot remove') ? 400
      : 500;
    res.status(status).json({ error: msg });
  }
});

// GET /api/markets/:id/liquidity
router.get('/:id/liquidity', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const marketId = req.params.id as string;
    // Optional: authenticated user to get their LP info
    let userAddress: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const jwt = await import('jsonwebtoken');
        const { JWT_SECRET } = await import('../config');
        const token = authHeader.substring(7);
        const decoded = jwt.default.verify(token, JWT_SECRET) as { address?: string };
        if (typeof decoded.address === 'string') {
          userAddress = decoded.address.toLowerCase();
        }
      } catch {
        // Invalid token — proceed without user context
      }
    }

    const info = await getLpInfo(db, marketId, userAddress);
    res.json(info);
  } catch (err: any) {
    const msg = err.message || 'Internal server error';
    const status = msg.includes('not found') ? 404 : 500;
    res.status(status).json({ error: msg });
  }
});

export default router;
