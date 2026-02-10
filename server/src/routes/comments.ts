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
      'SELECT * FROM comments WHERE market_id = $1 ORDER BY created_at DESC',
      [marketId]
    );

    res.json({ comments: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// POST /api/comments/:commentId/like — toggle like (auth required)
router.post('/:commentId/like', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { commentId } = req.params;
    const userAddress = req.userAddress!;

    const existing = (await db.query('SELECT * FROM comments WHERE id = $1', [commentId])).rows[0];
    if (!existing) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }

    const likedBy: string[] = existing.liked_by || [];
    const alreadyLiked = likedBy.includes(userAddress);

    if (alreadyLiked) {
      // Remove like
      const newLikedBy = likedBy.filter((addr: string) => addr !== userAddress);
      await db.query(
        'UPDATE comments SET likes = $1, liked_by = $2 WHERE id = $3',
        [newLikedBy.length, JSON.stringify(newLikedBy), commentId]
      );
    } else {
      // Add like
      const newLikedBy = [...likedBy, userAddress];
      await db.query(
        'UPDATE comments SET likes = $1, liked_by = $2 WHERE id = $3',
        [newLikedBy.length, JSON.stringify(newLikedBy), commentId]
      );
    }

    const updated = (await db.query('SELECT * FROM comments WHERE id = $1', [commentId])).rows[0];
    res.json({ comment: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
