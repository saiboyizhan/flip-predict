import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestPool,
  createTestWallet,
  authenticateUser,
  createAuthClient,
  seedUser,
  seedTestMarket,
  seedPosition,
  seedBalance,
  cleanDatabase,
} from '../setup/test-helpers';

describe('Settlement API', () => {
  const pool = getTestPool();
  let token: string;
  let address: string;

  const activeMarketId = 'settle-active-market';
  const resolvedMarketId = 'settle-resolved-market';

  beforeAll(async () => {
    await cleanDatabase(pool);

    // Authenticate user
    const wallet = createTestWallet(14);
    const auth = await authenticateUser(wallet);
    token = auth.token;
    address = auth.address;

    // Seed an active market (not resolved)
    await seedTestMarket(pool, { id: activeMarketId, status: 'active' });

    // Seed a resolved market
    await seedTestMarket(pool, { id: resolvedMarketId, status: 'resolved' });

    // Insert market_resolution row with outcome='yes'
    await pool.query(
      `INSERT INTO market_resolution (market_id, outcome, resolved_at)
       VALUES ($1, 'yes', $2)
       ON CONFLICT (market_id) DO NOTHING`,
      [resolvedMarketId, Date.now()]
    );

    // Seed a winning position for the user: 100 YES shares at avg_cost=0.5
    await seedPosition(pool, address, resolvedMarketId, 'yes', 100, 0.5);

    // Set user balance to 0 so we can verify claim credits it
    await seedBalance(pool, address, 0);

    // Seed a filled order so net_deposits can be calculated
    const orderId = 'ord-settle-test1';
    await pool.query(
      `INSERT INTO orders (id, user_address, market_id, side, type, amount, shares, price, status, created_at)
       VALUES ($1, $2, $3, 'yes', 'buy', 50, 100, 0.5, 'filled', $4)
       ON CONFLICT (id) DO NOTHING`,
      [orderId, address.toLowerCase(), resolvedMarketId, Date.now()]
    );
  });

  afterAll(async () => {
    await cleanDatabase(pool);
  });

  it('GET /api/settlement/resolved returns resolved markets list', async () => {
    const client = createAuthClient(token);
    const res = await client.get('/api/settlement/resolved');
    expect(res.status).toBe(200);
    const body = await res.json();
    // Server returns { markets: [...] }
    const markets = Array.isArray(body) ? body : body.markets;
    expect(Array.isArray(markets)).toBe(true);
    // Should contain the resolved market
    const ids = markets.map((m: any) => m.id || m.market_id);
    expect(ids).toContain(resolvedMarketId);
  });

  it('GET /api/settlement/:marketId returns settlement info for a market', async () => {
    const client = createAuthClient(token);
    const res = await client.get(`/api/settlement/${resolvedMarketId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
    // Server returns { resolution, logs, proposals, challenges }
    expect(body.resolution).toBeDefined();
    expect(body.resolution.outcome).toBe('yes');
  });

  it('POST /api/settlement/:marketId/claim on non-resolved market returns 400', async () => {
    const client = createAuthClient(token);
    const res = await client.post(`/api/settlement/${activeMarketId}/claim`);
    expect(res.status).toBe(400);
  });

  it('POST /api/settlement/:marketId/claim on resolved market with winning position pays out', async () => {
    const client = createAuthClient(token);
    const res = await client.post(`/api/settlement/${resolvedMarketId}/claim`);
    expect([200, 201]).toContain(res.status);
    const body = await res.json();
    expect(body).toBeDefined();

    // Verify balance was credited (user had 0 before, winning 100 shares at outcome=yes)
    const balRes = await client.get('/api/balances');
    expect(balRes.status).toBe(200);
    const balBody = await balRes.json();
    expect(balBody.available).toBeGreaterThan(0);
  });
});
