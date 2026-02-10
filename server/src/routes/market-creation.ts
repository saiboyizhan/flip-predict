import { Router, Request, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';

const router = Router();

function generateId(): string {
  return 'ucm-' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

const VALID_CATEGORIES = [
  'four-meme', 'meme-arena', 'narrative', 'kol',
  'on-chain', 'rug-alert', 'btc-weather', 'fun', 'daily'
];

// POST /api/markets/create — create user market
router.post('/create', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { title, description, category, endTime } = req.body;
    const userAddress = req.userAddress!;

    // Validate title
    if (!title || title.length < 10 || title.length > 200) {
      res.status(400).json({ error: '标题长度需在 10-200 字之间' });
      return;
    }

    // Validate category
    if (category && !VALID_CATEGORIES.includes(category)) {
      res.status(400).json({ error: '无效分类' });
      return;
    }

    // Validate endTime
    const endTimeMs = Number(endTime);
    const now = Date.now();
    if (endTimeMs <= now + 3600000) {
      res.status(400).json({ error: '结束时间至少需要1小时后' });
      return;
    }
    if (endTimeMs > now + 90 * 86400000) {
      res.status(400).json({ error: '结束时间不能超过90天' });
      return;
    }

    const creationFee = 10;

    // Use a single transaction for rate limit check + balance check + creation
    // to prevent race conditions where concurrent requests bypass the rate limit
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Atomic rate limit check inside transaction:
      // First, ensure the ratelimit row exists (upsert)
      const today = Math.floor(now / 86400000);
      await client.query(`
        INSERT INTO market_creation_ratelimit (user_address, daily_count, last_reset_day, total_created)
        VALUES ($1, 0, $2, 0)
        ON CONFLICT (user_address) DO UPDATE
        SET daily_count = CASE
          WHEN market_creation_ratelimit.last_reset_day != $2 THEN 0
          ELSE market_creation_ratelimit.daily_count
        END,
        last_reset_day = $2
      `, [userAddress, today]);

      // Atomically increment daily_count only if under the limit (FOR UPDATE locks the row)
      const rateLimitResult = await client.query(
        `UPDATE market_creation_ratelimit
         SET daily_count = daily_count + 1, total_created = total_created + 1
         WHERE user_address = $1 AND daily_count < 3
         RETURNING *`,
        [userAddress]
      );

      if (rateLimitResult.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(429).json({ error: '今日创建市场数量已达上限 (3/天)' });
        return;
      }

      // Check and deduct balance atomically
      const balanceResult = await client.query(
        'UPDATE balances SET available = available - $1 WHERE user_address = $2 AND available >= $1 RETURNING *',
        [creationFee, userAddress]
      );
      if (balanceResult.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: `余额不足，创建市场需要 ${creationFee} USDT` });
        return;
      }

      // Create market
      const marketId = generateId();
      await client.query(`
        INSERT INTO markets (id, title, description, category, end_time, status, yes_price, no_price, volume, total_liquidity, yes_reserve, no_reserve, created_at)
        VALUES ($1, $2, $3, $4, $5, 'active', 0.5, 0.5, 0, 10000, 10000, 10000, $6)
      `, [marketId, title, description || '', category || 'daily', endTimeMs, now]);

      // Track in user_created_markets
      await client.query(`
        INSERT INTO user_created_markets (id, market_id, creator_address, creation_fee, created_at)
        VALUES ($1, $2, $3, $4, $5)
      `, [generateId(), marketId, userAddress, creationFee, now]);

      // Also create market_resolution entry
      await client.query(
        'INSERT INTO market_resolution (market_id, resolution_type) VALUES ($1, $2)',
        [marketId, 'manual']
      );

      await client.query('COMMIT');

      const marketResult = await db.query('SELECT * FROM markets WHERE id = $1', [marketId]);
      res.json({ market: marketResult.rows[0], fee: creationFee });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/markets/user-created — my created markets
router.get('/user-created', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { rows: markets } = await db.query(`
      SELECT m.*, ucm.creation_fee, ucm.flag_count, ucm.status as ucm_status
      FROM user_created_markets ucm
      JOIN markets m ON m.id = ucm.market_id
      WHERE ucm.creator_address = $1
      ORDER BY ucm.created_at DESC
    `, [req.userAddress]);
    res.json({ markets });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/markets/:id/flag — flag a market
router.post('/:id/flag', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();

    // Use transaction with FOR UPDATE to prevent race conditions on concurrent flags
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const ucmResult = await client.query(
        'SELECT * FROM user_created_markets WHERE market_id = $1 FOR UPDATE',
        [req.params.id]
      );
      const ucm = ucmResult.rows[0] as any;

      if (!ucm) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: '市场不是用户创建的' });
        return;
      }

      // Check if already flagged by this user
      const flaggedBy: string[] = Array.isArray(ucm.flagged_by)
        ? ucm.flagged_by
        : JSON.parse(ucm.flagged_by || '[]');
      if (flaggedBy.includes(req.userAddress!)) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: '你已经举报过了' });
        return;
      }

      flaggedBy.push(req.userAddress!);
      const newFlagCount = ucm.flag_count + 1;
      const newStatus = newFlagCount >= 5 ? 'flagged' : ucm.status;

      await client.query(
        'UPDATE user_created_markets SET flag_count = $1, flagged_by = $2, status = $3 WHERE market_id = $4',
        [newFlagCount, JSON.stringify(flaggedBy), newStatus, req.params.id]
      );

      await client.query('COMMIT');

      res.json({ flagCount: newFlagCount, status: newStatus });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/markets/creation-stats — creation stats
router.get('/creation-stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const today = Math.floor(Date.now() / 86400000);

    const rateLimitResult = await db.query(
      'SELECT * FROM market_creation_ratelimit WHERE user_address = $1',
      [req.userAddress]
    );
    const rateLimit = rateLimitResult.rows[0] as any;

    const dailyCount = rateLimit && rateLimit.last_reset_day === today ? rateLimit.daily_count : 0;
    const totalCreated = rateLimit?.total_created || 0;

    const balanceResult = await db.query('SELECT available FROM balances WHERE user_address = $1', [req.userAddress]);
    const balance = balanceResult.rows[0] as any;

    res.json({
      dailyCount,
      maxPerDay: 3,
      totalCreated,
      creationFee: 10,
      balance: balance?.available || 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
