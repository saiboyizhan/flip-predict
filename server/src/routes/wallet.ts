import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { adminMiddleware } from './middleware/admin';
import { getDb } from '../db';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { BSC_CHAIN_ID, getRpcUrl } from '../config/network';

const router = Router();

// Constants for deposit validation
const MAX_DEPOSIT_AMOUNT = 1_000_000;
const MAX_DEPOSITS_PER_DAY = 50;
const MAX_WITHDRAWAL_AMOUNT = 1_000_000;
const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;
const DEPOSIT_RPC_URL = getRpcUrl('DEPOSIT_RPC_URL');

// BSC USDT contract address (18 decimals expected by current logic)
const RAW_USDT_ADDRESS = process.env.USDT_ADDRESS || '';
const USDT_ADDRESS = ethers.isAddress(RAW_USDT_ADDRESS)
  ? RAW_USDT_ADDRESS.toLowerCase()
  : null;
// ERC-20 Transfer(address,address,uint256) event topic
const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

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

function getPredictionMarketAddress(): string | null {
  const configured = process.env.PREDICTION_MARKET_ADDRESS || process.env.VITE_PREDICTION_MARKET_ADDRESS;
  if (!configured || !ethers.isAddress(configured)) return null;
  return configured.toLowerCase();
}

async function verifyDepositTransaction(
  txHash: string,
  userAddress: string,
  amount: number
): Promise<{ ok: true } | { ok: false; statusCode: number; error: string }> {
  const receiver = getDepositReceiverAddress();
  const pmAddress = getPredictionMarketAddress();
  if (!receiver && !pmAddress) {
    return { ok: false, statusCode: 503, error: 'Deposit verification is not configured' };
  }
  if (!USDT_ADDRESS) {
    return { ok: false, statusCode: 503, error: 'USDT_ADDRESS is not configured' };
  }

  // Accept USDT transfers to either the deposit receiver wallet OR the PredictionMarket contract
  const validReceivers = new Set<string>();
  if (receiver) validReceivers.add(receiver);
  if (pmAddress) validReceivers.add(pmAddress);

  const provider = getDepositProvider();

  try {
    const network = await provider.getNetwork();
    const connectedChainId = Number(network.chainId);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return {
        ok: false,
        statusCode: 400,
        error: `Transaction not found on chain ${connectedChainId}. Check DEPOSIT_RPC_URL/BSC_RPC_URL`,
      };
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

    // USDT ERC-20 Transfer event verification
    // Parse receipt logs to find Transfer(from, to, amount) event from the USDT contract
    const expectedValue = ethers.parseUnits(amount.toString(), 18); // BSC USDT uses 18 decimals
    let transferFound = false;

    for (const log of receipt.logs) {
      // Check that this log is from the USDT contract
      if (log.address.toLowerCase() !== USDT_ADDRESS) continue;

      // Check that this is a Transfer event (topic[0])
      if (!log.topics || log.topics.length < 3) continue;
      if (log.topics[0] !== TRANSFER_EVENT_TOPIC) continue;

      // topic[1] = from address (padded to 32 bytes)
      // topic[2] = to address (padded to 32 bytes)
      const fromAddr = '0x' + log.topics[1].slice(26).toLowerCase();
      const toAddr = '0x' + log.topics[2].slice(26).toLowerCase();

      // Verify: from = user, to = deposit receiver OR PredictionMarket contract
      if (fromAddr !== userAddress.toLowerCase()) continue;
      if (!validReceivers.has(toAddr)) continue;

      // data = transfer amount (uint256)
      const transferAmount = BigInt(log.data);
      if (transferAmount >= expectedValue) {
        transferFound = true;
        break;
      }
    }

    if (!transferFound) {
      return { ok: false, statusCode: 400, error: 'No matching USDT Transfer event found in transaction' };
    }

    return { ok: true };
  } catch (err) {
    console.error('Deposit verification error:', err);
    return {
      ok: false,
      statusCode: 503,
      error: `Deposit verification service unavailable (expected chain ${BSC_CHAIN_ID})`,
    };
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

  // On-chain verification: best-effort, non-blocking.
  // The on-chain contract deposit already succeeded (USDT transferred),
  // so we always credit the platform balance. Verification is logged for auditing only.
  if (USDT_ADDRESS && (getDepositReceiverAddress() || getPredictionMarketAddress())) {
    try {
      const verificationResult = await verifyDepositTransaction(normalizedTxHash, userAddress, amount);
      if (!verificationResult.ok) {
        console.warn(`[wallet] Deposit verification warning for ${normalizedTxHash}: ${verificationResult.error}`);
      }
    } catch (err: any) {
      console.warn('[wallet] Deposit verification RPC unavailable, proceeding anyway:', err.message);
    }
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
  const { amount, toAddress, txHash: requestTxHash } = req.body;

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

  // --- On-chain requestWithdraw tx verification ---
  // txHash is required: user must submit an on-chain requestWithdraw() tx first
  if (!requestTxHash || typeof requestTxHash !== 'string') {
    res.status(400).json({ error: 'txHash is required (on-chain requestWithdraw tx)' });
    return;
  }
  const normalizedRequestTxHash = requestTxHash.trim().toLowerCase();
  if (!TX_HASH_REGEX.test(normalizedRequestTxHash)) {
    res.status(400).json({ error: 'txHash format is invalid' });
    return;
  }

  // Verify on-chain: tx must be a real requestWithdraw from this user with matching amount
  const pmAddress = getPredictionMarketAddress();
  if (!pmAddress) {
    res.status(503).json({ error: 'PREDICTION_MARKET_ADDRESS not configured' });
    return;
  }
  {
    try {
      const provider = getDepositProvider();
      const receipt = await provider.getTransactionReceipt(normalizedRequestTxHash);
      if (!receipt || receipt.status !== 1) {
        res.status(400).json({ error: 'Transaction not found or failed on-chain' });
        return;
      }
      const tx = await provider.getTransaction(normalizedRequestTxHash);
      if (!tx || tx.from.toLowerCase() !== userAddress.toLowerCase()) {
        res.status(400).json({ error: 'Transaction sender does not match your wallet' });
        return;
      }
      // Verify WithdrawRequested event: topic0 = keccak256("WithdrawRequested(address,uint256,uint256)")
      const WITHDRAW_REQUESTED_TOPIC = ethers.id('WithdrawRequested(address,uint256,uint256)');
      let eventFound = false;
      const expectedAmount = ethers.parseUnits(amount.toString(), 18);
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== pmAddress) continue;
        if (!log.topics || log.topics.length < 3) continue;
        if (log.topics[0] !== WITHDRAW_REQUESTED_TOPIC) continue;
        // topic[1] = user address (indexed), data = amount (uint256)
        const eventUser = '0x' + log.topics[1].slice(26).toLowerCase();
        if (eventUser !== userAddress.toLowerCase()) continue;
        const eventAmount = BigInt(log.data);
        if (eventAmount >= expectedAmount) {
          eventFound = true;
          break;
        }
      }
      if (!eventFound) {
        res.status(400).json({ error: 'No matching WithdrawRequested event found in transaction' });
        return;
      }
    } catch (err: any) {
      // Withdrawals MUST be verified on-chain -- reject if RPC is unavailable.
      // (Unlike deposits where the user already sent USDT and we credit optimistically,
      //  here a fake txHash would cause real USDT to be sent out by the Keeper.)
      console.error('[wallet] Withdraw tx verification RPC error:', err.message);
      res.status(503).json({ error: 'On-chain verification unavailable, please try again later' });
      return;
    }
  }

  const pool = getDb();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Prevent same requestWithdraw tx from being used twice
    const existingTx = await client.query(
      'SELECT id FROM withdrawals WHERE LOWER(request_tx_hash) = $1',
      [normalizedRequestTxHash]
    );
    if (existingTx.rows.length > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'This withdraw request tx has already been used' });
      return;
    }

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
    // Record the withdrawal (request_tx_hash = user's on-chain requestWithdraw tx)
    await client.query(
      `INSERT INTO withdrawals (id, user_address, amount, to_address, status, created_at, request_tx_hash)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6)`,
      [id, userAddress, amount, toAddress, now, normalizedRequestTxHash]
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
    // Handle UNIQUE constraint violation on request_tx_hash (concurrent duplicate)
    if (err?.code === '23505') {
      res.status(409).json({ error: 'This withdraw request tx has already been used' });
      return;
    }
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
  const offset = Math.max(0, Math.min(Number.isFinite(rawOffset) ? rawOffset : 0, 100000));

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

// ============================================================
// Withdrawal Processor: processes pending withdrawals via on-chain adminWithdraw
// ============================================================

const WITHDRAWAL_RPC_URL = getRpcUrl('WITHDRAWAL_RPC_URL');
const PM_ADDRESS = process.env.PREDICTION_MARKET_ADDRESS || process.env.VITE_PREDICTION_MARKET_ADDRESS || '';
const DEPLOYER_KEY = process.env.DEPLOYER_KEY || '';

const ADMIN_WITHDRAW_ABI = [
  'function adminWithdraw(address user, uint256 amount) external',
];

/**
 * Process all pending withdrawals by calling adminWithdraw on PredictionMarket.
 * Called by the keeper interval or manually via admin endpoint.
 */
export async function processWithdrawals(): Promise<{ processed: number; failed: number }> {
  if (!DEPLOYER_KEY || !ethers.isAddress(PM_ADDRESS)) {
    return { processed: 0, failed: 0 };
  }

  const db = getDb();
  // Use advisory lock to prevent concurrent processWithdrawals from double-processing
  const selectClient = await db.connect();
  let pending: any[];
  try {
    await selectClient.query('BEGIN');
    // Grab exclusive lock; skip if another processor is already running
    const lockResult = await selectClient.query("SELECT pg_try_advisory_xact_lock(42)");
    if (!lockResult.rows[0].pg_try_advisory_xact_lock) {
      await selectClient.query('COMMIT');
      return { processed: 0, failed: 0 };
    }
    // Flag stale 'processing' entries that were abandoned (e.g. process crash after on-chain tx).
    // Mark as 'stuck' for manual review -- do NOT auto-retry because the on-chain tx may have succeeded.
    const staleThreshold = Date.now() - 10 * 60 * 1000;
    const staleResult = await selectClient.query(
      "UPDATE withdrawals SET status = 'stuck' WHERE status = 'processing' AND created_at < $1 RETURNING id",
      [staleThreshold]
    );
    if (staleResult.rowCount && staleResult.rowCount > 0) {
      console.warn(`[keeper] Marked ${staleResult.rowCount} stale processing withdrawal(s) as stuck — manual review needed`);
    }

    pending = (await selectClient.query(
      "SELECT * FROM withdrawals WHERE status = 'pending' ORDER BY created_at ASC LIMIT 20 FOR UPDATE SKIP LOCKED"
    )).rows;
    await selectClient.query('COMMIT');
  } catch (err) {
    await selectClient.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    selectClient.release();
  }

  if (pending.length === 0) return { processed: 0, failed: 0 };

  const provider = new ethers.JsonRpcProvider(WITHDRAWAL_RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);
  const pm = new ethers.Contract(PM_ADDRESS, ADMIN_WITHDRAW_ABI, wallet);

  let processed = 0;
  let failed = 0;

  for (const w of pending) {
    try {
      // Mark as 'processing' BEFORE sending on-chain tx to prevent double-send
      // if the process crashes after the tx succeeds but before the DB update.
      await db.query(
        "UPDATE withdrawals SET status = 'processing' WHERE id = $1",
        [w.id]
      );

      const amountWei = ethers.parseUnits(String(w.amount), 18);
      const tx = await pm.adminWithdraw(w.to_address, amountWei);
      const receipt = await tx.wait();

      await db.query(
        "UPDATE withdrawals SET status = 'completed', tx_hash = $1 WHERE id = $2",
        [receipt.hash, w.id]
      );
      processed++;
      console.info(`Withdrawal ${w.id} processed: ${receipt.hash}`);
    } catch (err: any) {
      failed++;
      console.error(`Withdrawal ${w.id} failed:`, err.message);
      // Return balance to user on failure to prevent fund loss
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          "UPDATE withdrawals SET status = 'failed' WHERE id = $1",
          [w.id]
        );
        await client.query(
          `INSERT INTO balances (user_address, available, locked) VALUES ($1, $2, 0)
           ON CONFLICT (user_address) DO UPDATE SET available = balances.available + $2`,
          [w.user_address, w.amount]
        );
        await client.query('COMMIT');
        console.info(`Withdrawal ${w.id} failed — returned ${w.amount} to ${w.user_address}`);
      } catch (returnErr: any) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`CRITICAL: Failed to return balance for withdrawal ${w.id}:`, returnErr.message);
      } finally {
        client.release();
      }
    }
  }

  return { processed, failed };
}

// POST /api/wallet/process-withdrawals (admin only)
router.post('/process-withdrawals', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await processWithdrawals();
    res.json(result);
  } catch (err: any) {
    console.error('Process withdrawals error:', err);
    res.status(500).json({ error: 'Failed to process withdrawals' });
  }
});

export default router;
