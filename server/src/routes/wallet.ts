import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';
import crypto from 'crypto';

const router = Router();

// Constants for deposit validation
const MAX_DEPOSIT_AMOUNT = 1_000_000;
const MAX_DEPOSITS_PER_DAY = 50;
const MAX_WITHDRAWAL_AMOUNT = 1_000_000;

// POST /api/wallet/deposit
router.post('/deposit', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userAddress = req.userAddress!;
  const { amount, txHash } = req.body;

  // --- Bug 3 fix: Amount validation (> 0, reasonable max) ---
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }

  if (amount > MAX_DEPOSIT_AMOUNT) {
    res.status(400).json({ error: `amount must not exceed ${MAX_DEPOSIT_AMOUNT}` });
    return;
  }

  if (!txHash || typeof txHash !== 'string') {
    res.status(400).json({ error: 'txHash is required' });
    return;
  }

  const pool = getDb();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // --- Bug 3 fix: Duplicate txHash check ---
    const existingTx = await client.query(
      'SELECT id FROM deposits WHERE tx_hash = $1',
      [txHash]
    );
    if (existingTx.rows.length > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'This transaction hash has already been used' });
      return;
    }

    // --- Bug 3 fix: Rate limiting - max deposits per day per user ---
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentDeposits = await client.query(
      'SELECT COUNT(*) as cnt FROM deposits WHERE user_address = $1 AND created_at > $2',
      [userAddress, oneDayAgo]
    );
    if (parseInt(recentDeposits.rows[0].cnt, 10) >= MAX_DEPOSITS_PER_DAY) {
      await client.query('ROLLBACK');
      res.status(429).json({ error: `Maximum ${MAX_DEPOSITS_PER_DAY} deposits per day exceeded` });
      return;
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    // --- Bug 4 fix: INSERT deposit + UPDATE balance in a single transaction ---
    // Record the deposit
    await client.query(
      `INSERT INTO deposits (id, user_address, amount, tx_hash, status, created_at)
       VALUES ($1, $2, $3, $4, 'completed', $5)`,
      [id, userAddress, amount, txHash, now]
    );

    // Add to user's available balance
    await client.query(
      `INSERT INTO balances (user_address, available, locked)
       VALUES ($1, $2, 0)
       ON CONFLICT (user_address) DO UPDATE SET available = balances.available + $3`,
      [userAddress, amount, amount]
    );

    // Fetch updated balance
    const balanceRow = (await client.query(
      'SELECT available, locked FROM balances WHERE user_address = $1',
      [userAddress]
    )).rows[0] as any;

    const available = balanceRow?.available ?? 0;
    const locked = balanceRow?.locked ?? 0;

    await client.query('COMMIT');

    res.json({
      success: true,
      balance: {
        available,
        locked,
        total: available + locked,
      },
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Deposit error:', err);
    res.status(500).json({ error: 'Deposit failed' });
  } finally {
    client.release();
  }
});

// POST /api/wallet/withdraw
router.post('/withdraw', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userAddress = req.userAddress!;
  const { amount, toAddress } = req.body;

  // --- Bug 5 fix: Validate amount > 0 with stricter checks ---
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }

  if (amount > MAX_WITHDRAWAL_AMOUNT) {
    res.status(400).json({ error: `amount must not exceed ${MAX_WITHDRAWAL_AMOUNT}` });
    return;
  }

  if (!toAddress || typeof toAddress !== 'string') {
    res.status(400).json({ error: 'toAddress is required' });
    return;
  }

  const pool = getDb();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // --- Bug 5 fix: SELECT ... FOR UPDATE to prevent concurrent reads (double-spend) ---
    const balanceRow = (await client.query(
      'SELECT available, locked FROM balances WHERE user_address = $1 FOR UPDATE',
      [userAddress]
    )).rows[0] as any;

    const available = balanceRow?.available ?? 0;
    const locked = balanceRow?.locked ?? 0;

    if (amount > available) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Insufficient balance' });
      return;
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    // --- Bug 5 fix: All writes in a single transaction ---
    // Record the withdrawal
    await client.query(
      `INSERT INTO withdrawals (id, user_address, amount, to_address, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', $5)`,
      [id, userAddress, amount, toAddress, now]
    );

    // Deduct from available balance
    await client.query(
      'UPDATE balances SET available = available - $1 WHERE user_address = $2',
      [amount, userAddress]
    );

    const newAvailable = available - amount;

    await client.query('COMMIT');

    res.json({
      success: true,
      balance: {
        available: newAvailable,
        locked,
        total: newAvailable + locked,
      },
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Withdraw error:', err);
    res.status(500).json({ error: 'Withdraw failed' });
  } finally {
    client.release();
  }
});

// GET /api/wallet/transactions
router.get('/transactions', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userAddress = req.userAddress!;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = parseInt(req.query.offset as string) || 0;

  try {
    const db = getDb();

    // Fetch deposits
    const deposits = (await db.query(
      `SELECT id, amount, tx_hash, status, created_at, 'deposit' as type
       FROM deposits WHERE user_address = $1
       ORDER BY created_at DESC`,
      [userAddress]
    )).rows;

    // Fetch withdrawals
    const withdrawals = (await db.query(
      `SELECT id, amount, to_address, status, created_at, 'withdraw' as type
       FROM withdrawals WHERE user_address = $1
       ORDER BY created_at DESC`,
      [userAddress]
    )).rows;

    // Combine and sort by created_at descending
    const all = [...deposits, ...withdrawals]
      .sort((a: any, b: any) => b.created_at - a.created_at)
      .slice(offset, offset + limit);

    res.json({
      transactions: all,
      total: deposits.length + withdrawals.length,
    });
  } catch (err: any) {
    console.error('Transactions error:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

export default router;
