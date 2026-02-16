import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDb } from '../db';
import { JWT_SECRET, ADMIN_ADDRESSES, JWT_EXPIRATION } from '../config';

const router = Router();
const DEFAULT_INITIAL_BALANCE = 0;

function getInitialSignupBalance(): number {
  const raw = process.env.INITIAL_SIGNUP_BALANCE;
  if (raw == null || raw === '') return DEFAULT_INITIAL_BALANCE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_INITIAL_BALANCE;
  return parsed;
}

// GET /api/auth/nonce/:address
router.get('/nonce/:address', async (req: Request, res: Response) => {
  try {
    const rawAddress = req.params.address;

    if (!ethers.isAddress(rawAddress.toLowerCase())) {
      res.status(400).json({ error: 'Invalid address' });
      return;
    }
    const address = rawAddress.toLowerCase();

    const db = getDb();
    const nonce = crypto.randomBytes(16).toString('hex');
    const now = Date.now();

    // Upsert user with nonce
    await db.query(`
      INSERT INTO users (address, nonce, created_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (address) DO UPDATE SET nonce = $4
    `, [address, nonce, now, nonce]);

    // Ensure user has a balance entry
    const initialBalance = getInitialSignupBalance();
    await db.query(`
      INSERT INTO balances (user_address, available, locked)
      VALUES ($1, $2, 0)
      ON CONFLICT (user_address) DO NOTHING
    `, [address.toLowerCase(), initialBalance]);

    res.json({ nonce, message: `Sign this message to verify your identity: ${nonce}` });
  } catch (err: any) {
    console.error('Nonce error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/verify
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { address, signature } = req.body;

    if (typeof address !== 'string' || typeof signature !== 'string') {
      res.status(400).json({ error: 'Address and signature required' });
      return;
    }

    if (!ethers.isAddress(address.toLowerCase())) {
      res.status(400).json({ error: 'Invalid address' });
      return;
    }

    const db = getDb();
    const normalizedAddress = address.toLowerCase();
    const user = (await db.query('SELECT * FROM users WHERE address = $1', [normalizedAddress])).rows[0] as any;

    if (!user || !user.nonce) {
      res.status(400).json({ error: 'Nonce not found. Request a nonce first.' });
      return;
    }

    const message = `Sign this message to verify your identity: ${user.nonce}`;

    try {
      const recoveredAddress = ethers.verifyMessage(message, signature);
      if (recoveredAddress.toLowerCase() !== normalizedAddress) {
        // Invalidate nonce on failed attempt to prevent replay attacks
        const newNonce = crypto.randomBytes(16).toString('hex');
        await db.query('UPDATE users SET nonce = $1 WHERE address = $2', [newNonce, normalizedAddress]);
        res.status(401).json({ error: 'Signature verification failed' });
        return;
      }
    } catch {
      // Invalidate nonce on failed attempt to prevent replay attacks
      const newNonce = crypto.randomBytes(16).toString('hex');
      await db.query('UPDATE users SET nonce = $1 WHERE address = $2', [newNonce, normalizedAddress]);
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Clear nonce
    await db.query('UPDATE users SET nonce = NULL WHERE address = $1', [normalizedAddress]);

    const isAdmin = ADMIN_ADDRESSES.has(normalizedAddress);

    // Generate JWT
    const token = jwt.sign(
      { address: normalizedAddress, isAdmin },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRATION } as jwt.SignOptions
    );

    const balance = (await db.query('SELECT * FROM balances WHERE user_address = $1', [normalizedAddress])).rows[0] as any;
    const safeBalance = Number(balance?.available ?? getInitialSignupBalance()) || 0;

    res.json({
      token,
      user: {
        address: normalizedAddress,
        balance: safeBalance,
        isAdmin,
      },
    });
  } catch (err: any) {
    console.error('Auth verify error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
