import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { adminMiddleware } from './middleware/admin';
import { getDb } from '../db';
import { settleMarketPositions } from '../engine/keeper';

const router = Router();

// IMPORTANT: Specific named routes MUST come before parameterized routes
// to avoid "resolved" being captured as a :marketId parameter.

// GET /api/settlement/resolved — list resolved/pending_resolution markets
router.get('/resolved', async (_req: Request, res: Response) => {
  const db = getDb();
  const { rows: markets } = await db.query(
    "SELECT m.*, mr.outcome, mr.resolved_price, mr.resolved_at FROM markets m LEFT JOIN market_resolution mr ON m.id = mr.market_id WHERE m.status IN ('resolved', 'pending_resolution') ORDER BY m.end_time DESC"
  );
  res.json({ markets });
});

// GET /api/settlement/:marketId — get settlement info (no auth required)
router.get('/:marketId', async (req: Request, res: Response) => {
  const { marketId } = req.params;
  const db = getDb();

  const resolutionResult = await db.query(
    'SELECT * FROM market_resolution WHERE market_id = $1',
    [marketId]
  );

  const { rows: logs } = await db.query(
    'SELECT * FROM settlement_log WHERE market_id = $1 ORDER BY created_at DESC',
    [marketId]
  );

  res.json({ resolution: resolutionResult.rows[0] || null, logs });
});

// POST /api/settlement/:marketId/resolve — admin manual resolution (auth + admin required)
router.post('/:marketId/resolve', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  const marketId = req.params.marketId as string;
  const { outcome } = req.body;
  const userAddress = req.userAddress!;
  const db = getDb();

  if (!outcome || (outcome !== 'yes' && outcome !== 'no')) {
    res.status(400).json({ error: 'outcome must be "yes" or "no"' });
    return;
  }

  const marketResult = await db.query('SELECT * FROM markets WHERE id = $1', [marketId]);
  const market = marketResult.rows[0] as any;
  if (!market) {
    res.status(404).json({ error: 'Market not found' });
    return;
  }

  if (market.status !== 'pending_resolution') {
    res.status(400).json({ error: `Market status is "${market.status}", expected "pending_resolution"` });
    return;
  }

  const now = Date.now();

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await client.query("UPDATE markets SET status = 'resolved' WHERE id = $1", [marketId]);

    const existingResult = await client.query('SELECT * FROM market_resolution WHERE market_id = $1', [marketId]);
    if (existingResult.rows.length > 0) {
      await client.query(`
        UPDATE market_resolution
        SET outcome = $1, resolved_at = $2, resolved_by = $3
        WHERE market_id = $4
      `, [outcome, now, userAddress, marketId]);
    } else {
      await client.query(`
        INSERT INTO market_resolution (market_id, resolution_type, outcome, resolved_at, resolved_by)
        VALUES ($1, 'manual', $2, $3, $4)
      `, [marketId, outcome, now, userAddress]);
    }

    await settleMarketPositions(client, marketId, outcome);

    await client.query(`
      INSERT INTO settlement_log (id, market_id, action, user_address, details, created_at)
      VALUES ($1, $2, 'manual_resolve', $3, $4, $5)
    `, [randomUUID(), marketId, userAddress, JSON.stringify({ outcome }), now]);

    await client.query('COMMIT');
  } catch (txErr) {
    await client.query('ROLLBACK');
    throw txErr;
  } finally {
    client.release();
  }

  res.json({ success: true, outcome, marketId });
});

// POST /api/settlement/:marketId/claim — user claims reward (auth required)
router.post('/:marketId/claim', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { marketId } = req.params;
  const userAddress = req.userAddress!;
  const db = getDb();

  const marketResult = await db.query('SELECT * FROM markets WHERE id = $1', [marketId]);
  const market = marketResult.rows[0] as any;
  if (!market) {
    res.status(404).json({ error: 'Market not found' });
    return;
  }
  if (market.status !== 'resolved') {
    res.status(400).json({ error: 'Market is not resolved yet' });
    return;
  }

  const resolutionResult = await db.query(
    'SELECT * FROM market_resolution WHERE market_id = $1',
    [marketId]
  );
  const resolution = resolutionResult.rows[0] as any;
  if (!resolution || !resolution.outcome) {
    res.status(400).json({ error: 'No resolution found' });
    return;
  }

  // Check if user already has a settle_winner log entry (already settled during resolution)
  const settleLogResult = await db.query(
    "SELECT * FROM settlement_log WHERE market_id = $1 AND user_address = $2 AND action = 'settle_winner'",
    [marketId, userAddress]
  );
  const settleLog = settleLogResult.rows[0] as any;
  if (settleLog) {
    // Already settled by keeper/admin during resolution, no manual claim needed
    res.status(400).json({ error: 'Already settled' });
    return;
  }

  // Check if already claimed via this endpoint
  const alreadyClaimedResult = await db.query(
    "SELECT * FROM settlement_log WHERE market_id = $1 AND user_address = $2 AND action = 'claimed'",
    [marketId, userAddress]
  );
  if (alreadyClaimedResult.rows.length > 0) {
    res.status(400).json({ error: 'Already claimed' });
    return;
  }

  // User must hold the winning side position
  const positionResult = await db.query(
    'SELECT * FROM positions WHERE market_id = $1 AND user_address = $2 AND side = $3',
    [marketId, userAddress, resolution.outcome]
  );
  const position = positionResult.rows[0] as any;
  if (!position || position.shares <= 0) {
    res.status(400).json({ error: 'No winning position found' });
    return;
  }

  // Calculate proper payout: principal + proportional share of loser pool
  const winningSide = resolution.outcome;
  const allPositions = await db.query('SELECT * FROM positions WHERE market_id = $1', [marketId]);
  const winners = allPositions.rows.filter((p: any) => p.side === winningSide);
  const losers = allPositions.rows.filter((p: any) => p.side !== winningSide);

  const totalWinnerShares = winners.reduce((sum: number, p: any) => sum + p.shares, 0);
  const totalLoserValue = losers.reduce((sum: number, p: any) => sum + p.shares * p.avg_cost, 0);

  const principal = position.shares * position.avg_cost;
  const bonus = totalWinnerShares > 0 ? (position.shares / totalWinnerShares) * totalLoserValue : 0;
  const claimAmount = principal + bonus;

  const now = Date.now();
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Credit user balance
    await client.query(
      'UPDATE balances SET available = available + $1 WHERE user_address = $2',
      [claimAmount, userAddress]
    );

    // Log the claim
    await client.query(`
      INSERT INTO settlement_log (id, market_id, action, user_address, amount, details, created_at)
      VALUES ($1, $2, 'claimed', $3, $4, $5, $6)
    `, [randomUUID(), marketId, userAddress, claimAmount, JSON.stringify({
      side: resolution.outcome, shares: position.shares, principal, bonus
    }), now]);

    await client.query('COMMIT');
  } catch (txErr) {
    await client.query('ROLLBACK');
    throw txErr;
  } finally {
    client.release();
  }

  res.json({ success: true, amount: claimAmount, marketId });
});

export default router;
