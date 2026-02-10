import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';
import crypto from 'crypto';
import { createNotification } from './notifications';

const router = Router();

// GET /api/rewards — user rewards list (auth required)
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { rows: rewards } = await db.query(
      'SELECT * FROM rewards WHERE user_address = $1 ORDER BY created_at DESC',
      [req.userAddress]
    );
    res.json({ rewards });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rewards/claim/:id — claim a reward
router.post('/claim/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Lock the reward row to prevent double-claim race condition
    const reward = (await client.query(
      'SELECT * FROM rewards WHERE id = $1 AND user_address = $2 FOR UPDATE',
      [req.params.id, req.userAddress]
    )).rows[0] as any;

    if (!reward) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Reward not found' });
      return;
    }
    if (reward.status === 'claimed') {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Reward already claimed' });
      return;
    }

    // Update reward status
    await client.query('UPDATE rewards SET status = $1 WHERE id = $2', ['claimed', req.params.id]);

    // Credit to user balance
    await client.query(`
      INSERT INTO balances (user_address, available, locked)
      VALUES ($1, $2, 0)
      ON CONFLICT (user_address)
      DO UPDATE SET available = balances.available + $2
    `, [req.userAddress, reward.amount]);

    await client.query('COMMIT');

    // Create notification (outside transaction - non-critical)
    await createNotification({
      userAddress: req.userAddress!,
      type: 'system',
      title: 'Reward Claimed',
      message: `You claimed a ${reward.type} reward of ${reward.amount} USDT`,
      metadata: { rewardId: reward.id, amount: reward.amount, type: reward.type },
    });

    res.json({ success: true, reward: { ...reward, status: 'claimed' } });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/rewards/referral-code — get referral code (based on first 8 chars of address)
router.get('/referral-code', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const address = req.userAddress!;
    // Generate referral code from address: take first 8 hex chars after 0x
    const code = address.slice(2, 10).toLowerCase();
    res.json({ referralCode: code, address });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rewards/referral — use referral code to register
router.post('/referral', authMiddleware, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const client = await db.connect();
  try {
    const { code } = req.body;
    const refereeAddress = req.userAddress!;

    if (!code || !code.trim()) {
      client.release();
      res.status(400).json({ error: 'Referral code is required' });
      return;
    }

    // Find referrer by matching the first 8 hex chars of their address
    const trimmedCode = code.trim().toLowerCase();
    const { rows: users } = await client.query(
      `SELECT address FROM users WHERE LOWER(SUBSTRING(address FROM 3 FOR 8)) = $1`,
      [trimmedCode]
    );

    if (users.length === 0) {
      client.release();
      res.status(404).json({ error: 'Invalid referral code' });
      return;
    }

    const referrerAddress = users[0].address;

    // Cannot refer yourself
    if (referrerAddress.toLowerCase() === refereeAddress.toLowerCase()) {
      client.release();
      res.status(400).json({ error: 'Cannot use your own referral code' });
      return;
    }

    await client.query('BEGIN');

    // Check if already referred with FOR UPDATE to prevent race condition
    const existing = await client.query(
      'SELECT id FROM referrals WHERE referee_address = $1 FOR UPDATE',
      [refereeAddress]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'You have already used a referral code' });
      return;
    }

    const referralId = crypto.randomUUID();
    const rewardAmount = 10; // 10 USDT referral bonus
    const now = Date.now();

    // Create referral record
    await client.query(`
      INSERT INTO referrals (id, referrer_address, referee_address, reward_amount, status, created_at)
      VALUES ($1, $2, $3, $4, 'pending', $5)
    `, [referralId, referrerAddress, refereeAddress, rewardAmount, now]);

    // Create reward for referrer
    const referrerRewardId = crypto.randomUUID();
    await client.query(`
      INSERT INTO rewards (id, user_address, type, amount, status, created_at)
      VALUES ($1, $2, 'referral', $3, 'pending', $4)
    `, [referrerRewardId, referrerAddress, rewardAmount, now]);

    // Create reward for referee (sign-up bonus)
    const refereeRewardId = crypto.randomUUID();
    const refereeBonus = 5; // 5 USDT sign-up bonus
    await client.query(`
      INSERT INTO rewards (id, user_address, type, amount, status, created_at)
      VALUES ($1, $2, 'referral', $3, 'pending', $4)
    `, [refereeRewardId, refereeAddress, refereeBonus, now]);

    await client.query('COMMIT');

    // Notify referrer (outside transaction - non-critical)
    await createNotification({
      userAddress: referrerAddress,
      type: 'system',
      title: 'New Referral',
      message: `Someone used your referral code! You earned ${rewardAmount} USDT reward.`,
      metadata: { referralId, refereeAddress },
    });

    res.json({
      success: true,
      referral: { id: referralId, referrerAddress, refereeAddress, rewardAmount },
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;
