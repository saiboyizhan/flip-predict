import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { runSwarmAnalysis } from '../engine/swarm-ai';
import { getDb } from '../db';

const router = Router();

const swarmLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many swarm analysis requests. Please wait a minute.' },
});

// POST /api/swarm/analyze
router.post('/analyze', swarmLimiter, async (req: Request, res: Response) => {
  const { tokenName } = req.body;

  if (!tokenName || typeof tokenName !== 'string' || tokenName.trim().length === 0) {
    res.status(400).json({ error: 'tokenName is required' });
    return;
  }

  await runSwarmAnalysis(req, res);
});

// GET /api/swarm/history
router.get('/history', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const tokenName = req.query.tokenName as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    let query = `SELECT id, token_name, chain, category, team_agents, team_weights,
      initial_consensus, final_consensus, price_at_analysis, price_after_24h,
      price_change_pct, direction_correct, verified_at, created_at
      FROM swarm_analyses`;
    const params: any[] = [];

    if (tokenName) {
      query += ' WHERE token_name ILIKE $1';
      params.push(`%${tokenName}%`);
    }

    query += ' ORDER BY created_at DESC';
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    res.json({ analyses: result.rows });
  } catch (err) {
    console.error('[Swarm] History error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// GET /api/swarm/history/:id
router.get('/history/:id', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const analysisRes = await db.query('SELECT * FROM swarm_analyses WHERE id = $1', [id]);
    if (analysisRes.rows.length === 0) {
      res.status(404).json({ error: 'Analysis not found' });
      return;
    }

    const scoresRes = await db.query(
      'SELECT * FROM swarm_agent_scores WHERE analysis_id = $1 ORDER BY agent_id',
      [id]
    );

    res.json({ analysis: analysisRes.rows[0], agentScores: scoresRes.rows });
  } catch (err) {
    console.error('[Swarm] Detail error:', err);
    res.status(500).json({ error: 'Failed to fetch analysis detail' });
  }
});

// GET /api/swarm/accuracy
router.get('/accuracy', async (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const result = await db.query(
      `SELECT COUNT(*) as total,
        COUNT(*) FILTER (WHERE direction_correct = true) as correct,
        ROUND(AVG(final_consensus), 1) as avg_consensus,
        ROUND(AVG(price_change_pct)::NUMERIC, 2) as avg_price_change
      FROM swarm_analyses WHERE verified_at IS NOT NULL`
    );

    const row = result.rows[0];
    const total = parseInt(row.total);
    const correct = parseInt(row.correct);

    res.json({
      total,
      correct,
      accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      avgConsensus: parseFloat(row.avg_consensus) || 0,
      avgPriceChange: parseFloat(row.avg_price_change) || 0,
    });
  } catch (err) {
    console.error('[Swarm] Accuracy error:', err);
    res.status(500).json({ error: 'Failed to fetch accuracy' });
  }
});

// GET /api/swarm/agents/stats
router.get('/agents/stats', async (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const result = await db.query(
      `SELECT agent_id, total_analyses, correct_predictions, accuracy,
        avg_initial_score, avg_revised_score, avg_score_shift, category_accuracy, updated_at
      FROM swarm_agent_stats ORDER BY accuracy DESC`
    );

    res.json({ agents: result.rows });
  } catch (err) {
    console.error('[Swarm] Agent stats error:', err);
    res.status(500).json({ error: 'Failed to fetch agent stats' });
  }
});

export default router;
