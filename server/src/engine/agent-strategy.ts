import { Pool } from 'pg';

export type StrategyType = 'conservative' | 'aggressive' | 'contrarian' | 'momentum' | 'random';

export interface AgentDecision {
  action: 'buy' | 'sell' | 'hold';
  marketId: string;
  side: 'yes' | 'no';
  amount: number;
  confidence: number;
  reasoning: string;
}

interface MarketRow {
  id: string;
  title: string;
  yes_price: number;
  no_price: number;
  status: string;
}

export async function generateDecisions(
  db: Pool,
  strategy: StrategyType,
  walletBalance: number
): Promise<AgentDecision[]> {
  const markets = (await db.query(
    "SELECT id, title, yes_price, no_price, status FROM markets WHERE status = 'active'"
  )).rows as MarketRow[];

  if (markets.length === 0 || walletBalance < 1) return [];

  switch (strategy) {
    case 'conservative':
      return conservativeStrategy(markets, walletBalance);
    case 'aggressive':
      return aggressiveStrategy(markets, walletBalance);
    case 'contrarian':
      return contrarianStrategy(markets, walletBalance);
    case 'momentum':
      return momentumStrategy(markets, walletBalance);
    case 'random':
      return randomStrategy(markets, walletBalance);
    default:
      return [];
  }
}

function conservativeStrategy(markets: MarketRow[], balance: number): AgentDecision[] {
  const candidates = markets.filter(m => m.yes_price >= 0.35 && m.yes_price <= 0.65);
  if (candidates.length === 0) return [];

  const picked = shuffle(candidates).slice(0, randInt(1, 3));
  return picked.map(m => {
    const pct = 0.03 + Math.random() * 0.02; // 3~5%
    const side: 'yes' | 'no' = m.yes_price >= 0.5 ? 'yes' : 'no';
    return {
      action: 'buy' as const,
      marketId: m.id,
      side,
      amount: Math.round(balance * pct * 100) / 100,
      confidence: 0.6 + Math.random() * 0.15,
      reasoning: `Conservative: balanced price ${m.yes_price.toFixed(2)}, buying ${side}`,
    };
  });
}

function aggressiveStrategy(markets: MarketRow[], balance: number): AgentDecision[] {
  const candidates = markets.filter(m => m.yes_price < 0.25 || m.yes_price > 0.75);
  if (candidates.length === 0) return [];

  const picked = shuffle(candidates).slice(0, randInt(1, 3));
  return picked.map(m => {
    const pct = 0.10 + Math.random() * 0.10; // 10~20%
    const side: 'yes' | 'no' = m.yes_price > 0.75 ? 'yes' : 'no';
    return {
      action: 'buy' as const,
      marketId: m.id,
      side,
      amount: Math.round(balance * pct * 100) / 100,
      confidence: 0.7 + Math.random() * 0.2,
      reasoning: `Aggressive: extreme price ${m.yes_price.toFixed(2)}, betting heavy on ${side}`,
    };
  });
}

function contrarianStrategy(markets: MarketRow[], balance: number): AgentDecision[] {
  if (markets.length === 0) return [];

  const picked = shuffle(markets).slice(0, randInt(1, 3));
  return picked.map(m => {
    const pct = 0.05 + Math.random() * 0.05; // 5~10%
    const side: 'yes' | 'no' = m.yes_price > 0.5 ? 'no' : 'yes';
    return {
      action: 'buy' as const,
      marketId: m.id,
      side,
      amount: Math.round(balance * pct * 100) / 100,
      confidence: 0.5 + Math.random() * 0.2,
      reasoning: `Contrarian: going against majority, buying ${side} at ${m.yes_price.toFixed(2)}`,
    };
  });
}

function momentumStrategy(markets: MarketRow[], balance: number): AgentDecision[] {
  if (markets.length === 0) return [];

  const picked = shuffle(markets).slice(0, randInt(1, 3));
  return picked.map(m => {
    const pct = 0.08 + Math.random() * 0.07; // 8~15%
    const side: 'yes' | 'no' = m.yes_price >= 0.5 ? 'yes' : 'no';
    return {
      action: 'buy' as const,
      marketId: m.id,
      side,
      amount: Math.round(balance * pct * 100) / 100,
      confidence: 0.55 + Math.random() * 0.25,
      reasoning: `Momentum: following trend, ${side} at ${m.yes_price.toFixed(2)}`,
    };
  });
}

function randomStrategy(markets: MarketRow[], balance: number): AgentDecision[] {
  if (markets.length === 0) return [];

  const picked = shuffle(markets).slice(0, randInt(1, 3));
  return picked.map(m => {
    const pct = 0.01 + Math.random() * 0.09; // 1~10%
    const side: 'yes' | 'no' = Math.random() > 0.5 ? 'yes' : 'no';
    return {
      action: 'buy' as const,
      marketId: m.id,
      side,
      amount: Math.round(balance * pct * 100) / 100,
      confidence: Math.random(),
      reasoning: `Random: coin flip says ${side} on ${m.id}`,
    };
  });
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
