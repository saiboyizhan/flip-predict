import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';

const router = Router();

// GET /api/positions
router.get('/positions', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (err: any) {
    console.error('Positions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/balances
router.get('/balances', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userAddress = req.userAddress!;
    const db = getDb();

    const balanceResult = await db.query('SELECT * FROM balances WHERE user_address = $1', [userAddress]);
    const balance = balanceResult.rows[0] as any;

    if (!balance) {
      res.json({ available: 0, locked: 0 });
      return;
    }

    // Calculate portfolio value from positions (supports multi-option markets)
    const { rows: positions } = await db.query(`
      SELECT p.shares, p.side, p.avg_cost, p.option_id,
             m.yes_price, m.no_price, m.market_type,
             mo.price as option_price
      FROM positions p
      JOIN markets m ON p.market_id = m.id
      LEFT JOIN market_options mo ON p.option_id = mo.id
      WHERE p.user_address = $1
    `, [userAddress]);

    let portfolioValue = 0;
    for (const pos of positions as any[]) {
      let currentPrice: number;
      if (pos.market_type === 'multi' && pos.option_price != null) {
        currentPrice = Number(pos.option_price);
      } else {
        currentPrice = pos.side === 'yes' ? Number(pos.yes_price) : Number(pos.no_price);
      }
      portfolioValue += Number(pos.shares) * currentPrice;
    }

    res.json({
      available: Number(balance.available),
      locked: Number(balance.locked),
      portfolioValue,
      totalValue: Number(balance.available) + Number(balance.locked) + portfolioValue,
    });
  } catch (err: any) {
    console.error('Balances error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/portfolio/:address — user positions (public)
router.get('/portfolio/:address', async (req: Request, res: Response) => {
  try {
    const rawAddress = req.params.address as string;
    if (!ethers.isAddress(rawAddress)) {
      res.status(400).json({ error: 'Invalid address' });
      return;
    }
    const address = rawAddress.toLowerCase();
    const db = getDb();

    const { rows: rawPositions } = await db.query(`
      SELECT p.*, m.title as market_title, m.yes_price, m.no_price, m.status as market_status, m.market_type,
        COALESCE(mo.price, CASE WHEN p.side = 'yes' THEN m.yes_price ELSE m.no_price END) as current_price,
        COALESCE(mo.price, CASE WHEN p.side = 'yes' THEN m.yes_price ELSE m.no_price END) * p.shares as current_value,
        (COALESCE(mo.price, CASE WHEN p.side = 'yes' THEN m.yes_price ELSE m.no_price END) - p.avg_cost) * p.shares as unrealized_pnl
      FROM positions p
      JOIN markets m ON p.market_id = m.id
      LEFT JOIN market_options mo ON p.option_id = mo.id
      WHERE p.user_address = $1
      ORDER BY p.created_at DESC
    `, [address]);

    const positions = (rawPositions as any[]).map(p => ({
      ...p,
      shares: Number(p.shares),
      avg_cost: Number(p.avg_cost),
      yes_price: Number(p.yes_price),
      no_price: Number(p.no_price),
      current_price: Number(p.current_price),
      current_value: Number(p.current_value),
      unrealized_pnl: Number(p.unrealized_pnl),
    }));

    res.json({ positions });
  } catch (err: any) {
    console.error('Portfolio positions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/portfolio/:address/history — trade history from orders table (auth required)
router.get('/portfolio/:address/history', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const address = (req.params.address as string).toLowerCase();
    if (req.userAddress?.toLowerCase() !== address) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const { limit = '50', offset = '0' } = req.query;
    const rawLimit = Number.parseInt(String(limit), 10);
    const rawOffset = Number.parseInt(String(offset), 10);
    const parsedLimit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 50, 200));
    const parsedOffset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);
    const db = getDb();

    const { rows: orders } = await db.query(`
      SELECT o.*, m.title as market_title, m.status as market_status,
             mr.outcome as resolved_outcome
      FROM orders o
      LEFT JOIN markets m ON o.market_id = m.id
      LEFT JOIN market_resolution mr ON o.market_id = mr.market_id
      WHERE o.user_address = $1
      ORDER BY o.created_at DESC
      LIMIT $2 OFFSET $3
    `, [address, parsedLimit, parsedOffset]);

    const countResult = await db.query(
      'SELECT COUNT(*) as total FROM orders WHERE user_address = $1',
      [address]
    );
    const total = parseInt(countResult.rows[0].total);

    // Enrich orders with result/pnl for resolved markets
    const enriched = orders.map((o: any) => {
      const isResolved = o.market_status === 'resolved';
      const isBuy = o.type === 'buy';
      let result: string | null = null;
      let pnl = 0;
      if (isResolved && o.resolved_outcome && isBuy) {
        const won = o.side === o.resolved_outcome;
        result = won ? 'won' : 'lost';
        // If won: payout = shares * 1.0 (full payout) - cost; if lost: cost is lost
        pnl = won ? Number(o.shares || 0) - Number(o.amount || 0) : -Number(o.amount || 0);
      }
      return { ...o, result, pnl };
    });

    res.json({ trades: enriched, total });
  } catch (err: any) {
    console.error('Portfolio history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/portfolio/:address/balance — user balance from balances table (auth required)
router.get('/portfolio/:address/balance', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const address = (req.params.address as string).toLowerCase();
    if (req.userAddress?.toLowerCase() !== address) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const db = getDb();

    const balanceResult = await db.query('SELECT * FROM balances WHERE user_address = $1', [address]);
    const balance = balanceResult.rows[0] as any;

    if (!balance) {
      res.json({ available: 0, locked: 0, portfolioValue: 0, totalValue: 0 });
      return;
    }

    // Calculate portfolio value from positions (supports multi-option markets)
    const { rows: positions } = await db.query(`
      SELECT p.shares, p.side, p.option_id, m.yes_price, m.no_price, m.market_type,
             mo.price as option_price
      FROM positions p
      JOIN markets m ON p.market_id = m.id
      LEFT JOIN market_options mo ON p.option_id = mo.id
      WHERE p.user_address = $1
    `, [address]);

    let portfolioValue = 0;
    for (const pos of positions as any[]) {
      let currentPrice: number;
      if (pos.market_type === 'multi' && pos.option_price != null) {
        currentPrice = Number(pos.option_price);
      } else {
        currentPrice = pos.side === 'yes' ? Number(pos.yes_price) : Number(pos.no_price);
      }
      portfolioValue += Number(pos.shares) * currentPrice;
    }

    res.json({
      available: Number(balance.available),
      locked: Number(balance.locked),
      portfolioValue,
      totalValue: Number(balance.available) + Number(balance.locked) + portfolioValue,
    });
  } catch (err: any) {
    console.error('Portfolio balance error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/portfolio/:address/stats — user statistics (auth required)
router.get('/portfolio/:address/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const address = (req.params.address as string).toLowerCase();
    if (req.userAddress?.toLowerCase() !== address) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
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

    // Positions stats (unrealized PnL) — supports multi-option markets
    const positionStats = await db.query(`
      SELECT
        COUNT(*) as active_positions,
        COALESCE(SUM(
          (COALESCE(mo.price, CASE WHEN p.side = 'yes' THEN m.yes_price ELSE m.no_price END) - p.avg_cost) * p.shares
        ), 0) as unrealized_pnl,
        COALESCE(SUM(
          COALESCE(mo.price, CASE WHEN p.side = 'yes' THEN m.yes_price ELSE m.no_price END) * p.shares
        ), 0) as portfolio_value
      FROM positions p
      JOIN markets m ON p.market_id = m.id
      LEFT JOIN market_options mo ON p.option_id = mo.id
      WHERE p.user_address = $1
    `, [address]);

    // Win rate and total profit from settlement logs (positions are cleaned up after settlement).
    const winStats = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE action IN ('settle_winner', 'settle_loser')) as resolved_trades,
        COUNT(*) FILTER (WHERE action = 'settle_winner') as winning_trades,
        COALESCE(SUM(amount) FILTER (WHERE action = 'settle_winner'), 0) as total_won
      FROM settlement_log
      WHERE user_address = $1
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
        totalProfit: parseFloat(wins.total_won) || 0,
      },
    });
  } catch (err: any) {
    console.error('Portfolio stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
