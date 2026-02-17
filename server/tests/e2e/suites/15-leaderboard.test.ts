import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestPool,
  createTestWallet,
  authenticateUser,
  createPublicClient,
  seedUser,
  seedTestMarket,
  seedBalance,
  seedOrder,
  cleanDatabase,
} from '../setup/test-helpers';

describe('Leaderboard API', () => {
  const pool = getTestPool();
  const marketId = 'lb-test-market';

  beforeAll(async () => {
    await cleanDatabase(pool);

    // Authenticate a couple of users and seed trade data for leaderboard content
    const wallet1 = createTestWallet(15);
    const auth1 = await authenticateUser(wallet1);
    const wallet2 = createTestWallet(16);
    const auth2 = await authenticateUser(wallet2);

    // Seed a market
    await seedTestMarket(pool, { id: marketId, status: 'resolved' });

    // Seed balances
    await seedBalance(pool, auth1.address, 5000);
    await seedBalance(pool, auth2.address, 3000);

    // Seed filled orders for both users so leaderboard has data
    await seedOrder(pool, auth1.address, marketId, 'yes', 'buy', 200, 400, 0.5);
    await seedOrder(pool, auth1.address, marketId, 'yes', 'sell', 300, 400, 0.75);
    await seedOrder(pool, auth2.address, marketId, 'no', 'buy', 100, 200, 0.5);

    // Seed settlement_log entries so profit/loss data exists
    const now = Date.now();
    await pool.query(
      `INSERT INTO settlement_log (id, market_id, action, user_address, amount, details, created_at)
       VALUES ($1, $2, 'settle_winner', $3, 400, '{}', $4)
       ON CONFLICT DO NOTHING`,
      ['sl-lb-1', marketId, auth1.address, now]
    ).catch(() => {});

    await pool.query(
      `INSERT INTO settlement_log (id, market_id, action, user_address, amount, details, created_at)
       VALUES ($1, $2, 'settle_loser', $3, 0, '{}', $4)
       ON CONFLICT DO NOTHING`,
      ['sl-lb-2', marketId, auth2.address, now]
    ).catch(() => {});
  });

  afterAll(async () => {
    await cleanDatabase(pool);
  });

  it('GET /api/leaderboard returns leaderboard array', async () => {
    const pub = createPublicClient();
    const res = await pub.get('/api/leaderboard');
    expect(res.status).toBe(200);
    const body = await res.json();
    // Server returns { leaderboard: [...] }
    const leaderboard = Array.isArray(body) ? body : body.leaderboard;
    expect(Array.isArray(leaderboard)).toBe(true);
  });

  it('GET /api/leaderboard?period=week returns weekly leaderboard', async () => {
    const pub = createPublicClient();
    const res = await pub.get('/api/leaderboard?period=week');
    expect(res.status).toBe(200);
    const body = await res.json();
    const leaderboard = Array.isArray(body) ? body : body.leaderboard;
    expect(Array.isArray(leaderboard)).toBe(true);
  });

  it('GET /api/leaderboard?period=month returns monthly leaderboard', async () => {
    const pub = createPublicClient();
    const res = await pub.get('/api/leaderboard?period=month');
    expect(res.status).toBe(200);
    const body = await res.json();
    const leaderboard = Array.isArray(body) ? body : body.leaderboard;
    expect(Array.isArray(leaderboard)).toBe(true);
  });
});
