import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDb } from '../db';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'prediction-market-dev-secret';

// GET /api/auth/nonce/:address
router.get('/nonce/:address', async (req: Request, res: Response) => {
  const { address } = req.params;

  if (!ethers.isAddress(address)) {
    res.status(400).json({ error: 'Invalid address' });
    return;
  }

  const db = getDb();
  const nonce = crypto.randomBytes(16).toString('hex');
  const now = Date.now();

  // Upsert user with nonce
  await db.query(`
    INSERT INTO users (address, nonce, created_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (address) DO UPDATE SET nonce = $4
  `, [address.toLowerCase(), nonce, now, nonce]);

  // Ensure user has a balance entry
  await db.query(`
    INSERT INTO balances (user_address, available, locked)
    VALUES ($1, 10000, 0)
    ON CONFLICT (user_address) DO NOTHING
  `, [address.toLowerCase()]);

  res.json({ nonce, message: `Sign this message to verify your identity: ${nonce}` });
});

// POST /api/auth/verify
router.post('/verify', async (req: Request, res: Response) => {
  const { address, signature } = req.body;

  if (!address || !signature) {
    res.status(400).json({ error: 'Address and signature required' });
    return;
  }

  const db = getDb();
  const user = (await db.query('SELECT * FROM users WHERE address = $1', [address.toLowerCase()])).rows[0] as any;

  if (!user || !user.nonce) {
    res.status(400).json({ error: 'Nonce not found. Request a nonce first.' });
    return;
  }

  const message = `Sign this message to verify your identity: ${user.nonce}`;

  try {
    const recoveredAddress = ethers.verifyMessage(message, signature);
    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      res.status(401).json({ error: 'Signature verification failed' });
      return;
    }
  } catch {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Clear nonce
  await db.query('UPDATE users SET nonce = NULL WHERE address = $1', [address.toLowerCase()]);

  // Generate JWT
  const token = jwt.sign({ address: address.toLowerCase() }, JWT_SECRET, { expiresIn: '24h' });

  const balance = (await db.query('SELECT * FROM balances WHERE user_address = $1', [address.toLowerCase()])).rows[0] as any;

  res.json({
    token,
    user: {
      address: address.toLowerCase(),
      balance: balance ? balance.available : 10000,
    },
  });
});

export default router;
