import { Pool } from 'pg';

async function fetchCoinGeckoPrice(tokenName: string): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const id = tokenName.toLowerCase().replace(/\s+/g, '-');
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json() as Record<string, { usd?: number }>;
    return data[id]?.usd ?? null;
  } catch {
    return null;
  }
}

async function verifySwarmAnalyses(db: Pool): Promise<void> {
  // Find analyses that are 24h+ old, have a price_at_analysis, and haven't been verified
  const unverifiedRes = await db.query(
    `SELECT id, token_name, final_consensus, price_at_analysis, team_agents
     FROM swarm_analyses
     WHERE verified_at IS NULL
       AND price_at_analysis IS NOT NULL
       AND created_at <= NOW() - INTERVAL '24 hours'
     ORDER BY created_at ASC
     LIMIT 20`
  );

  if (unverifiedRes.rows.length === 0) return;

  for (const row of unverifiedRes.rows) {
    const client = await db.connect();
    try {
      const priceAfter = await fetchCoinGeckoPrice(row.token_name);
      if (priceAfter === null) continue;

      const priceBefore = Number(row.price_at_analysis);
      const priceChangePct = ((priceAfter - priceBefore) / priceBefore) * 100;
      // consensus > 50 means predicted UP
      const predictedUp = row.final_consensus > 50;
      const actualUp = priceAfter > priceBefore;
      const directionCorrect = predictedUp === actualUp;

      await client.query('BEGIN');

      // Update the analysis record
      await client.query(
        `UPDATE swarm_analyses
         SET price_after_24h = $1, price_change_pct = $2, direction_correct = $3, verified_at = NOW()
         WHERE id = $4`,
        [priceAfter, priceChangePct, directionCorrect, row.id]
      );

      // Update individual agent scores
      const agentScoresRes = await client.query(
        'SELECT id, agent_id, revised_score, initial_score FROM swarm_agent_scores WHERE analysis_id = $1',
        [row.id]
      );

      for (const agent of agentScoresRes.rows) {
        const agentPredictedUp = agent.revised_score > 50;
        const agentCorrect = agentPredictedUp === actualUp;

        await client.query(
          'UPDATE swarm_agent_scores SET direction_correct = $1 WHERE id = $2',
          [agentCorrect, agent.id]
        );

        // UPSERT agent stats
        await client.query(
          `INSERT INTO swarm_agent_stats (agent_id, total_analyses, correct_predictions, accuracy,
             avg_initial_score, avg_revised_score, avg_score_shift, updated_at)
           VALUES ($1, 1, CASE WHEN $2 THEN 1 ELSE 0 END, CASE WHEN $2 THEN 100 ELSE 0 END,
             $3, $4, $4 - $3, NOW())
           ON CONFLICT (agent_id) DO UPDATE SET
             total_analyses = swarm_agent_stats.total_analyses + 1,
             correct_predictions = swarm_agent_stats.correct_predictions + CASE WHEN $2 THEN 1 ELSE 0 END,
             accuracy = ROUND(
               (swarm_agent_stats.correct_predictions + CASE WHEN $2 THEN 1 ELSE 0 END)::NUMERIC
               / (swarm_agent_stats.total_analyses + 1) * 100, 2
             ),
             avg_initial_score = ROUND(
               (swarm_agent_stats.avg_initial_score * swarm_agent_stats.total_analyses + $3)
               / (swarm_agent_stats.total_analyses + 1), 2
             ),
             avg_revised_score = ROUND(
               (swarm_agent_stats.avg_revised_score * swarm_agent_stats.total_analyses + $4)
               / (swarm_agent_stats.total_analyses + 1), 2
             ),
             avg_score_shift = ROUND(
               (swarm_agent_stats.avg_score_shift * swarm_agent_stats.total_analyses + ($4 - $3))
               / (swarm_agent_stats.total_analyses + 1), 2
             ),
             updated_at = NOW()`,
          [agent.agent_id, agentCorrect, agent.initial_score ?? 50, agent.revised_score ?? 50]
        );
      }

      await client.query('COMMIT');
      console.log(`[SwarmVerifier] Verified analysis #${row.id}: ${row.token_name} direction_correct=${directionCorrect} (${priceChangePct.toFixed(2)}%)`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[SwarmVerifier] Failed to verify analysis #${row.id}:`, err);
    } finally {
      client.release();
    }
  }
}

export function startSwarmVerifier(db: Pool, intervalMs: number = 300000): NodeJS.Timeout {
  console.log(`[SwarmVerifier] Started (${intervalMs / 1000}s interval)`);
  let isRunning = false;

  const run = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await verifySwarmAnalyses(db);
    } catch (err) {
      console.error('[SwarmVerifier] Error:', err);
    } finally {
      isRunning = false;
    }
  };

  void run();
  return setInterval(() => {
    void run();
  }, intervalMs);
}
