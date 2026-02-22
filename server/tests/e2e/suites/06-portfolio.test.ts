import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestWallet,
  getTestPool,
  cleanDatabase,
  authenticateUser,
  seedTestMarket,
  seedBalance,
  createAuthClient,
  createPublicClient,
} from '../setup/test-helpers';

describe('Portfolio', () => {
  const pool = getTestPool();
  const publicClient = createPublicClient();

  // Wallets for portfolio tests (index 40-49)
  const portfolioWallet = createTestWallet(40);
  let portfolioToken: string;
  let portfolioAddress: string;
  let portfolioClient: ReturnType<typeof createAuthClient>;

  let marketId: string;

  beforeAll(async () => {
    await cleanDatabase(pool);

    // Authenticate
    const auth = await authenticateUser(portfolioWallet);
    portfolioToken = auth.token;
    portfolioAddress = auth.address;
    portfolioClient = createAuthClient(portfolioToken);

    // Seed market and balance
    marketId = await seedTestMarket(pool, {
      id: 'e2e-portfolio-market',
      title: 'Portfolio Test Market',
      category: 'meme',
      status: 'active',
    });

    await seedBalance(pool, portfolioAddress, 10000);
  });

  afterAll(async () => {
    await cleanDatabase(pool);
  });

  it('GET /api/positions returns user positions (empty initially)', async () => {
    const res = await portfolioClient.get('/api/positions');
    expect(res.status).toBe(200);
    const body = await res.json();
    const positions = Array.isArray(body) ? body : body.positions;
    expect(Array.isArray(positions)).toBe(true);
    expect(positions.length).toBe(0);
  });

  it('GET /api/balances returns user balance', async () => {
    const res = await portfolioClient.get('/api/balances');
    expect(res.status).toBe(200);
    const body = await res.json();
    // Should contain available balance
    const available = body.available ?? body.balance;
    expect(available).toBeDefined();
    expect(Number(available)).toBeGreaterThan(0);
  });

  it('After seeding position, positions show the new position', async () => {
    // Seed a position directly (v2: trading is on-chain, not via API)
    await pool.query(
      `INSERT INTO positions (id, market_id, user_address, side, shares, avg_cost, created_at)
       VALUES ($1, $2, $3, 'yes', 100, 0.5, $4)
       ON CONFLICT DO NOTHING`,
      [`pos-${Date.now()}`, marketId, portfolioAddress, Date.now()]
    );

    // Check positions
    const posRes = await portfolioClient.get('/api/positions');
    expect(posRes.status).toBe(200);
    const posBody = await posRes.json();
    const positions = Array.isArray(posBody) ? posBody : posBody.positions;
    expect(positions.length).toBeGreaterThanOrEqual(1);

    const yesPos = positions.find(
      (p: any) =>
        (p.market_id === marketId || p.marketId === marketId) &&
        p.side === 'yes'
    );
    expect(yesPos).toBeDefined();
    expect(Number(yesPos.shares)).toBeGreaterThan(0);
  });

  it('GET /api/portfolio/:address returns public positions', async () => {
    const res = await publicClient.get(`/api/portfolio/${portfolioAddress}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  it('GET /api/portfolio/:address/history returns trade history (auth required, must be own address)', async () => {
    const res = await portfolioClient.get(
      `/api/portfolio/${portfolioAddress}/history`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
    // Should be an array or contain a history array
    const history = Array.isArray(body) ? body : body.history ?? body.trades;
    expect(Array.isArray(history)).toBe(true);
  });

  it('GET /api/portfolio/:address/balance returns balance details', async () => {
    const res = await portfolioClient.get(
      `/api/portfolio/${portfolioAddress}/balance`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
    // Should have balance info
    const available = body.available ?? body.balance;
    expect(available).toBeDefined();
  });

  it('GET /api/portfolio/:address/stats returns user stats', async () => {
    const res = await portfolioClient.get(
      `/api/portfolio/${portfolioAddress}/stats`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });
});
