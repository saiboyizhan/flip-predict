import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import { JWT_SECRET, ADMIN_ADDRESSES } from '../config';
import { getDb } from '../db';

function extractAdminAddress(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { address?: unknown };
    if (typeof decoded.address !== 'string' || !ethers.isAddress(decoded.address)) return null;
    const address = decoded.address.toLowerCase();
    return ADMIN_ADDRESSES.has(address) ? address : null;
  } catch {
    return null;
  }
}

const router = Router();

function parseTimestampFilter(value: unknown): string | null {
  if (value == null || value === '') return null;
  const asString = String(value).trim();
  if (!asString) return null;
  const date = new Date(asString);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

// GET /api/markets
router.get('/', async (req: Request, res: Response) => {
  try {
    const { category, search, sort } = req.query;
    const db = getDb();

    const { status } = req.query;
    let query = 'SELECT * FROM markets WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    // Allow admin to filter by status (e.g. ?status=pending_approval)
    // Non-admin users cannot query pending_approval or rejected markets
    const isProtectedStatus = status === 'pending_approval' || status === 'rejected';
    if (status && !isProtectedStatus) {
      query += ` AND status = $${paramIndex++}`;
      params.push(status);
    } else if (isProtectedStatus) {
      const adminAddr = extractAdminAddress(req);
      if (adminAddr) {
        query += ` AND status = $${paramIndex++}`;
        params.push(status);
      } else {
        // Non-admin: ignore the protected status filter, default to public listing
        query += ` AND status NOT IN ('pending_approval', 'rejected')`;
      }
    } else {
      // Public listing: exclude pending_approval and rejected markets
      query += ` AND status NOT IN ('pending_approval', 'rejected')`;
    }

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

    query += ' LIMIT 200';

    const { rows: markets } = await db.query(query, params);
    // Normalization guard: derive no_price from yes_price to guarantee sum === 1
    for (const m of markets) {
      if (m.market_type !== 'multi') {
        m.no_price = 1 - m.yes_price;
      }
    }
    res.json({ markets });
  } catch (err: any) {
    console.error('Market list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
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
    console.error('Market stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/markets/search?q=keyword — search markets by title and description
router.get('/search', async (req: Request, res: Response) => {
  try {
    const { q, category, limit = '50' } = req.query;
    const rawLimit = Number.parseInt(String(limit), 10);
    const parsedLimit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 50, 100));
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
    params.push(parsedLimit);

    const { rows: markets } = await db.query(sql, params);
    res.json({ markets });
  } catch (err: any) {
    console.error('Market search error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/markets/:id/activity — recent trading activity for a market
router.get('/:id/activity', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();

    // Verify market exists
    const marketResult = await db.query('SELECT id FROM markets WHERE id = $1', [id]);
    if (marketResult.rows.length === 0) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    const { rows: orders } = await db.query(`
      SELECT o.id, o.user_address, o.side, o.type, o.amount, o.shares, o.price, o.status, o.created_at, o.option_id,
             mo.label as option_label
      FROM orders o
      LEFT JOIN market_options mo ON o.option_id = mo.id
      WHERE o.market_id = $1 AND o.status = 'filled'
      ORDER BY o.created_at DESC
      LIMIT 20
    `, [id]);

    const activity = orders.map((o: any) => ({
      id: o.id,
      userAddress: o.user_address,
      side: o.side,
      type: o.type,
      amount: Number(o.amount) || 0,
      shares: Number(o.shares) || 0,
      price: Number(o.price) || 0,
      optionLabel: o.option_label || null,
      createdAt: Number(o.created_at) || Date.now(),
    }));

    res.json({ activity });
  } catch (err: any) {
    console.error('Market activity error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/markets/:id/related — related markets in the same category
router.get('/:id/related', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();

    // Get the market to find its category
    const marketResult = await db.query('SELECT id, category FROM markets WHERE id = $1', [id]);
    if (marketResult.rows.length === 0) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    const market = marketResult.rows[0] as any;

    // Find active markets in the same category, excluding this one, ordered by volume
    const { rows: related } = await db.query(`
      SELECT * FROM markets
      WHERE category = $1 AND id != $2 AND status = 'active'
      ORDER BY volume DESC
      LIMIT 4
    `, [market.category, id]);

    // If we don't have enough from same category, pad with other active markets
    let markets = related;
    if (markets.length < 4) {
      const existing = [id, ...markets.map((m: any) => m.id)];
      const placeholders = existing.map((_: string, i: number) => `$${i + 1}`).join(',');
      const { rows: extra } = await db.query(`
        SELECT * FROM markets
        WHERE id NOT IN (${placeholders}) AND status = 'active'
        ORDER BY volume DESC
        LIMIT $${existing.length + 1}
      `, [...existing, 4 - markets.length]);
      markets = [...markets, ...extra];
    }

    for (const m of markets) {
      if (m.market_type !== 'multi') m.no_price = 1 - m.yes_price;
    }
    res.json({ markets });
  } catch (err: any) {
    console.error('Related markets error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/markets/:id/history
router.get('/:id/history', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const interval = (req.query.interval as string) || '1h';
    const rawFrom = req.query.from as string | undefined;
    const rawTo = req.query.to as string | undefined;
    const from = parseTimestampFilter(rawFrom);
    const to = parseTimestampFilter(rawTo);
    const db = getDb();

    if (rawFrom != null && from === null) {
      res.status(400).json({ error: 'Invalid "from" timestamp' });
      return;
    }
    if (rawTo != null && to === null) {
      res.status(400).json({ error: 'Invalid "to" timestamp' });
      return;
    }

    const marketResult = await db.query('SELECT id, market_type FROM markets WHERE id = $1', [id]);
    if (marketResult.rows.length === 0) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    const marketRow = marketResult.rows[0];

    // For multi-option markets, return option_price_history instead
    if (marketRow.market_type === 'multi') {
      const { rows: optionHistory } = await db.query(`
        SELECT oph.option_id, oph.price, oph.volume, oph.timestamp,
               mo.label, mo.color, mo.option_index
        FROM option_price_history oph
        JOIN market_options mo ON oph.option_id = mo.id
        WHERE oph.market_id = $1
        ORDER BY oph.timestamp ASC
        LIMIT 2000
      `, [id]);
      res.json({ history: optionHistory, marketType: 'multi' });
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
    console.error('Market history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/markets/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
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

    // For multi-option markets, also return options
    let options: any[] = [];
    if (market.market_type === 'multi') {
      const { rows } = await db.query(
        'SELECT * FROM market_options WHERE market_id = $1 ORDER BY option_index ASC',
        [id]
      );
      options = rows;
    }

    // Normalization guard for binary markets
    if (market.market_type !== 'multi') {
      market.no_price = 1 - market.yes_price;
    }
    res.json({ market, recentOrders, options });
  } catch (err: any) {
    console.error('Market detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
