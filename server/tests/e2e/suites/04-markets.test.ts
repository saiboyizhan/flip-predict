import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestPool,
  cleanDatabase,
  seedTestMarket,
  createPublicClient,
} from '../setup/test-helpers';

describe('Markets', () => {
  const pool = getTestPool();
  const client = createPublicClient();

  let marketId1: string;
  let marketId2: string;
  let marketId3: string;

  beforeAll(async () => {
    await cleanDatabase(pool);

    // Seed 3 test markets with distinct categories and titles
    marketId1 = await seedTestMarket(pool, {
      id: 'e2e-market-meme-1',
      title: 'Will DOGE reach $1 by 2027?',
      category: 'meme',
      status: 'active',
    });

    marketId2 = await seedTestMarket(pool, {
      id: 'e2e-market-defi-1',
      title: 'Will ETH flip BTC market cap?',
      category: 'defi',
      status: 'active',
    });

    marketId3 = await seedTestMarket(pool, {
      id: 'e2e-market-pending-1',
      title: 'Pending approval market',
      category: 'meme',
      status: 'pending_approval',
    });
  });

  afterAll(async () => {
    await cleanDatabase(pool);
  });

  it('GET /api/markets returns market list', async () => {
    const res = await client.get('/api/markets');
    expect(res.status).toBe(200);
    const body = await res.json();
    // Could be { markets: [...] } or directly an array
    const markets = Array.isArray(body) ? body : body.markets;
    expect(Array.isArray(markets)).toBe(true);
    expect(markets.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /api/markets?category=meme filters by category', async () => {
    const res = await client.get('/api/markets?category=meme');
    expect(res.status).toBe(200);
    const body = await res.json();
    const markets = Array.isArray(body) ? body : body.markets;
    expect(Array.isArray(markets)).toBe(true);
    for (const m of markets) {
      expect(m.category).toBe('meme');
    }
  });

  it('GET /api/markets?sort=newest sorts by newest', async () => {
    const res = await client.get('/api/markets?sort=newest');
    expect(res.status).toBe(200);
    const body = await res.json();
    const markets = Array.isArray(body) ? body : body.markets;
    expect(Array.isArray(markets)).toBe(true);
    // Verify descending order by created_at
    for (let i = 1; i < markets.length; i++) {
      const prev = markets[i - 1].created_at ?? markets[i - 1].createdAt;
      const curr = markets[i].created_at ?? markets[i].createdAt;
      expect(Number(prev)).toBeGreaterThanOrEqual(Number(curr));
    }
  });

  it('GET /api/markets?search=keyword searches title/description', async () => {
    const res = await client.get('/api/markets?search=DOGE');
    expect(res.status).toBe(200);
    const body = await res.json();
    const markets = Array.isArray(body) ? body : body.markets;
    expect(Array.isArray(markets)).toBe(true);
    expect(markets.length).toBeGreaterThanOrEqual(1);
    const found = markets.some(
      (m: any) =>
        m.title.toLowerCase().includes('doge') ||
        (m.description && m.description.toLowerCase().includes('doge'))
    );
    expect(found).toBe(true);
  });

  it('GET /api/markets/:id returns market detail', async () => {
    const res = await client.get(`/api/markets/${marketId1}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const market = body.market ?? body;
    expect(market.id).toBe(marketId1);
    expect(market.title).toBeDefined();
    expect(market.category).toBe('meme');
  });

  it('GET /api/markets/:id returns 404 for nonexistent', async () => {
    const res = await client.get('/api/markets/does-not-exist-xyz');
    expect(res.status).toBe(404);
  });

  it('GET /api/markets/:id/activity returns trading activity', async () => {
    const res = await client.get(`/api/markets/${marketId1}/activity`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Should return an array or object with activity data
    expect(body).toBeDefined();
  });

  it('GET /api/markets/:id/history returns price history', async () => {
    const res = await client.get(`/api/markets/${marketId1}/history`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  it('GET /api/markets/:id/related returns related markets', async () => {
    const res = await client.get(`/api/markets/${marketId1}/related`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  it('GET /api/markets/stats returns platform stats', async () => {
    const res = await client.get('/api/markets/stats');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  it('GET /api/markets/search?q=keyword returns search results', async () => {
    const res = await client.get('/api/markets/search?q=ETH');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  it('GET /api/markets/search without q returns 400', async () => {
    const res = await client.get('/api/markets/search');
    expect(res.status).toBe(400);
  });

  it('Markets exclude pending_approval/rejected by default', async () => {
    const res = await client.get('/api/markets');
    expect(res.status).toBe(200);
    const body = await res.json();
    const markets = Array.isArray(body) ? body : body.markets;
    // The pending_approval market should not appear
    const pendingFound = markets.some((m: any) => m.id === marketId3);
    expect(pendingFound).toBe(false);
  });

  it('GET /api/markets?status=pending_approval without admin returns filtered list (no pending)', async () => {
    const res = await client.get('/api/markets?status=pending_approval');
    expect(res.status).toBe(200);
    const body = await res.json();
    const markets = Array.isArray(body) ? body : body.markets;
    // Non-admin should not see pending markets
    const pendingFound = markets.some(
      (m: any) => m.status === 'pending_approval'
    );
    expect(pendingFound).toBe(false);
  });
});
