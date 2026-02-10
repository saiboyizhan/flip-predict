import { Pool } from 'pg';
import { generateDecisions, StrategyType } from './agent-strategy';

function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

const WIN_RATES: Record<StrategyType, number> = {
  conservative: 0.60,
  aggressive: 0.45,
  contrarian: 0.55,
  momentum: 0.58,
  random: 0.50,
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
}

export async function runAgentCycle(db: Pool, agentId: string): Promise<void> {
  const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [agentId])).rows[0] as AgentRow | undefined;
  if (!agent) return;
  if (agent.status !== 'active' || agent.wallet_balance < 1) return;

  const strategy = agent.strategy as StrategyType;
  const decisions = await generateDecisions(db, strategy, agent.wallet_balance);

  if (decisions.length === 0) return;

  const winRate = WIN_RATES[strategy] ?? 0.50;

  let { wallet_balance, total_trades, winning_trades, total_profit, experience, level } = agent;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    for (const d of decisions) {
      if (d.action !== 'buy') continue;
      if (d.amount > wallet_balance || d.amount < 0.01) continue;

      wallet_balance -= d.amount;
      total_trades += 1;

      // Simulate price as the confidence (proxy)
      const price = Math.max(0.1, Math.min(0.9, d.confidence));
      const shares = d.amount / price;

      // Determine outcome
      const won = Math.random() < winRate;
      let profit: number;
      let outcome: string;

      if (won) {
        profit = Math.round((d.amount * (1 / price - 1)) * 100) / 100;
        wallet_balance += d.amount + profit;
        winning_trades += 1;
        outcome = 'win';
      } else {
        profit = -d.amount;
        outcome = 'loss';
      }

      total_profit = Math.round((total_profit + profit) * 100) / 100;
      experience += 10;

      // Level up: every 100 exp, max level 10
      const newLevel = Math.min(10, Math.floor(experience / 100) + 1);
      if (newLevel > level) level = newLevel;

      await client.query(`
        INSERT INTO agent_trades (id, agent_id, market_id, side, amount, shares, price, outcome, profit, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        generateId(),
        agentId,
        d.marketId,
        d.side,
        d.amount,
        Math.round(shares * 100) / 100,
        Math.round(price * 10000) / 10000,
        outcome,
        profit,
        Date.now()
      ]);
    }

    const wr = total_trades > 0 ? Math.round((winning_trades / total_trades) * 100) : 0;
    const roi = Math.round((total_profit / 1000) * 100); // ROI based on initial 1000

    await client.query(`
      UPDATE agents SET
        wallet_balance = $1,
        total_trades = $2,
        winning_trades = $3,
        total_profit = $4,
        win_rate = $5,
        roi = $6,
        experience = $7,
        level = $8,
        last_trade_at = $9
      WHERE id = $10
    `, [
      Math.round(wallet_balance * 100) / 100,
      total_trades,
      winning_trades,
      total_profit,
      wr,
      roi,
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
  console.log(`Agent Runner started (${intervalMs / 1000}s interval)`);
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
