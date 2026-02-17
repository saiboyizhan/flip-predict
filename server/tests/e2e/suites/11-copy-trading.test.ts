import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestPool,
  createTestWallet,
  authenticateUser,
  createAuthClient,
  cleanDatabase,
  seedTestAgent,
  seedBalance,
} from '../setup/test-helpers';

describe('Copy Trading API', () => {
  const pool = getTestPool();

  let userAToken: string;
  let userAAddress: string;
  let clientA: ReturnType<typeof createAuthClient>;

  let userBToken: string;
  let userBAddress: string;
  let clientB: ReturnType<typeof createAuthClient>;

  let agentId: string;

  beforeAll(async () => {
    await cleanDatabase(pool);

    // UserA = agent owner (wallet index 70)
    const walletA = createTestWallet(70);
    const authA = await authenticateUser(walletA);
    userAToken = authA.token;
    userAAddress = authA.address;
    clientA = createAuthClient(userAToken);

    // UserB = follower (wallet index 71)
    const walletB = createTestWallet(71);
    const authB = await authenticateUser(walletB);
    userBToken = authB.token;
    userBAddress = authB.address;
    clientB = createAuthClient(userBToken);

    // Seed an agent owned by UserA
    agentId = await seedTestAgent(pool, userAAddress, {
      name: 'Copy Target Agent',
      strategy: 'momentum',
    });

    // Give UserB balance for copy trading
    await seedBalance(pool, userBAddress, 5000);
  });

  afterAll(async () => {
    await cleanDatabase(pool);
  });

  // ---------- POST /api/copy-trading/start ----------

  it('POST /api/copy-trading/start starts following agent (auth)', async () => {
    const res = await clientB.post('/api/copy-trading/start', {
      agentId,
      copyPercentage: 50,
      maxPerTrade: 1000,
      dailyLimit: 5000,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const follower = data.follower ?? data;
    expect(follower.agent_id ?? follower.agentId).toBe(agentId);
  });

  it('POST /api/copy-trading/start with invalid copyPercentage fails (400)', async () => {
    // Create a second agent to avoid "already following" conflict
    const agentId2 = await seedTestAgent(pool, userAAddress, {
      name: 'Agent For Invalid Test',
      strategy: 'random',
    });
    const res = await clientB.post('/api/copy-trading/start', {
      agentId: agentId2,
      copyPercentage: 150, // invalid: > 100
      maxPerTrade: 1000,
      dailyLimit: 5000,
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/copy-trading/start own agent fails (400)', async () => {
    const res = await clientA.post('/api/copy-trading/start', {
      agentId,
      copyPercentage: 50,
      maxPerTrade: 1000,
      dailyLimit: 5000,
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/copy-trading/start same agent again fails (400)', async () => {
    const res = await clientB.post('/api/copy-trading/start', {
      agentId,
      copyPercentage: 30,
      maxPerTrade: 500,
      dailyLimit: 2500,
    });
    // Already following this agent
    expect(res.status).toBe(400);
  });

  // ---------- GET /api/copy-trading/status/:agentId ----------

  it('GET /api/copy-trading/status/:agentId returns follow status', async () => {
    const res = await clientB.get(`/api/copy-trading/status/${agentId}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    const follower = data.follower ?? data;
    expect(follower).toBeDefined();
    expect(follower.status === 'active' || follower.following || follower.isFollowing || follower.is_following).toBeTruthy();
  });

  // ---------- PUT /api/copy-trading/settings ----------

  it('PUT /api/copy-trading/settings updates settings', async () => {
    const res = await clientB.put('/api/copy-trading/settings', {
      agentId,
      copyPercentage: 75,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const follower = data.follower ?? data;
    const pct = Number(follower.copyPercentage ?? follower.copy_percentage);
    expect(pct).toBe(75);
  });

  // ---------- POST /api/copy-trading/stop ----------

  it('POST /api/copy-trading/stop stops following', async () => {
    const res = await clientB.post('/api/copy-trading/stop', {
      agentId,
    });
    expect(res.status).toBe(200);

    // Verify no longer active
    const statusRes = await clientB.get(`/api/copy-trading/status/${agentId}`);
    const statusData = await statusRes.json();
    const follower = statusData.follower ?? statusData;
    // After stopping, status should be 'stopped' (not 'active')
    expect(follower === null || follower.status === 'stopped' || follower.status === 'inactive' || !follower.following).toBeTruthy();
  });

  // ---------- GET /api/copy-trading/trades ----------

  it('GET /api/copy-trading/trades returns empty initially', async () => {
    const res = await clientB.get('/api/copy-trading/trades');
    expect(res.status).toBe(200);
    const data = await res.json();
    const trades = Array.isArray(data) ? data : data.trades;
    expect(Array.isArray(trades)).toBe(true);
    expect(trades.length).toBe(0);
  });
});
