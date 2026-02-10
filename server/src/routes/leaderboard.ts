import { Router, Request, Response } from 'express';
import { getDb } from '../db';

const router = Router();

// GET /api/leaderboard — user leaderboard by net profit
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDb();

    const result = await db.query(`
      SELECT
        o.user_address,
        COALESCE(SUM(o.amount), 0) AS total_wagered,
        COALESCE(w.total_won, 0) AS total_won,
        COALESCE(w.win_count, 0) AS win_count,
        COUNT(o.id) AS total_orders,
        COALESCE(w.total_won, 0) - COALESCE(SUM(o.amount), 0) AS net_profit,
        CASE WHEN COUNT(o.id) > 0
          THEN ROUND((COALESCE(w.win_count, 0)::numeric / COUNT(o.id)::numeric) * 100, 1)
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
        GROUP BY s.user_address
      ) w ON o.user_address = w.user_address
      WHERE o.status = 'filled'
      GROUP BY o.user_address, w.total_won, w.win_count
      ORDER BY net_profit DESC
      LIMIT 50
    `);

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
    res.status(500).json({ error: err.message });
  }
});

export default router;
