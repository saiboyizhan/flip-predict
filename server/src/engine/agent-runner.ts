import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { StrategyType } from './agent-strategy';
import { generateLlmDecisions } from './agent-llm-adapter';
import { isAgentChainEnabled, executeAgentBuyOnChain } from './agent-chain';

const roundTo = (n: number, decimals: number): number => {
  const multiplier = 10 ** decimals;
  return Math.round(n * multiplier) / multiplier;
};

interface AgentRow {
  id: string;
  strategy: StrategyType;
  status: string;
  wallet_balance: number;
  total_trades: number;
  winning_trades: number;
  total_profit: number;
  experience: number;
  level: number;
  combo_weights: string | null;
  token_id: number | null;
}

export async function runAgentCycle(db: Pool, agentId: string): Promise<void> {
  const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [agentId])).rows[0] as AgentRow | undefined;
  if (!agent) return;
  if (agent.status !== 'active' || agent.wallet_balance < 1) return;

  const strategy = agent.strategy as StrategyType;

  const comboWeights = agent.combo_weights
    ? (typeof agent.combo_weights === 'string' ? (() => { try { return JSON.parse(agent.combo_weights as string); } catch { return null; } })() : agent.combo_weights)
    : null;
  const decisions = await generateLlmDecisions(db, agentId, strategy, agent.wallet_balance, comboWeights);

  if (decisions.length === 0) return;

  const chainEnabled = isAgentChainEnabled();
  const tokenId = agent.token_id;

  let { wallet_balance, total_trades, experience, level } = agent;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    for (const d of decisions) {
      if (d.action !== 'buy') continue;
      if (d.amount > wallet_balance || d.amount < 0.01) continue;

      // Look up on_chain_market_id for this market
      const marketRow = (await client.query(
        'SELECT on_chain_market_id FROM markets WHERE id = $1',
        [d.marketId]
      )).rows[0];
      const onChainMarketId = marketRow?.on_chain_market_id;

      wallet_balance -= d.amount;
      total_trades += 1;

      const price = Math.max(0.1, Math.min(0.9, d.confidence));
      const shares = d.amount / price;

      experience += 10;
      const newLevel = Math.min(10, Math.floor(experience / 100) + 1);
      if (newLevel > level) level = newLevel;

      // On-chain execution
      let txHash: string | null = null;
      if (chainEnabled && tokenId != null && onChainMarketId != null) {
        const isYes = d.side === 'yes';
        txHash = await executeAgentBuyOnChain(tokenId, onChainMarketId, isYes, d.amount);
        if (!txHash) {
          // On-chain failed — revert this trade's balance deduction and skip
          wallet_balance += d.amount;
          total_trades -= 1;
          console.warn(`[agent-runner] On-chain buy failed for agent ${agentId}, market ${d.marketId}, skipping`);
          continue;
        }
      }

      const tradeId = randomUUID();

      await client.query(`
        INSERT INTO agent_trades (id, agent_id, market_id, side, amount, shares, price,
                                  outcome, profit, status, reasoning, tx_hash, on_chain_market_id, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, 'pending', $8, $9, $10, $11)
      `, [
        tradeId,
        agentId,
        d.marketId,
        d.side,
        d.amount,
        roundTo(shares, 2),
        roundTo(price, 4),
        d.reasoning || null,
        txHash,
        onChainMarketId,
        Date.now()
      ]);
    }

    await client.query(`
      UPDATE agents SET
        wallet_balance = $1,
        total_trades = $2,
        experience = $3,
        level = $4,
        last_trade_at = $5
      WHERE id = $6
    `, [
      roundTo(wallet_balance, 2),
      total_trades,
      experience,
      level,
      Date.now(),
      agentId
    ]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function startAgentRunner(db: Pool, intervalMs: number = 60000): NodeJS.Timeout {
  console.info(`Agent Runner started (${intervalMs / 1000}s interval)`);
  let isRunning = false;

  const run = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      const agents = (await db.query("SELECT id FROM agents WHERE status = 'active'")).rows as { id: string }[];
      for (const agent of agents) {
        try {
          await runAgentCycle(db, agent.id);
        } catch (err: any) {
          console.error(`Agent ${agent.id} cycle error:`, err.message);
        }
      }
    } catch (err: any) {
      console.error('Agent runner cycle error:', err.message);
    } finally {
      isRunning = false;
    }
  };

  // First run delayed 10s to let seed complete
  setTimeout(() => { void run(); }, 10000);
  return setInterval(() => { void run(); }, intervalMs);
}
