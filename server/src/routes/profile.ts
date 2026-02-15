import { Router, Request, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';

const router = Router();

// GET /api/profile/:addr — public profile
router.get('/:addr', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const addr = (req.params.addr as string).toLowerCase();

    // Get profile
    const profileResult = await db.query(
      'SELECT address, display_name, bio, avatar_url, updated_at FROM user_profiles WHERE address = $1',
      [addr]
    );

    const profile = profileResult.rows[0] || {
      address: addr,
      display_name: null,
      bio: null,
      avatar_url: null,
    };

    // Get trade stats from orders
    const statsResult = await db.query(
      `SELECT
         COUNT(*) as total_trades,
         COALESCE(SUM(amount), 0) as total_volume
       FROM orders
       WHERE user_address = $1`,
      [addr]
    );

    const stats = statsResult.rows[0] || { total_trades: 0, total_volume: 0 };

    // Get follower/following counts
    const followingResult = await db.query(
      'SELECT COUNT(*) as cnt FROM user_follows WHERE follower_address = $1',
      [addr]
    );
    const followersResult = await db.query(
      'SELECT COUNT(*) as cnt FROM user_follows WHERE followed_address = $1',
      [addr]
    );

    res.json({
      profile: {
        address: profile.address,
        displayName: profile.display_name,
        bio: profile.bio,
        avatarUrl: profile.avatar_url,
        totalTrades: parseInt(stats.total_trades, 10),
        totalVolume: parseFloat(stats.total_volume),
        followingCount: parseInt(followingResult.rows[0].cnt, 10),
        followersCount: parseInt(followersResult.rows[0].cnt, 10),
      },
    });
  } catch (err: any) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/profile — update own profile (auth required)
router.put('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const addr = req.userAddress!;
    const { displayName, bio, avatarUrl } = req.body;

    // Validate inputs
    if (displayName !== undefined && typeof displayName !== 'string') {
      res.status(400).json({ error: 'Invalid displayName' });
      return;
    }
    if (bio !== undefined && typeof bio !== 'string') {
      res.status(400).json({ error: 'Invalid bio' });
      return;
    }
    if (avatarUrl !== undefined && typeof avatarUrl !== 'string') {
      res.status(400).json({ error: 'Invalid avatarUrl' });
      return;
    }

    if (displayName && displayName.length > 50) {
      res.status(400).json({ error: 'displayName must be 50 characters or less' });
      return;
    }
    if (bio && bio.length > 200) {
      res.status(400).json({ error: 'bio must be 200 characters or less' });
      return;
    }

    const now = Date.now();

    // Upsert profile
    await db.query(
      `INSERT INTO user_profiles (address, display_name, bio, avatar_url, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (address)
       DO UPDATE SET
         display_name = COALESCE($2, user_profiles.display_name),
         bio = COALESCE($3, user_profiles.bio),
         avatar_url = COALESCE($4, user_profiles.avatar_url),
         updated_at = $5`,
      [addr, displayName ?? null, bio ?? null, avatarUrl ?? null, now]
    );

    const result = await db.query(
      'SELECT address, display_name, bio, avatar_url, updated_at FROM user_profiles WHERE address = $1',
      [addr]
    );

    const row = result.rows[0];
    res.json({
      profile: row ? {
        address: row.address,
        displayName: row.display_name,
        bio: row.bio,
        avatarUrl: row.avatar_url,
      } : null,
    });
  } catch (err: any) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
