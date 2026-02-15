import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';
import { randomUUID } from 'crypto';

const router = Router();

// POST /api/copy-trading/start
router.post('/start', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { agentId, copyPercentage, maxPerTrade, dailyLimit, onChain = false } = req.body;
    const followerAddress = req.userAddress!;

    if (!agentId || typeof agentId !== 'string') {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    const pct = Number(copyPercentage);
    if (!Number.isFinite(pct) || pct < 10 || pct > 100) {
      res.status(400).json({ error: 'copyPercentage must be 10-100' });
      return;
    }

    const mpt = Number(maxPerTrade);
    if (!Number.isFinite(mpt) || mpt <= 0) {
      res.status(400).json({ error: 'Invalid maxPerTrade' });
      return;
    }

    const dl = Number(dailyLimit);
    if (!Number.isFinite(dl) || dl <= 0) {
      res.status(400).json({ error: 'Invalid dailyLimit' });
      return;
    }

    // Check agent exists
    const agent = (await db.query('SELECT id, owner_address FROM agents WHERE id = $1', [agentId])).rows[0];
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    // Cannot copy own agent
    if (agent.owner_address.toLowerCase() === followerAddress.toLowerCase()) {
      res.status(400).json({ error: 'Cannot copy your own agent' });
      return;
    }

    // Check existing active follow
    const existing = (await db.query(
      "SELECT id FROM agent_followers WHERE agent_id = $1 AND follower_address = $2 AND status = 'active'",
      [agentId, followerAddress]
    )).rows[0];

    if (existing) {
      res.status(400).json({ error: 'Already following this agent' });
      return;
    }

    const id = randomUUID();
    const onChainFlag = onChain ? 1 : 0;
    await db.query(`
      INSERT INTO agent_followers (id, agent_id, follower_address, copy_percentage, max_per_trade, daily_limit, daily_used, revenue_share_pct, status, on_chain, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 0, 10, 'active', $8, $7)
    `, [id, agentId, followerAddress, pct, mpt, dl, Date.now(), onChainFlag]);

    const record = (await db.query('SELECT * FROM agent_followers WHERE id = $1', [id])).rows[0];
    res.json({ follower: record });
  } catch (err: any) {
    console.error('Copy trading start error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/copy-trading/stop
router.post('/stop', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { agentId } = req.body;
    const followerAddress = req.userAddress!;

    if (!agentId) {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    const result = await db.query(
      "UPDATE agent_followers SET status = 'stopped' WHERE agent_id = $1 AND follower_address = $2 AND status = 'active' RETURNING *",
      [agentId, followerAddress]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'No active follow found' });
      return;
    }

    res.json({ follower: result.rows[0] });
  } catch (err: any) {
    console.error('Copy trading stop error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/copy-trading/settings
router.put('/settings', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { agentId, copyPercentage, maxPerTrade, dailyLimit, onChain } = req.body;
    const followerAddress = req.userAddress!;

    if (!agentId) {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    const existing = (await db.query(
      "SELECT * FROM agent_followers WHERE agent_id = $1 AND follower_address = $2 AND status = 'active'",
      [agentId, followerAddress]
    )).rows[0];

    if (!existing) {
      res.status(404).json({ error: 'No active follow found' });
      return;
    }

    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (copyPercentage !== undefined) {
      const pct = Number(copyPercentage);
      if (!Number.isFinite(pct) || pct < 10 || pct > 100) {
        res.status(400).json({ error: 'copyPercentage must be 10-100' });
        return;
      }
      updates.push(`copy_percentage = $${idx++}`);
      params.push(pct);
    }

    if (maxPerTrade !== undefined) {
      const mpt = Number(maxPerTrade);
      if (!Number.isFinite(mpt) || mpt <= 0) {
        res.status(400).json({ error: 'Invalid maxPerTrade' });
        return;
      }
      updates.push(`max_per_trade = $${idx++}`);
      params.push(mpt);
    }

    if (dailyLimit !== undefined) {
      const dl = Number(dailyLimit);
      if (!Number.isFinite(dl) || dl <= 0) {
        res.status(400).json({ error: 'Invalid dailyLimit' });
        return;
      }
      updates.push(`daily_limit = $${idx++}`);
      params.push(dl);
    }

    if (onChain !== undefined) {
      const onChainFlag = onChain ? 1 : 0;
      updates.push(`on_chain = $${idx++}`);
      params.push(onChainFlag);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    params.push(existing.id);
    const sql = `UPDATE agent_followers SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await db.query(sql, params);

    res.json({ follower: result.rows[0] });
  } catch (err: any) {
    console.error('Copy trading settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/copy-trading/status/:agentId
router.get('/status/:agentId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const followerAddress = req.userAddress!;

    const record = (await db.query(
      "SELECT * FROM agent_followers WHERE agent_id = $1 AND follower_address = $2 ORDER BY created_at DESC LIMIT 1",
      [req.params.agentId, followerAddress]
    )).rows[0];

    res.json({ follower: record || null });
  } catch (err: any) {
    console.error('Copy trading status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/copy-trading/trades
router.get('/trades', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const followerAddress = req.userAddress!;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const trades = (await db.query(
      'SELECT * FROM copy_trades WHERE follower_address = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [followerAddress, limit, offset]
    )).rows;

    const countResult = (await db.query(
      'SELECT COUNT(*) as total FROM copy_trades WHERE follower_address = $1',
      [followerAddress]
    )).rows[0];

    res.json({ trades, total: Number(countResult.total) });
  } catch (err: any) {
    console.error('Copy trades error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/copy-trading/earnings/:agentId
router.get('/earnings/:agentId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const ownerAddress = req.userAddress!;

    // Verify ownership
    const agent = (await db.query(
      'SELECT id FROM agents WHERE id = $1 AND owner_address = $2',
      [req.params.agentId, ownerAddress]
    )).rows[0];

    if (!agent) {
      res.status(403).json({ error: 'Not the agent owner' });
      return;
    }

    const earnings = (await db.query(
      'SELECT * FROM agent_earnings WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.params.agentId]
    )).rows;

    const totals = (await db.query(
      'SELECT COALESCE(SUM(amount), 0) as total, COALESCE(SUM(CASE WHEN claimed = 0 THEN amount ELSE 0 END), 0) as unclaimed FROM agent_earnings WHERE agent_id = $1',
      [req.params.agentId]
    )).rows[0];

    res.json({
      earnings,
      totalEarnings: Number(totals.total),
      unclaimed: Number(totals.unclaimed),
    });
  } catch (err: any) {
    console.error('Earnings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/copy-trading/pending-on-chain
router.get('/pending-on-chain', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const followerAddress = req.userAddress!;

    // Get pending on-chain trades that haven't been executed
    const trades = (await db.query(
      `SELECT ct.*, m.title as market_title, m.on_chain_market_id
       FROM copy_trades ct
       JOIN markets m ON ct.market_id = m.id
       WHERE ct.follower_address = $1 AND ct.on_chain = 1 AND ct.tx_hash IS NULL
       ORDER BY ct.created_at DESC
       LIMIT 20`,
      [followerAddress]
    )).rows;

    res.json({ trades });
  } catch (err: any) {
    console.error('Pending on-chain trades error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/copy-trading/confirm-on-chain
router.post('/confirm-on-chain', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { tradeId, txHash } = req.body;
    const followerAddress = req.userAddress!;

    if (!tradeId || !txHash) {
      res.status(400).json({ error: 'tradeId and txHash are required' });
      return;
    }

    // Update trade with tx hash
    const result = await db.query(
      'UPDATE copy_trades SET tx_hash = $1 WHERE id = $2 AND follower_address = $3 RETURNING *',
      [txHash, tradeId, followerAddress]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Trade not found' });
      return;
    }

    res.json({ success: true, trade: result.rows[0] });
  } catch (err: any) {
    console.error('Confirm on-chain trade error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/copy-trading/claim
router.post('/claim', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { agentId } = req.body;
    const ownerAddress = req.userAddress!;

    if (!agentId) {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    // Verify ownership
    const agent = (await db.query(
      'SELECT id FROM agents WHERE id = $1 AND owner_address = $2',
      [agentId, ownerAddress]
    )).rows[0];

    if (!agent) {
      res.status(403).json({ error: 'Not the agent owner' });
      return;
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const unclaimed = (await client.query(
        'SELECT COALESCE(SUM(amount), 0) as total FROM agent_earnings WHERE agent_id = $1 AND claimed = 0',
        [agentId]
      )).rows[0];

      const amount = Number(unclaimed.total);
      if (amount < 0.01) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'No earnings to claim' });
        return;
      }

      // Mark as claimed
      await client.query(
        'UPDATE agent_earnings SET claimed = 1 WHERE agent_id = $1 AND claimed = 0',
        [agentId]
      );

      // Mark as claimed (no double-crediting)

      await client.query('COMMIT');

      res.json({ success: true, amount });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Claim earnings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/copy-trading/combo-strategy
router.put('/combo-strategy', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { agentId, weights } = req.body;
    const ownerAddress = req.userAddress!;

    if (!agentId) {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    // Verify ownership
    const agent = (await db.query(
      'SELECT id FROM agents WHERE id = $1 AND owner_address = $2',
      [agentId, ownerAddress]
    )).rows[0];

    if (!agent) {
      res.status(403).json({ error: 'Not the agent owner' });
      return;
    }

    const validKeys = ['conservative', 'aggressive', 'contrarian', 'momentum', 'random'];
    if (!weights || typeof weights !== 'object') {
      res.status(400).json({ error: 'weights object is required' });
      return;
    }

    // Validate all keys
    const normalized: Record<string, number> = {};
    let total = 0;
    for (const key of validKeys) {
      const val = Number(weights[key]) || 0;
      if (val < 0) {
        res.status(400).json({ error: `Invalid weight for ${key}` });
        return;
      }
      normalized[key] = val;
      total += val;
    }

    // Normalize to sum to 100
    if (total > 0) {
      for (const key of validKeys) {
        normalized[key] = Math.round((normalized[key] / total) * 100);
      }
      // Fix rounding errors by adjusting the largest
      const sum = Object.values(normalized).reduce((a, b) => a + b, 0);
      if (sum !== 100) {
        const maxKey = validKeys.reduce((a, b) => normalized[a] >= normalized[b] ? a : b);
        normalized[maxKey] += (100 - sum);
      }
    }

    await db.query(
      'UPDATE agents SET combo_weights = $1 WHERE id = $2',
      [JSON.stringify(normalized), agentId]
    );

    res.json({ success: true, weights: normalized });
  } catch (err: any) {
    console.error('Combo strategy error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
