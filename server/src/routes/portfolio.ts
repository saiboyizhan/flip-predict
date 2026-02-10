import { Router, Request, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';

const router = Router();

// GET /api/positions
router.get('/positions', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userAddress = req.userAddress!;
  const db = getDb();

  const { rows: positions } = await db.query(`
    SELECT p.*, m.title as market_title, m.yes_price, m.no_price, m.status as market_status
    FROM positions p
    JOIN markets m ON p.market_id = m.id
    WHERE p.user_address = $1
    ORDER BY p.created_at DESC
  `, [userAddress]);

  res.json({ positions });
});

// GET /api/balances
router.get('/balances', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userAddress = req.userAddress!;
  const db = getDb();

  const balanceResult = await db.query('SELECT * FROM balances WHERE user_address = $1', [userAddress]);
  const balance = balanceResult.rows[0] as any;

  if (!balance) {
    res.json({ available: 0, locked: 0 });
    return;
  }

  // Calculate portfolio value from positions
  const { rows: positions } = await db.query(`
    SELECT p.shares, p.side, p.avg_cost, m.yes_price, m.no_price
    FROM positions p
    JOIN markets m ON p.market_id = m.id
    WHERE p.user_address = $1
  `, [userAddress]);

  let portfolioValue = 0;
  for (const pos of positions as any[]) {
    const currentPrice = pos.side === 'yes' ? pos.yes_price : pos.no_price;
    portfolioValue += pos.shares * currentPrice;
  }

  res.json({
    available: balance.available,
    locked: balance.locked,
    portfolioValue,
    totalValue: balance.available + balance.locked + portfolioValue,
  });
});

// GET /api/portfolio/:address — user positions
router.get('/portfolio/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const db = getDb();

    const { rows: positions } = await db.query(`
      SELECT p.*, m.title as market_title, m.yes_price, m.no_price, m.status as market_status,
        CASE WHEN p.side = 'yes' THEN m.yes_price ELSE m.no_price END as current_price,
        (CASE WHEN p.side = 'yes' THEN m.yes_price ELSE m.no_price END) * p.shares as current_value,
        ((CASE WHEN p.side = 'yes' THEN m.yes_price ELSE m.no_price END) - p.avg_cost) * p.shares as unrealized_pnl
      FROM positions p
      JOIN markets m ON p.market_id = m.id
      WHERE p.user_address = $1
      ORDER BY p.created_at DESC
    `, [address]);

    res.json({ positions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/portfolio/:address/history — trade history from orders table
router.get('/portfolio/:address/history', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { limit = '50', offset = '0' } = req.query;
    const db = getDb();

    const { rows: orders } = await db.query(`
      SELECT o.*, m.title as market_title
      FROM orders o
      LEFT JOIN markets m ON o.market_id = m.id
      WHERE o.user_address = $1
      ORDER BY o.created_at DESC
      LIMIT $2 OFFSET $3
    `, [address, Math.min(parseInt(limit as string) || 50, 200), parseInt(offset as string) || 0]);

    const countResult = await db.query(
      'SELECT COUNT(*) as total FROM orders WHERE user_address = $1',
      [address]
    );
    const total = parseInt(countResult.rows[0].total);

    res.json({ orders, trades: orders, total });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/portfolio/:address/balance — user balance from balances table
router.get('/portfolio/:address/balance', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const db = getDb();

    const balanceResult = await db.query('SELECT * FROM balances WHERE user_address = $1', [address]);
    const balance = balanceResult.rows[0] as any;

    if (!balance) {
      res.json({ available: 0, locked: 0, portfolioValue: 0, totalValue: 0 });
      return;
    }

    // Calculate portfolio value from positions
    const { rows: positions } = await db.query(`
      SELECT p.shares, p.side, m.yes_price, m.no_price
      FROM positions p
      JOIN markets m ON p.market_id = m.id
      WHERE p.user_address = $1
    `, [address]);

    let portfolioValue = 0;
    for (const pos of positions as any[]) {
      const currentPrice = pos.side === 'yes' ? pos.yes_price : pos.no_price;
      portfolioValue += pos.shares * currentPrice;
    }

    res.json({
      available: balance.available,
      locked: balance.locked,
      portfolioValue,
      totalValue: balance.available + balance.locked + portfolioValue,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/portfolio/:address/stats — user statistics (total PnL, win rate, etc.)
router.get('/portfolio/:address/stats', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const db = getDb();

    // Total trades count and volume
    const tradeStats = await db.query(`
      SELECT
        COUNT(*) as total_trades,
        COALESCE(SUM(amount), 0) as total_volume,
        COALESCE(SUM(CASE WHEN type = 'buy' THEN amount ELSE 0 END), 0) as total_bought,
        COALESCE(SUM(CASE WHEN type = 'sell' THEN amount ELSE 0 END), 0) as total_sold
      FROM orders
      WHERE user_address = $1
    `, [address]);

    // Positions stats (unrealized PnL)
    const positionStats = await db.query(`
      SELECT
        COUNT(*) as active_positions,
        COALESCE(SUM(
          ((CASE WHEN p.side = 'yes' THEN m.yes_price ELSE m.no_price END) - p.avg_cost) * p.shares
        ), 0) as unrealized_pnl,
        COALESCE(SUM(
          (CASE WHEN p.side = 'yes' THEN m.yes_price ELSE m.no_price END) * p.shares
        ), 0) as portfolio_value
      FROM positions p
      JOIN markets m ON p.market_id = m.id
      WHERE p.user_address = $1
    `, [address]);

    // Win rate from resolved positions (positions in resolved markets)
    const winStats = await db.query(`
      SELECT
        COUNT(*) as resolved_trades,
        COALESCE(SUM(CASE
          WHEN (p.side = mr.outcome) THEN 1 ELSE 0
        END), 0) as winning_trades
      FROM positions p
      JOIN market_resolution mr ON p.market_id = mr.market_id
      WHERE p.user_address = $1 AND mr.outcome IS NOT NULL
    `, [address]);

    const stats = tradeStats.rows[0] as any;
    const posStats = positionStats.rows[0] as any;
    const wins = winStats.rows[0] as any;

    const totalTrades = parseInt(stats.total_trades) || 0;
    const resolvedTrades = parseInt(wins.resolved_trades) || 0;
    const winningTrades = parseInt(wins.winning_trades) || 0;
    const winRate = resolvedTrades > 0 ? winningTrades / resolvedTrades : 0;

    res.json({
      stats: {
        totalTrades,
        totalVolume: parseFloat(stats.total_volume) || 0,
        totalBought: parseFloat(stats.total_bought) || 0,
        totalSold: parseFloat(stats.total_sold) || 0,
        activePositions: parseInt(posStats.active_positions) || 0,
        unrealizedPnl: parseFloat(posStats.unrealized_pnl) || 0,
        portfolioValue: parseFloat(posStats.portfolio_value) || 0,
        resolvedTrades,
        winningTrades,
        winRate,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
