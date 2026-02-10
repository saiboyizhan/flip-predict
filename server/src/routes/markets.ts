import { Router, Request, Response } from 'express';
import { getDb } from '../db';

const router = Router();

// GET /api/markets
router.get('/', async (req: Request, res: Response) => {
  const { category, search, sort } = req.query;
  const db = getDb();

  let query = 'SELECT * FROM markets WHERE 1=1';
  const params: any[] = [];
  let paramIndex = 1;

  if (category && category !== 'all') {
    query += ` AND category = $${paramIndex++}`;
    params.push(category);
  }

  if (search) {
    query += ` AND (title ILIKE $${paramIndex++} OR description ILIKE $${paramIndex++})`;
    params.push(`%${search}%`, `%${search}%`);
  }

  switch (sort) {
    case 'volume':
      query += ' ORDER BY volume DESC';
      break;
    case 'newest':
      query += ' ORDER BY created_at DESC';
      break;
    case 'ending':
      query += ' ORDER BY end_time ASC';
      break;
    default:
      query += ' ORDER BY volume DESC';
  }

  const { rows: markets } = await db.query(query, params);
  res.json({ markets });
});

// GET /api/markets/stats — platform stats for dashboard
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    const [marketsRes, activeRes, volumeRes, usersRes, todayMarketsRes, todayTradesRes] = await Promise.all([
      db.query('SELECT COUNT(*) as count FROM markets'),
      db.query("SELECT COUNT(*) as count FROM markets WHERE status = 'active' AND end_time > $1", [now]),
      db.query('SELECT COALESCE(SUM(volume), 0) as total FROM markets'),
      db.query('SELECT COUNT(*) as count FROM users'),
      db.query('SELECT COUNT(*) as count FROM markets WHERE created_at >= $1', [todayMs]),
      db.query('SELECT COUNT(*) as count FROM orders WHERE created_at >= $1', [todayMs]),
    ]);

    res.json({
      totalMarkets: parseInt(marketsRes.rows[0].count),
      activeMarkets: parseInt(activeRes.rows[0].count),
      totalVolume: parseFloat(volumeRes.rows[0].total),
      totalUsers: parseInt(usersRes.rows[0].count),
      todayNewMarkets: parseInt(todayMarketsRes.rows[0].count),
      todayTrades: parseInt(todayTradesRes.rows[0].count),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/markets/search?q=keyword — search markets by title and description
router.get('/search', async (req: Request, res: Response) => {
  try {
    const { q, category, limit = '50' } = req.query;
    const db = getDb();

    if (!q || !(q as string).trim()) {
      res.status(400).json({ error: 'Search query "q" is required' });
      return;
    }

    const keyword = `%${(q as string).trim()}%`;
    let sql = `SELECT * FROM markets WHERE (title ILIKE $1 OR description ILIKE $2)`;
    const params: any[] = [keyword, keyword];
    let paramIndex = 3;

    if (category && category !== 'all') {
      sql += ` AND category = $${paramIndex++}`;
      params.push(category);
    }

    sql += ` ORDER BY volume DESC LIMIT $${paramIndex}`;
    params.push(Math.min(parseInt(limit as string) || 50, 100));

    const { rows: markets } = await db.query(sql, params);
    res.json({ markets });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/markets/:id/history
router.get('/:id/history', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const interval = (req.query.interval as string) || '1h';
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const db = getDb();

    const marketResult = await db.query('SELECT id FROM markets WHERE id = $1', [id]);
    if (marketResult.rows.length === 0) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    const intervalMap: Record<string, { groupExpr: string; limit: string }> = {
      '1m': {
        groupExpr: `TO_CHAR(date_trunc('minute', timestamp), 'YYYY-MM-DD HH24:MI:00')`,
        limit: `NOW() - INTERVAL '4 hours'`,
      },
      '5m': {
        groupExpr: `TO_CHAR(date_trunc('hour', timestamp) + INTERVAL '1 min' * (EXTRACT(MINUTE FROM timestamp)::INT / 5 * 5), 'YYYY-MM-DD HH24:MI:00')`,
        limit: `NOW() - INTERVAL '12 hours'`,
      },
      '15m': {
        groupExpr: `TO_CHAR(date_trunc('hour', timestamp) + INTERVAL '1 min' * (EXTRACT(MINUTE FROM timestamp)::INT / 15 * 15), 'YYYY-MM-DD HH24:MI:00')`,
        limit: `NOW() - INTERVAL '2 days'`,
      },
      '30m': {
        groupExpr: `TO_CHAR(date_trunc('hour', timestamp) + INTERVAL '1 min' * (EXTRACT(MINUTE FROM timestamp)::INT / 30 * 30), 'YYYY-MM-DD HH24:MI:00')`,
        limit: `NOW() - INTERVAL '3 days'`,
      },
      '1h': {
        groupExpr: `TO_CHAR(timestamp, 'YYYY-MM-DD HH24:00:00')`,
        limit: `NOW() - INTERVAL '7 days'`,
      },
      '4h': {
        groupExpr: `TO_CHAR(date_trunc('day', timestamp) + INTERVAL '1 hour' * (EXTRACT(HOUR FROM timestamp)::INT / 4 * 4), 'YYYY-MM-DD HH24:MI:00')`,
        limit: `NOW() - INTERVAL '14 days'`,
      },
      '12h': {
        groupExpr: `TO_CHAR(date_trunc('day', timestamp) + INTERVAL '1 hour' * (EXTRACT(HOUR FROM timestamp)::INT / 12 * 12), 'YYYY-MM-DD HH24:MI:00')`,
        limit: `NOW() - INTERVAL '30 days'`,
      },
      '1d': {
        groupExpr: `TO_CHAR(timestamp, 'YYYY-MM-DD')`,
        limit: `NOW() - INTERVAL '60 days'`,
      },
      '1w': {
        groupExpr: `TO_CHAR(timestamp, 'IYYY-IW')`,
        limit: `NOW() - INTERVAL '180 days'`,
      },
    };

    const config = intervalMap[interval] || intervalMap['1h'];

    // Build WHERE conditions
    let whereClause = 'market_id = $1';
    const params: any[] = [id];
    let paramIndex = 2;

    if (from) {
      whereClause += ` AND timestamp >= $${paramIndex++}`;
      params.push(from);
    } else {
      whereClause += ` AND timestamp >= ${config.limit}`;
    }

    if (to) {
      whereClause += ` AND timestamp <= $${paramIndex++}`;
      params.push(to);
    }

    const { rows } = await db.query(`
      SELECT
        ${config.groupExpr} as time_bucket,
        AVG(yes_price) as yes_price,
        AVG(no_price) as no_price,
        SUM(volume) as volume,
        MIN(timestamp) as timestamp
      FROM price_history
      WHERE ${whereClause}
      GROUP BY time_bucket
      ORDER BY time_bucket ASC
      LIMIT 500
    `, params);

    res.json({ history: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/markets/:id
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDb();

  const marketResult = await db.query('SELECT * FROM markets WHERE id = $1', [id]);
  const market = marketResult.rows[0];
  if (!market) {
    res.status(404).json({ error: 'Market not found' });
    return;
  }

  // Get recent orders for this market
  const { rows: recentOrders } = await db.query(
    'SELECT * FROM orders WHERE market_id = $1 ORDER BY created_at DESC LIMIT 20',
    [id]
  );

  res.json({ market, recentOrders });
});

export default router;
