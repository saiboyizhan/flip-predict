import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';

const router = Router();

// GET /api/comments/:marketId — list comments for a market
router.get('/:marketId', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { marketId } = req.params;

    const result = await db.query(
      'SELECT * FROM comments WHERE market_id = $1 ORDER BY created_at DESC LIMIT 100',
      [marketId]
    );

    res.json({ comments: result.rows });
  } catch (err: any) {
    console.error('Comments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/comments/:marketId — create a comment (auth required)
router.post('/:marketId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { marketId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }
    if (content.length > 500) {
      res.status(400).json({ error: 'Content must be 500 characters or less' });
      return;
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    await db.query(
      `INSERT INTO comments (id, market_id, user_address, content, likes, liked_by, created_at)
       VALUES ($1, $2, $3, $4, 0, '[]', $5)`,
      [id, marketId, req.userAddress, content.trim(), now]
    );

    const comment = (await db.query('SELECT * FROM comments WHERE id = $1', [id])).rows[0];
    res.json({ comment });
  } catch (err: any) {
    console.error('Comments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/comments/:commentId/like — toggle like (auth required)
router.post('/:commentId/like', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { commentId } = req.params;
    const userAddress = req.userAddress!;

    // Use transaction with FOR UPDATE to prevent race conditions on concurrent likes
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const existing = (await client.query(
        'SELECT * FROM comments WHERE id = $1 FOR UPDATE',
        [commentId]
      )).rows[0];

      if (!existing) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Comment not found' });
        return;
      }

      const likedBy: string[] = existing.liked_by || [];
      const alreadyLiked = likedBy.includes(userAddress);

      let newLikedBy: string[];
      if (alreadyLiked) {
        newLikedBy = likedBy.filter((addr: string) => addr !== userAddress);
      } else {
        newLikedBy = [...likedBy, userAddress];
      }

      await client.query(
        'UPDATE comments SET likes = $1, liked_by = $2 WHERE id = $3',
        [newLikedBy.length, JSON.stringify(newLikedBy), commentId]
      );

      await client.query('COMMIT');

      const updated = (await db.query('SELECT * FROM comments WHERE id = $1', [commentId])).rows[0];
      res.json({ comment: updated });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Comments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
