import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';
import crypto from 'crypto';
import { createNotification } from './notifications';

const router = Router();
const REFERRAL_CODE_LENGTH = 12;

function buildReferralCode(address: string): string {
  return crypto
    .createHash('md5')
    .update(address.toLowerCase())
    .digest('hex')
    .slice(0, REFERRAL_CODE_LENGTH);
}

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
    console.error('Rewards list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/rewards/claim/:id — claim a reward
router.post('/claim/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const client = await db.connect();
  let committed = false;
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
    committed = true;

    // Create notification (outside transaction - non-critical)
    try {
      await createNotification({
        userAddress: req.userAddress!,
        type: 'system',
        title: 'Reward Claimed',
        message: `You claimed a ${reward.type} reward of ${reward.amount} BNB`,
        metadata: { rewardId: reward.id, amount: reward.amount, type: reward.type },
      });
    } catch (notifyErr) {
      console.error('Reward claim notification error:', notifyErr);
    }

    res.json({ success: true, reward: { ...reward, status: 'claimed' } });
  } catch (err: any) {
    if (!committed) {
      await client.query('ROLLBACK');
    }
    console.error('Reward claim error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/rewards/referral-code — get referral code
router.get('/referral-code', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const address = req.userAddress!;
    const code = buildReferralCode(address);

    const referralsResult = await db.query(
      'SELECT COUNT(*) as referrals FROM referrals WHERE referrer_address = $1',
      [address]
    );
    const earningsResult = await db.query(
      "SELECT COALESCE(SUM(amount), 0) as earnings FROM rewards WHERE user_address = $1 AND type = 'referral' AND status = 'claimed'",
      [address]
    );

    const referrals = parseInt(referralsResult.rows[0]?.referrals ?? '0') || 0;
    const earnings = parseFloat(earningsResult.rows[0]?.earnings ?? '0') || 0;

    res.json({ code, referralCode: code, address, referrals, earnings });
  } catch (err: any) {
    console.error('Referral code error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/rewards/referral — use referral code to register
router.post('/referral', authMiddleware, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const client = await db.connect();
  let committed = false;
  try {
    const { code } = req.body;
    const refereeAddress = req.userAddress!;

    if (typeof code !== 'string' || !code.trim()) {
      res.status(400).json({ error: 'Referral code is required' });
      return;
    }

    // Find referrer by deterministic hash-based code and detect ambiguity.
    const trimmedCode = code.trim().toLowerCase();
    if (!/^[0-9a-f]+$/.test(trimmedCode) || trimmedCode.length !== REFERRAL_CODE_LENGTH) {
      res.status(400).json({ error: 'Invalid referral code format' });
      return;
    }

    // Bug D17 Fix: Move BEGIN before the user lookup query so the referrer
    // lookup and the subsequent duplicate check are in the same transaction.
    // Without this, a race between two concurrent referral submissions could
    // both find the referrer, then both pass the duplicate check.
    await client.query('BEGIN');

    const { rows: users } = await client.query(
      `SELECT address
       FROM users
       WHERE SUBSTRING(md5(LOWER(address)) FROM 1 FOR $2) = $1
       LIMIT 2`,
      [trimmedCode, REFERRAL_CODE_LENGTH]
    );

    if (users.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Invalid referral code' });
      return;
    }

    if (users.length > 1) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Referral code is ambiguous, please request a new one' });
      return;
    }

    const referrerAddress = users[0].address;

    // Cannot refer yourself
    if (referrerAddress.toLowerCase() === refereeAddress.toLowerCase()) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Cannot use your own referral code' });
      return;
    }
    // Serialize referral usage per referee address to prevent concurrent double-use.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [refereeAddress.toLowerCase()]);

    // Check if already referred with FOR UPDATE to prevent race condition
    const existing = await client.query(
      'SELECT id FROM referrals WHERE LOWER(referee_address) = LOWER($1) FOR UPDATE',
      [refereeAddress]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'You have already used a referral code' });
      return;
    }

    const referralId = crypto.randomUUID();
    const rewardAmount = 10; // 10 BNB referral bonus
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
    const refereeBonus = 5; // 5 BNB sign-up bonus
    await client.query(`
      INSERT INTO rewards (id, user_address, type, amount, status, created_at)
      VALUES ($1, $2, 'referral', $3, 'pending', $4)
    `, [refereeRewardId, refereeAddress, refereeBonus, now]);

    await client.query('COMMIT');
    committed = true;

    // Notify referrer (outside transaction - non-critical)
    try {
      await createNotification({
        userAddress: referrerAddress,
        type: 'system',
        title: 'New Referral',
        message: `Someone used your referral code! You earned ${rewardAmount} BNB reward.`,
        metadata: { referralId, refereeAddress },
      });
    } catch (notifyErr) {
      console.error('Referral notification error:', notifyErr);
    }

    res.json({
      success: true,
      referral: { id: referralId, referrerAddress, refereeAddress, rewardAmount },
    });
  } catch (err: any) {
    if (!committed) {
      await client.query('ROLLBACK');
    }
    console.error('Referral error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

export default router;
