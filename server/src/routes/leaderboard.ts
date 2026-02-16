import { Router, Request, Response } from 'express';
import { getDb } from '../db';

const router = Router();

// GET /api/leaderboard — user leaderboard by net profit
// Supports ?period=week|month (default: all time)
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const period = req.query.period as string | undefined;

    // P2-7 fix: Calculate time filter based on period
    // SAFETY: timeFilter and settlementTimeFilter are hardcoded based on strict equality checks
    // against whitelisted values ('week', 'month'). No user input is directly interpolated.
    let timeFilter = '';
    const params: any[] = [];

    if (period === 'week') {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      timeFilter = 'AND o.created_at >= $1';
      params.push(weekAgo);
    } else if (period === 'month') {
      const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      timeFilter = 'AND o.created_at >= $1';
      params.push(monthAgo);
    }
    // All other values (including undefined, null, or any string not 'week'/'month') result in empty filter

    const settlementTimeFilter = period === 'week' || period === 'month'
      ? 'AND s.created_at >= $1'
      : '';

    // Net profit only counts orders in resolved markets to avoid showing
    // unrealized losses on open positions as actual losses.
    const result = await db.query(`
      SELECT
        o.user_address,
        COALESCE(SUM(o.amount), 0) AS total_wagered,
        COALESCE(w.total_won, 0) AS total_won,
        COALESCE(w.win_count, 0) AS win_count,
        COUNT(o.id) AS total_orders,
        COALESCE(w.total_won, 0) - COALESCE(resolved_spend.spent, 0) AS net_profit,
        CASE WHEN COALESCE(r.resolved_count, 0) > 0
          THEN ROUND((COALESCE(w.win_count, 0)::numeric / r.resolved_count::numeric) * 100, 1)
          ELSE 0
        END AS win_rate
      FROM orders o
      LEFT JOIN (
        SELECT
          s.user_address,
          SUM(s.amount) AS total_won,
          COUNT(s.id) AS win_count
        FROM settlement_log s
        WHERE s.action = 'settle_winner'
        ${settlementTimeFilter}
        GROUP BY s.user_address
      ) w ON o.user_address = w.user_address
      LEFT JOIN (
        SELECT
          s.user_address,
          COUNT(s.id) AS resolved_count
        FROM settlement_log s
        WHERE s.action IN ('settle_winner', 'settle_loser')
        ${settlementTimeFilter}
        GROUP BY s.user_address
      ) r ON o.user_address = r.user_address
      LEFT JOIN (
        SELECT
          ord.user_address,
          SUM(ord.amount) AS spent
        FROM orders ord
        JOIN markets m ON m.id = ord.market_id
        WHERE ord.status = 'filled' AND ord.type = 'buy'
          AND m.status IN ('resolved', 'closed')
        GROUP BY ord.user_address
      ) resolved_spend ON o.user_address = resolved_spend.user_address
      WHERE o.status = 'filled'
      ${timeFilter}
      GROUP BY o.user_address, w.total_won, w.win_count, r.resolved_count, resolved_spend.spent
      ORDER BY net_profit DESC
      LIMIT 50
    `, params);

    const leaderboard = result.rows.map((row: any, index: number) => {
      const addr = row.user_address || '';
      const nickname = addr.length > 10
        ? addr.slice(0, 6) + '...' + addr.slice(-4)
        : addr;

      return {
        rank: index + 1,
        address: addr,
        nickname,
        totalWagered: parseFloat(row.total_wagered) || 0,
        totalWon: parseFloat(row.total_won) || 0,
        winRate: parseFloat(row.win_rate) || 0,
        netProfit: parseFloat(row.net_profit) || 0,
        bestStreak: 0,
      };
    });

    res.json({ leaderboard });
  } catch (err: any) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
