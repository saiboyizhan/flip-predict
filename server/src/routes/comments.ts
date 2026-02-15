import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';

const router = Router();

function parseAddressArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).toLowerCase());
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).toLowerCase());
      }
    } catch {
      return [];
    }
  }
  return [];
}

// GET /api/comments/:marketId — list comments for a market
router.get('/:marketId', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { marketId } = req.params;

    const result = await db.query(
      'SELECT * FROM comments WHERE market_id = $1 ORDER BY created_at ASC LIMIT 100',
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
    const { content, parentId } = req.body;

    if (typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }
    if (content.length > 500) {
      res.status(400).json({ error: 'Content must be 500 characters or less' });
      return;
    }

    // Validate parentId if provided
    if (parentId !== undefined && parentId !== null) {
      if (typeof parentId !== 'string') {
        res.status(400).json({ error: 'Invalid parentId' });
        return;
      }
      const parentExists = await db.query('SELECT id FROM comments WHERE id = $1 AND market_id = $2', [parentId, marketId]);
      if (parentExists.rows.length === 0) {
        res.status(404).json({ error: 'Parent comment not found' });
        return;
      }
    }

    const marketResult = await db.query('SELECT id FROM markets WHERE id = $1', [marketId]);
    if (marketResult.rows.length === 0) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    // Bug D27 Fix: Rate limit comments to 20 per hour per user to prevent spam.
    const oneHourAgo = Date.now() - 3600000;
    const recentCommentsRes = await db.query(
      'SELECT COUNT(*) as cnt FROM comments WHERE user_address = $1 AND created_at > $2',
      [req.userAddress, oneHourAgo]
    );
    if (parseInt(recentCommentsRes.rows[0].cnt, 10) >= 20) {
      res.status(429).json({ error: '评论太频繁，请稍后再试 (每小时最多20条)' });
      return;
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    await db.query(
      `INSERT INTO comments (id, market_id, user_address, content, likes, liked_by, parent_id, created_at)
       VALUES ($1, $2, $3, $4, 0, '[]', $5, $6)`,
      [id, marketId, req.userAddress, content.trim(), parentId ?? null, now]
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
    const userAddress = req.userAddress!.toLowerCase();

    // Use transaction with FOR UPDATE to prevent race conditions on concurrent likes
    const client = await db.connect();
    let committed = false;
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

      const likedBy = parseAddressArray(existing.liked_by);
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
      committed = true;

      const updated = (await db.query('SELECT * FROM comments WHERE id = $1', [commentId])).rows[0];
      res.json({ comment: updated });
    } catch (txErr) {
      if (!committed) {
        await client.query('ROLLBACK');
      }
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
