import { Router, Response } from 'express';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';

const router = Router();

// POST /api/social/follow — follow a user (auth required)
router.post('/follow', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const followerAddress = req.userAddress!;
    const { followedAddress } = req.body;

    if (typeof followedAddress !== 'string' || !followedAddress.trim()) {
      res.status(400).json({ error: 'followedAddress is required' });
      return;
    }

    if (!ethers.isAddress(followedAddress)) {
      res.status(400).json({ error: 'Invalid address format' });
      return;
    }

    const normalizedFollowed = followedAddress.toLowerCase();

    if (followerAddress === normalizedFollowed) {
      res.status(400).json({ error: 'Cannot follow yourself' });
      return;
    }

    // Check if already following
    const existing = await db.query(
      'SELECT id FROM user_follows WHERE follower_address = $1 AND followed_address = $2',
      [followerAddress, normalizedFollowed]
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Already following this user' });
      return;
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    await db.query(
      'INSERT INTO user_follows (id, follower_address, followed_address, created_at) VALUES ($1, $2, $3, $4)',
      [id, followerAddress, normalizedFollowed, now]
    );

    res.json({ success: true });
  } catch (err: any) {
    console.error('Social follow error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/social/unfollow — unfollow a user (auth required)
router.delete('/unfollow', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const followerAddress = req.userAddress!;
    const { followedAddress } = req.body;

    if (typeof followedAddress !== 'string' || !followedAddress.trim()) {
      res.status(400).json({ error: 'followedAddress is required' });
      return;
    }

    if (!ethers.isAddress(followedAddress)) {
      res.status(400).json({ error: 'Invalid address format' });
      return;
    }

    const normalizedFollowed = followedAddress.toLowerCase();

    const result = await db.query(
      'DELETE FROM user_follows WHERE follower_address = $1 AND followed_address = $2',
      [followerAddress, normalizedFollowed]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Not following this user' });
      return;
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Social unfollow error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/social/following/:addr — list of users this address follows
router.get('/following/:addr', async (req, res) => {
  try {
    const db = getDb();
    const addr = req.params.addr.toLowerCase();

    const result = await db.query(
      `SELECT uf.followed_address as address, up.display_name
       FROM user_follows uf
       LEFT JOIN user_profiles up ON up.address = uf.followed_address
       WHERE uf.follower_address = $1
       ORDER BY uf.created_at DESC
       LIMIT 200`,
      [addr]
    );

    res.json({ following: result.rows });
  } catch (err: any) {
    console.error('Social following error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/social/followers/:addr — list of followers for this address
router.get('/followers/:addr', async (req, res) => {
  try {
    const db = getDb();
    const addr = req.params.addr.toLowerCase();

    const result = await db.query(
      `SELECT uf.follower_address as address, up.display_name
       FROM user_follows uf
       LEFT JOIN user_profiles up ON up.address = uf.follower_address
       WHERE uf.followed_address = $1
       ORDER BY uf.created_at DESC
       LIMIT 200`,
      [addr]
    );

    res.json({ followers: result.rows });
  } catch (err: any) {
    console.error('Social followers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/social/feed — trading feed of followed users (auth required)
router.get('/feed', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userAddress = req.userAddress!;
    const before = req.query.before ? Number(req.query.before) : null;

    let query = `
      SELECT o.id, o.user_address, o.market_id, o.side, o.type, o.amount, o.shares, o.price, o.created_at,
             m.title as market_title, m.category as market_category,
             up.display_name, up.avatar_url
      FROM orders o
      INNER JOIN user_follows uf ON uf.followed_address = o.user_address AND uf.follower_address = $1
      LEFT JOIN markets m ON m.id = o.market_id
      LEFT JOIN user_profiles up ON up.address = o.user_address
    `;
    const params: any[] = [userAddress];

    if (before) {
      query += ' WHERE o.created_at < $2';
      params.push(before);
    }

    query += ' ORDER BY o.created_at DESC LIMIT 50';

    const result = await db.query(query, params);

    res.json({ feed: result.rows });
  } catch (err: any) {
    console.error('Social feed error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/social/feed/public — public feed of all recent trades (no auth required)
router.get('/feed/public', async (req, res) => {
  try {
    const db = getDb();
    const before = req.query.before ? Number(req.query.before) : null;

    let query = `
      SELECT o.id, o.user_address, o.market_id, o.side, o.type, o.amount, o.shares, o.price, o.created_at,
             m.title as market_title, m.category as market_category,
             up.display_name, up.avatar_url
      FROM orders o
      LEFT JOIN markets m ON m.id = o.market_id
      LEFT JOIN user_profiles up ON up.address = o.user_address
    `;
    const params: any[] = [];

    if (before) {
      query += ' WHERE o.created_at < $1';
      params.push(before);
    }

    query += ' ORDER BY o.created_at DESC LIMIT 50';

    const result = await db.query(query, params);
    res.json({ feed: result.rows });
  } catch (err: any) {
    console.error('Public feed error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
