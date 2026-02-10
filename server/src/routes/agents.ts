import { Router, Request, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';

const router = Router();

const VALID_STRATEGIES = ['conservative', 'aggressive', 'contrarian', 'momentum', 'random'];

function generateId(): string {
  return 'agent-' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

// ========== Public Routes ==========

// GET /api/agents — list agents
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { sort = 'roi', strategy, limit = '50' } = req.query;
    const rawLimit = Number.parseInt(String(limit), 10);
    const parsedLimit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 50, 100));

    let orderBy = 'roi DESC';
    switch (sort) {
      case 'win_rate': orderBy = 'win_rate DESC'; break;
      case 'profit': orderBy = 'total_profit DESC'; break;
      case 'newest': orderBy = 'created_at DESC'; break;
      case 'level': orderBy = 'level DESC, experience DESC'; break;
      default: orderBy = 'roi DESC';
    }

    let sql = `SELECT * FROM agents`;
    const params: any[] = [];
    let paramIndex = 1;

    if (strategy && VALID_STRATEGIES.includes(strategy as string)) {
      sql += ` WHERE strategy = $${paramIndex++}`;
      params.push(strategy);
    }

    sql += ` ORDER BY ${orderBy} LIMIT $${paramIndex}`;
    params.push(parsedLimit);

    const agents = (await db.query(sql, params)).rows;
    res.json({ agents });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agents/leaderboard — top 20 by ROI
router.get('/leaderboard', async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const agents = (await db.query(
      'SELECT * FROM agents ORDER BY roi DESC LIMIT 20'
    )).rows;
    res.json({ agents });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agents/marketplace — for sale or rent
router.get('/marketplace', async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const agents = (await db.query(
      'SELECT * FROM agents WHERE is_for_sale = 1 OR is_for_rent = 1 ORDER BY created_at DESC'
    )).rows;
    res.json({ agents });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agents/my — my agents (JWT required) — must be before /:id
router.get('/my', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agents = (await db.query(
      'SELECT * FROM agents WHERE owner_address = $1 ORDER BY created_at DESC',
      [req.userAddress]
    )).rows;
    res.json({ agents });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agents/:id — agent detail + recent trades
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const trades = (await db.query(
      'SELECT * FROM agent_trades WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.params.id]
    )).rows;

    res.json({ agent, trades });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== Authenticated Routes ==========

// POST /api/agents/mint — create agent
router.post('/mint', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { name, strategy, description, persona, avatar } = req.body;

    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    if (strategy && !VALID_STRATEGIES.includes(strategy)) {
      res.status(400).json({ error: 'Invalid strategy' });
      return;
    }

    const id = generateId();
    const now = Date.now();

    await db.query(`
      INSERT INTO agents (id, name, owner_address, strategy, description, persona, avatar, wallet_balance, level, experience, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 1000, 1, 0, $8)
    `, [id, name.trim(), req.userAddress, strategy || 'conservative', description || '', persona || '', avatar || null, now]);

    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [id])).rows[0];
    res.json({ agent });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/agents/:id — update agent (owner only)
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    if (agent.owner_address !== req.userAddress) {
      res.status(403).json({ error: 'Not the owner' });
      return;
    }

    const { strategy, description, name, avatar } = req.body;
    if (strategy && !VALID_STRATEGIES.includes(strategy)) {
      res.status(400).json({ error: 'Invalid strategy' });
      return;
    }

    await db.query(`
      UPDATE agents SET
        name = COALESCE($1, name),
        strategy = COALESCE($2, strategy),
        description = COALESCE($3, description),
        avatar = COALESCE($4, avatar)
      WHERE id = $5
    `, [name || null, strategy || null, description || null, avatar || null, req.params.id]);

    const updated = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    res.json({ agent: updated });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/agents/:id/list-sale — list for sale
router.post('/:id/list-sale', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    const parsedPrice = parsePositiveNumber(req.body?.price);
    if (parsedPrice === null) { res.status(400).json({ error: 'Valid price required' }); return; }

    await db.query('UPDATE agents SET is_for_sale = 1, sale_price = $1 WHERE id = $2', [parsedPrice, req.params.id]);
    const updated = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    res.json({ agent: updated });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/agents/:id/list-rent — list for rent
router.post('/:id/list-rent', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    const parsedPricePerDay = parsePositiveNumber(req.body?.pricePerDay);
    if (parsedPricePerDay === null) { res.status(400).json({ error: 'Valid pricePerDay required' }); return; }

    await db.query('UPDATE agents SET is_for_rent = 1, rent_price = $1 WHERE id = $2', [parsedPricePerDay, req.params.id]);
    const updated = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    res.json({ agent: updated });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/agents/:id/buy — buy agent
router.post('/:id/buy', authMiddleware, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const client = await db.connect();
  let committed = false;
  try {
    await client.query('BEGIN');

    const agent = (await client.query('SELECT * FROM agents WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0] as any;
    if (!agent) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Agent not found' }); return; }
    if (!agent.is_for_sale) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Agent is not for sale' }); return; }
    if (agent.owner_address === req.userAddress) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Cannot buy your own agent' }); return; }

    const price = agent.sale_price;

    // Check buyer has sufficient balance
    const buyerBalance = (await client.query(
      'SELECT available FROM balances WHERE user_address = $1 FOR UPDATE',
      [req.userAddress]
    )).rows[0];
    if (!buyerBalance || buyerBalance.available < price) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Insufficient balance' });
      return;
    }

    // Deduct buyer's balance
    await client.query(
      'UPDATE balances SET available = available - $1 WHERE user_address = $2',
      [price, req.userAddress]
    );

    // Credit seller's balance
    await client.query(`
      INSERT INTO balances (user_address, available, locked)
      VALUES ($1, $2, 0)
      ON CONFLICT (user_address)
      DO UPDATE SET available = balances.available + $2
    `, [agent.owner_address, price]);

    // Transfer ownership
    await client.query(`
      UPDATE agents SET owner_address = $1, is_for_sale = 0, sale_price = NULL WHERE id = $2
    `, [req.userAddress, req.params.id]);

    await client.query('COMMIT');
    committed = true;

    const updated = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    res.json({ agent: updated });
  } catch (err: any) {
    if (!committed) {
      await client.query('ROLLBACK');
    }
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/agents/:id/rent — rent agent
router.post('/:id/rent', authMiddleware, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const client = await db.connect();
  let committed = false;
  try {
    await client.query('BEGIN');

    const agent = (await client.query('SELECT * FROM agents WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0] as any;
    if (!agent) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Agent not found' }); return; }
    if (!agent.is_for_rent) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Agent is not for rent' }); return; }
    if (agent.rented_by) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Agent is already rented' }); return; }
    if (agent.owner_address === req.userAddress) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Cannot rent your own agent' }); return; }

    const parsedDays = parsePositiveInteger(req.body?.days);
    if (parsedDays === null) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Valid days required' }); return; }

    const totalRentCost = agent.rent_price * parsedDays;

    // Check renter has sufficient balance
    const renterBalance = (await client.query(
      'SELECT available FROM balances WHERE user_address = $1 FOR UPDATE',
      [req.userAddress]
    )).rows[0];
    if (!renterBalance || renterBalance.available < totalRentCost) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Insufficient balance' });
      return;
    }

    // Deduct renter's balance
    await client.query(
      'UPDATE balances SET available = available - $1 WHERE user_address = $2',
      [totalRentCost, req.userAddress]
    );

    // Credit owner's balance
    await client.query(`
      INSERT INTO balances (user_address, available, locked)
      VALUES ($1, $2, 0)
      ON CONFLICT (user_address)
      DO UPDATE SET available = balances.available + $2
    `, [agent.owner_address, totalRentCost]);

    // Set rental info
    const rentExpires = Date.now() + parsedDays * 86400000;
    await client.query('UPDATE agents SET rented_by = $1, rent_expires = $2 WHERE id = $3',
      [req.userAddress, rentExpires, req.params.id]);

    await client.query('COMMIT');
    committed = true;

    const updated = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    res.json({ agent: updated });
  } catch (err: any) {
    if (!committed) {
      await client.query('ROLLBACK');
    }
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/agents/:id/delist — remove from sale/rent (alias for DELETE)
router.post('/:id/delist', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    await db.query('UPDATE agents SET is_for_sale = 0, sale_price = NULL, is_for_rent = 0, rent_price = NULL WHERE id = $1',
      [req.params.id]);

    const updated = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    res.json({ agent: updated });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/agents/:id/delist — remove from sale/rent
router.delete('/:id/delist', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    await db.query('UPDATE agents SET is_for_sale = 0, sale_price = NULL, is_for_rent = 0, rent_price = NULL WHERE id = $1',
      [req.params.id]);

    const updated = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    res.json({ agent: updated });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== BAP-578 Agent Prediction & Advisory Routes ==========

// POST /api/agents/:id/predict — record prediction
router.post('/:id/predict', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { recordPrediction } = require('../engine/agent-prediction');
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    const { marketId, prediction, confidence, reasoning } = req.body;
    const parsedConfidence = Number(confidence);
    if (typeof marketId !== 'string' || !marketId.trim()) {
      res.status(400).json({ error: 'marketId is required' });
      return;
    }
    if (prediction !== 'yes' && prediction !== 'no') {
      res.status(400).json({ error: 'prediction must be "yes" or "no"' });
      return;
    }
    if (!Number.isFinite(parsedConfidence) || parsedConfidence < 0 || parsedConfidence > 1) {
      res.status(400).json({ error: 'confidence must be between 0 and 1' });
      return;
    }

    const result = await recordPrediction(db, {
      agentId: req.params.id,
      marketId,
      prediction,
      confidence: parsedConfidence,
      reasoning,
    });
    res.json({ prediction: result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/agents/:id/predictions — prediction history
router.get('/:id/predictions', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rawLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
    const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 50, 100));
    const predictions = (await db.query(
      'SELECT * FROM agent_predictions WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2',
      [req.params.id, limit]
    )).rows;
    res.json({ predictions });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agents/:id/style-profile — style profile
router.get('/:id/style-profile', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { analyzeStyle } = require('../engine/agent-prediction');
    const report = await analyzeStyle(db, req.params.id);
    res.json({ profile: report });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/agents/:id/suggest — generate suggestion
router.post('/:id/suggest', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { generateSuggestion } = require('../engine/agent-advisor');
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    const { marketId } = req.body;
    const suggestion = await generateSuggestion(db, req.params.id, marketId);
    res.json({ suggestion });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/agents/:id/execute-suggestion — execute suggestion with risk confirmation
router.post('/:id/execute-suggestion', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { calculateRisk } = require('../engine/agent-advisor');
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    const { suggestionId, riskConfirmed } = req.body;
    if (!riskConfirmed) {
      res.status(400).json({ error: '请确认你已了解交易风险' });
      return;
    }

    const suggestion = (await db.query('SELECT * FROM agent_trade_suggestions WHERE id = $1 AND agent_id = $2', [suggestionId, req.params.id])).rows[0] as any;
    if (!suggestion) { res.status(404).json({ error: 'Suggestion not found' }); return; }
    if (suggestion.user_action) { res.status(400).json({ error: '建议已被处理' }); return; }

    // Mark as accepted
    await db.query('UPDATE agent_trade_suggestions SET user_action = $1, acted_at = $2 WHERE id = $3',
      ['accepted', Date.now(), suggestionId]);

    res.json({ success: true, suggestion: { ...suggestion, user_action: 'accepted' } });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/agents/:id/authorize-trade — authorize auto trading
router.post('/:id/authorize-trade', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    const parsedMaxPerTrade = parsePositiveNumber(req.body?.maxPerTrade);
    const parsedMaxDailyAmount = parsePositiveNumber(req.body?.maxDailyAmount);
    const parsedDurationHours = parsePositiveInteger(req.body?.durationHours);

    if (parsedMaxPerTrade === null) { res.status(400).json({ error: 'Invalid maxPerTrade' }); return; }
    if (parsedMaxDailyAmount === null) { res.status(400).json({ error: 'Invalid maxDailyAmount' }); return; }
    if (parsedDurationHours === null || parsedDurationHours < 1 || parsedDurationHours > 720) {
      res.status(400).json({ error: 'Duration must be 1-720 hours' });
      return;
    }

    const expiresAt = Date.now() + parsedDurationHours * 3600000;

    await db.query(`
      UPDATE agents SET
        prediction_mode = 'auto_trade',
        auto_trade_enabled = 1,
        max_per_trade = $1,
        max_daily_amount = $2,
        daily_trade_used = 0,
        auto_trade_expires = $3
      WHERE id = $4
    `, [parsedMaxPerTrade, parsedMaxDailyAmount, expiresAt, req.params.id]);

    const updated = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    res.json({ agent: updated });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/agents/:id/revoke-trade — revoke auto trading
router.post('/:id/revoke-trade', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    await db.query(`
      UPDATE agents SET
        prediction_mode = 'observe',
        auto_trade_enabled = 0,
        auto_trade_expires = NULL
      WHERE id = $1
    `, [req.params.id]);

    const updated = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    res.json({ agent: updated });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/agents/:id/vault — update vault
router.put('/:id/vault', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { vaultURI, vaultHash } = req.body;
    const userAddress = req.userAddress;

    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address.toLowerCase() !== userAddress!.toLowerCase()) {
      res.status(403).json({ error: 'Not owner' });
      return;
    }

    await db.query('UPDATE agents SET vault_uri = $1, vault_hash = $2 WHERE id = $3',
      [vaultURI || null, vaultHash || null, id]);

    res.json({ success: true, vaultURI, vaultHash });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agents/:id/vault — get vault info
router.get('/:id/vault', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const agent = (await db.query('SELECT vault_uri, vault_hash FROM agents WHERE id = $1', [id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json({ vaultURI: agent.vault_uri, vaultHash: agent.vault_hash });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agents/:id/learning-metrics — learning metrics
router.get('/:id/learning-metrics', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { getLearningMetrics } = require('../engine/agent-learning');
    const metrics = await getLearningMetrics(db, req.params.id);
    res.json({ metrics });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
