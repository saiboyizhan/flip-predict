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
          ${timeFilter ? 'AND ord.created_at >= $1' : ''}
        GROUP BY ord.user_address
      ) resolved_spend ON o.user_address = resolved_spend.user_address
      WHERE o.status = 'filled'
      ${timeFilter}
      GROUP BY o.user_address, w.total_won, w.win_count, r.resolved_count, resolved_spend.spent
      ORDER BY net_profit DESC
      LIMIT 50
    `, params);

    // Fetch active positions for all users in the leaderboard
    const userAddresses = result.rows.map((r: any) => r.user_address);
    let activePositionsMap: Record<string, { count: number; value: number }> = {};
    let bestStreakMap: Record<string, number> = {};
    if (userAddresses.length > 0) {
      const posRes = await db.query(`
        SELECT user_address,
               COUNT(*) as active_positions_count,
               COALESCE(SUM(shares * avg_cost), 0) as active_positions_value
        FROM positions
        WHERE user_address = ANY($1)
        GROUP BY user_address
      `, [userAddresses]);
      for (const row of posRes.rows as any[]) {
        activePositionsMap[row.user_address] = {
          count: Number(row.active_positions_count) || 0,
          value: Number(row.active_positions_value) || 0,
        };
      }

      // Calculate best win streak per user from settlement_log.
      // Groups consecutive same-action rows per user using the
      // classic gaps-and-islands technique, then picks the longest
      // run of 'settle_winner' for each user.
      const streakRes = await db.query(`
        WITH numbered AS (
          SELECT user_address, action,
                 ROW_NUMBER() OVER (PARTITION BY user_address ORDER BY created_at)
                   - ROW_NUMBER() OVER (PARTITION BY user_address, action ORDER BY created_at) AS grp
          FROM settlement_log
          WHERE user_address = ANY($1)
            AND action IN ('settle_winner', 'settle_loser')
        )
        SELECT user_address, MAX(streak) AS best_streak
        FROM (
          SELECT user_address, COUNT(*) AS streak
          FROM numbered
          WHERE action = 'settle_winner'
          GROUP BY user_address, grp
        ) streaks
        GROUP BY user_address
      `, [userAddresses]);
      for (const row of streakRes.rows as any[]) {
        bestStreakMap[row.user_address] = Number(row.best_streak) || 0;
      }
    }

    const leaderboard = result.rows.map((row: any, index: number) => {
      const addr = row.user_address || '';
      const nickname = addr.length > 10
        ? addr.slice(0, 6) + '...' + addr.slice(-4)
        : addr;
      const activePos = activePositionsMap[addr] || { count: 0, value: 0 };

      return {
        rank: index + 1,
        address: addr,
        nickname,
        totalWagered: parseFloat(row.total_wagered) || 0,
        totalWon: parseFloat(row.total_won) || 0,
        winRate: parseFloat(row.win_rate) || 0,
        netProfit: parseFloat(row.net_profit) || 0,
        bestStreak: bestStreakMap[addr] || 0,
        activePositionsCount: activePos.count,
        activePositionsValue: activePos.value,
      };
    });

    res.json({ leaderboard });
  } catch (err: any) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
