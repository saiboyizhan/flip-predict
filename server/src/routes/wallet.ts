import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';
import crypto from 'crypto';

const router = Router();

// POST /api/wallet/deposit
router.post('/deposit', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userAddress = req.userAddress!;
  const { amount, txHash } = req.body;

  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }

  if (!txHash || typeof txHash !== 'string') {
    res.status(400).json({ error: 'txHash is required' });
    return;
  }

  try {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = Date.now();

    // Record the deposit
    await db.query(
      `INSERT INTO deposits (id, user_address, amount, tx_hash, status, created_at)
       VALUES ($1, $2, $3, $4, 'completed', $5)`,
      [id, userAddress, amount, txHash, now]
    );

    // Add to user's available balance
    await db.query(
      `INSERT INTO balances (user_address, available, locked)
       VALUES ($1, $2, 0)
       ON CONFLICT (user_address) DO UPDATE SET available = balances.available + $3`,
      [userAddress, amount, amount]
    );

    // Fetch updated balance
    const balanceRow = (await db.query(
      'SELECT available, locked FROM balances WHERE user_address = $1',
      [userAddress]
    )).rows[0] as any;

    const available = balanceRow?.available ?? 0;
    const locked = balanceRow?.locked ?? 0;

    res.json({
      success: true,
      balance: {
        available,
        locked,
        total: available + locked,
      },
    });
  } catch (err: any) {
    console.error('Deposit error:', err);
    res.status(500).json({ error: 'Deposit failed' });
  }
});

// POST /api/wallet/withdraw
router.post('/withdraw', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userAddress = req.userAddress!;
  const { amount, toAddress } = req.body;

  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }

  if (!toAddress || typeof toAddress !== 'string') {
    res.status(400).json({ error: 'toAddress is required' });
    return;
  }

  try {
    const db = getDb();

    // Check available balance
    const balanceRow = (await db.query(
      'SELECT available, locked FROM balances WHERE user_address = $1',
      [userAddress]
    )).rows[0] as any;

    const available = balanceRow?.available ?? 0;
    const locked = balanceRow?.locked ?? 0;

    if (amount > available) {
      res.status(400).json({ error: 'Insufficient balance' });
      return;
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    // Record the withdrawal
    await db.query(
      `INSERT INTO withdrawals (id, user_address, amount, to_address, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', $5)`,
      [id, userAddress, amount, toAddress, now]
    );

    // Deduct from available balance
    await db.query(
      'UPDATE balances SET available = available - $1 WHERE user_address = $2',
      [amount, userAddress]
    );

    const newAvailable = available - amount;

    res.json({
      success: true,
      balance: {
        available: newAvailable,
        locked,
        total: newAvailable + locked,
      },
    });
  } catch (err: any) {
    console.error('Withdraw error:', err);
    res.status(500).json({ error: 'Withdraw failed' });
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
