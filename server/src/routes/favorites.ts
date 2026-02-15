import { Router, Response } from 'express';
import crypto from 'crypto';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';

const router = Router();

// POST /api/favorites/:marketId — add a market to favorites (auth required)
router.post('/:marketId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userAddress = req.userAddress!;
    const { marketId } = req.params;

    if (!marketId || typeof marketId !== 'string') {
      res.status(400).json({ error: 'marketId is required' });
      return;
    }

    // Verify market exists
    const marketCheck = await db.query('SELECT id FROM markets WHERE id = $1', [marketId]);
    if (marketCheck.rows.length === 0) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    // Check if already favorited
    const existing = await db.query(
      'SELECT id FROM user_favorites WHERE user_address = $1 AND market_id = $2',
      [userAddress, marketId]
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Already favorited' });
      return;
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    await db.query(
      'INSERT INTO user_favorites (id, user_address, market_id, created_at) VALUES ($1, $2, $3, $4)',
      [id, userAddress, marketId, now]
    );

    res.json({ success: true, id });
  } catch (err: any) {
    console.error('Favorite add error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/favorites/:marketId — remove a market from favorites (auth required)
router.delete('/:marketId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userAddress = req.userAddress!;
    const { marketId } = req.params;

    if (!marketId || typeof marketId !== 'string') {
      res.status(400).json({ error: 'marketId is required' });
      return;
    }

    const result = await db.query(
      'DELETE FROM user_favorites WHERE user_address = $1 AND market_id = $2',
      [userAddress, marketId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Favorite not found' });
      return;
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Favorite remove error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/favorites — get user's favorite markets (auth required)
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userAddress = req.userAddress!;

    const result = await db.query(
      `SELECT uf.id, uf.market_id, uf.created_at,
              m.title, m.category, m.status, m.yes_price, m.no_price, m.volume, m.end_time
       FROM user_favorites uf
       INNER JOIN markets m ON m.id = uf.market_id
       WHERE uf.user_address = $1
       ORDER BY uf.created_at DESC`,
      [userAddress]
    );

    const favorites = result.rows.map((row: any) => ({
      id: row.id,
      marketId: row.market_id,
      title: row.title,
      category: row.category,
      status: row.status,
      yesPrice: parseFloat(row.yes_price) || 0.5,
      noPrice: parseFloat(row.no_price) || 0.5,
      volume: parseFloat(row.volume) || 0,
      endTime: parseInt(row.end_time) || 0,
      favoritedAt: parseInt(row.created_at) || 0,
    }));

    res.json({ favorites });
  } catch (err: any) {
    console.error('Favorites list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
