import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';
import crypto from 'crypto';
import { ethers } from 'ethers';

const router = Router();

// Constants for deposit validation
const MAX_DEPOSIT_AMOUNT = 1_000_000;
const MAX_DEPOSITS_PER_DAY = 50;
const MAX_WITHDRAWAL_AMOUNT = 1_000_000;
const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;
const DEFAULT_BSC_RPC = 'https://bsc-dataseed.bnbchain.org';
const DEPOSIT_RPC_URL = process.env.DEPOSIT_RPC_URL || process.env.BSC_RPC_URL || DEFAULT_BSC_RPC;

let depositProvider: ethers.JsonRpcProvider | null = null;

function getDepositProvider(): ethers.JsonRpcProvider {
  if (!depositProvider) {
    depositProvider = new ethers.JsonRpcProvider(DEPOSIT_RPC_URL);
  }
  return depositProvider;
}

function getDepositReceiverAddress(): string | null {
  const configured = process.env.DEPOSIT_RECEIVER_ADDRESS;
  if (!configured || !ethers.isAddress(configured)) {
    return null;
  }
  return configured.toLowerCase();
}

async function verifyDepositTransaction(
  txHash: string,
  userAddress: string,
  amount: number
): Promise<{ ok: true } | { ok: false; statusCode: number; error: string }> {
  const receiver = getDepositReceiverAddress();
  if (!receiver) {
    return { ok: false, statusCode: 503, error: 'Deposit verification is not configured' };
  }

  const provider = getDepositProvider();

  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return { ok: false, statusCode: 400, error: 'Transaction not found or not confirmed yet' };
    }

    if (receipt.status !== 1) {
      return { ok: false, statusCode: 400, error: 'Transaction failed on-chain' };
    }

    const tx = await provider.getTransaction(txHash);
    if (!tx) {
      return { ok: false, statusCode: 400, error: 'Transaction details unavailable' };
    }

    const sender = (tx.from || '').toLowerCase();
    if (sender !== userAddress.toLowerCase()) {
      return { ok: false, statusCode: 400, error: 'Transaction sender does not match your wallet' };
    }

    // Native BNB transfer verification
    if (!tx.to || tx.to.toLowerCase() !== receiver) {
      return { ok: false, statusCode: 400, error: 'Transaction receiver address is invalid' };
    }

    const expectedValue = ethers.parseEther(amount.toString());
    if (tx.value < expectedValue) {
      return { ok: false, statusCode: 400, error: 'Transaction amount is lower than requested deposit' };
    }

    return { ok: true };
  } catch (err) {
    console.error('Deposit verification error:', err);
    return { ok: false, statusCode: 503, error: 'Deposit verification service unavailable' };
  }
}

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

  const normalizedTxHash = txHash.trim().toLowerCase();
  if (!TX_HASH_REGEX.test(normalizedTxHash)) {
    res.status(400).json({ error: 'txHash format is invalid' });
    return;
  }

  const verificationResult = await verifyDepositTransaction(normalizedTxHash, userAddress, amount);
  if (!verificationResult.ok) {
    res.status(verificationResult.statusCode).json({ error: verificationResult.error });
    return;
  }

  const pool = getDb();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Bug D7 Fix: Use LOWER() to match the unique index on LOWER(tx_hash).
    // Without this, '0xABC...' and '0xabc...' could bypass the application check
    // but hit the DB unique index, causing a cryptic constraint violation error.
    const existingTx = await client.query(
      'SELECT id FROM deposits WHERE LOWER(tx_hash) = $1',
      [normalizedTxHash]
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
      [id, userAddress, amount, normalizedTxHash, now]
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
    if (err?.code === '23505') {
      res.status(409).json({ error: 'This transaction hash has already been used' });
      return;
    }
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

  if (!ethers.isAddress(toAddress)) {
    res.status(400).json({ error: 'toAddress must be a valid EVM address' });
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
  const rawLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
  const rawOffset = Number.parseInt(String(req.query.offset ?? ''), 10);
  const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 20, 100));
  const offset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);

  try {
    const db = getDb();

    // Count total for pagination
    const countRes = await db.query(
      `SELECT
        (SELECT COUNT(*) FROM deposits WHERE user_address = $1) +
        (SELECT COUNT(*) FROM withdrawals WHERE user_address = $1) AS total`,
      [userAddress]
    );
    const total = parseInt(countRes.rows[0].total, 10) || 0;

    // Use SQL UNION ALL with ORDER BY and LIMIT/OFFSET to avoid loading all records into memory
    const txRes = await db.query(
      `SELECT id, amount, tx_hash, NULL AS to_address, status, created_at, 'deposit' AS type
       FROM deposits WHERE user_address = $1
       UNION ALL
       SELECT id, amount, NULL AS tx_hash, to_address, status, created_at, 'withdraw' AS type
       FROM withdrawals WHERE user_address = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userAddress, limit, offset]
    );

    res.json({
      transactions: txRes.rows,
      total,
    });
  } catch (err: any) {
    console.error('Transactions error:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

export default router;
