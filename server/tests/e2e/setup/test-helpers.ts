import { ethers } from 'ethers';
import { Pool } from 'pg';

const MNEMONIC = 'test test test test test test test test test test test junk';
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3099';
const TEST_DB = 'prediction_test';

// ============ Wallet Helpers ============

export function createTestWallet(index: number): ethers.HDNodeWallet {
  return ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(MNEMONIC),
    `m/44'/60'/0'/0/${index}`
  );
}

export function getAdminWallet(): ethers.HDNodeWallet {
  return createTestWallet(99);
}

// ============ Database Pool ============

let _pool: Pool | null = null;

export function getTestPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      host: process.env.PG_HOST || 'localhost',
      port: parseInt(process.env.PG_PORT || '5432', 10),
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || 'postgres',
      database: TEST_DB,
    });
  }
  return _pool;
}

export async function closeTestPool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

// ============ Authentication ============

export async function authenticateUser(
  wallet: ethers.HDNodeWallet
): Promise<{ token: string; address: string }> {
  const address = wallet.address.toLowerCase();

  // 1. Get nonce
  const nonceRes = await fetch(`${BASE_URL}/api/auth/nonce/${address}`);
  if (!nonceRes.ok) throw new Error(`Nonce failed: ${nonceRes.status}`);
  const { message } = await nonceRes.json();

  // 2. Sign message
  const signature = await wallet.signMessage(message);

  // 3. Verify
  const verifyRes = await fetch(`${BASE_URL}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, signature }),
  });
  if (!verifyRes.ok) throw new Error(`Verify failed: ${verifyRes.status}`);
  const { token } = await verifyRes.json();

  return { token, address };
}

// ============ HTTP Client ============

interface AuthClient {
  get: (path: string) => Promise<Response>;
  post: (path: string, body?: any) => Promise<Response>;
  put: (path: string, body?: any) => Promise<Response>;
  del: (path: string, body?: any) => Promise<Response>;
}

export function createAuthClient(token: string): AuthClient {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  return {
    get: (path: string) =>
      fetch(`${BASE_URL}${path}`, { headers }),
    post: (path: string, body?: any) =>
      fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    put: (path: string, body?: any) =>
      fetch(`${BASE_URL}${path}`, {
        method: 'PUT',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    del: (path: string, body?: any) =>
      fetch(`${BASE_URL}${path}`, {
        method: 'DELETE',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
  };
}

export function createPublicClient() {
  return {
    get: (path: string) => fetch(`${BASE_URL}${path}`),
    post: (path: string, body?: any) =>
      fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
  };
}

// ============ Seed Helpers ============

export async function seedTestMarket(
  pool: Pool,
  overrides: Partial<{
    id: string;
    title: string;
    category: string;
    status: string;
    endTime: number;
    yesPrice: number;
    noPrice: number;
    volume: number;
    onChainMarketId: number;
  }> = {}
): Promise<string> {
  const id = overrides.id || 'test-market-' + Math.random().toString(36).slice(2, 10);
  const now = Date.now();
  await pool.query(
    `INSERT INTO markets (id, title, description, category, end_time, status, yes_price, no_price, volume, total_liquidity, yes_reserve, no_reserve, created_at, market_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 10000, 10000, 10000, $10, 'binary')
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      overrides.title || 'Test Market ' + id,
      'Test description',
      overrides.category || 'meme',
      overrides.endTime || now + 86400000,
      overrides.status || 'active',
      overrides.yesPrice ?? 0.5,
      overrides.noPrice ?? 0.5,
      overrides.volume ?? 0,
      now,
    ]
  );
  if (overrides.onChainMarketId != null) {
    await pool.query(
      'UPDATE markets SET on_chain_market_id = $1 WHERE id = $2',
      [overrides.onChainMarketId, id]
    );
  }
  return id;
}

export async function seedTestAgent(
  pool: Pool,
  ownerAddress: string,
  overrides: Partial<{
    id: string;
    name: string;
    strategy: string;
    tokenId: number;
  }> = {}
): Promise<string> {
  const id = overrides.id || 'agent-test-' + Math.random().toString(36).slice(2, 10);
  const now = Date.now();
  await pool.query(
    `INSERT INTO agents (id, name, owner_address, strategy, description, persona, avatar, wallet_balance, level, experience, created_at)
     VALUES ($1, $2, $3, $4, '', '', '/avatars/default.png', 1000, 1, 0, $5)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      overrides.name || 'Test Agent ' + id,
      ownerAddress.toLowerCase(),
      overrides.strategy || 'random',
      now,
    ]
  );
  if (overrides.tokenId != null) {
    await pool.query('UPDATE agents SET token_id = $1 WHERE id = $2', [overrides.tokenId, id]);
  }
  return id;
}

export async function seedBalance(
  pool: Pool,
  address: string,
  amount: number
): Promise<void> {
  await pool.query(
    `INSERT INTO balances (user_address, available, locked)
     VALUES ($1, $2, 0)
     ON CONFLICT (user_address) DO UPDATE SET available = $2`,
    [address.toLowerCase(), amount]
  );
}

export async function seedUser(
  pool: Pool,
  address: string
): Promise<void> {
  const now = Date.now();
  await pool.query(
    `INSERT INTO users (address, nonce, created_at)
     VALUES ($1, 'test-nonce', $2)
     ON CONFLICT (address) DO NOTHING`,
    [address.toLowerCase(), now]
  );
}

export async function seedPosition(
  pool: Pool,
  userAddress: string,
  marketId: string,
  side: string,
  shares: number,
  avgCost: number
): Promise<string> {
  const id = 'pos-' + Math.random().toString(36).slice(2, 10);
  const now = Date.now();
  await pool.query(
    `INSERT INTO positions (id, user_address, market_id, side, shares, avg_cost, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_address, market_id, side) DO UPDATE SET shares = $5, avg_cost = $6`,
    [id, userAddress.toLowerCase(), marketId, side, shares, avgCost, now]
  );
  return id;
}

export async function seedOrder(
  pool: Pool,
  userAddress: string,
  marketId: string,
  side: string,
  type: string,
  amount: number,
  shares: number,
  price: number
): Promise<string> {
  const id = 'ord-' + Math.random().toString(36).slice(2, 10);
  const now = Date.now();
  await pool.query(
    `INSERT INTO orders (id, user_address, market_id, side, type, amount, shares, price, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'filled', $9)`,
    [id, userAddress.toLowerCase(), marketId, side, type, amount, shares, price, now]
  );
  return id;
}

// ============ Cleanup ============

export async function cleanDatabase(pool: Pool): Promise<void> {
  // Order matters due to FK constraints
  const tables = [
    'agent_llm_config',
    'agent_owner_profile',
    'copy_trades',
    'agent_earnings',
    'agent_followers',
    'agent_trade_suggestions',
    'agent_style_profile',
    'agent_predictions',
    'agent_trades',
    'resolution_challenges',
    'resolution_proposals',
    'settlement_log',
    'market_resolution',
    'open_orders',
    'fee_records',
    'comments',
    'notifications',
    'option_price_history',
    'market_options',
    'positions',
    'orders',
    'price_history',
    'user_favorites',
    'user_follows',
    'user_profiles',
    'user_achievements',
    'user_created_markets',
    'market_creation_ratelimit',
    'referrals',
    'rewards',
    'deposits',
    'withdrawals',
    'agents',
    'markets',
    'balances',
    'users',
  ];
  for (const table of tables) {
    await pool.query(`DELETE FROM ${table}`).catch(() => {});
  }
}

export function getBaseUrl(): string {
  return BASE_URL;
}
