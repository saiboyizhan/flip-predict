import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestPool,
  createTestWallet,
  authenticateUser,
  createAuthClient,
  createPublicClient,
  cleanDatabase,
  seedTestAgent,
  seedUser,
} from '../setup/test-helpers';

describe('Agents API', () => {
  const pool = getTestPool();
  const pub = createPublicClient();

  let ownerToken: string;
  let ownerAddress: string;
  let nonOwnerToken: string;
  let nonOwnerAddress: string;

  let agentId1: string;
  let agentId2: string;
  let agentId3: string;

  beforeAll(async () => {
    await cleanDatabase(pool);

    // Create owner (wallet index 30) and non-owner (wallet index 31)
    const ownerWallet = createTestWallet(30);
    const nonOwnerWallet = createTestWallet(31);

    const ownerAuth = await authenticateUser(ownerWallet);
    ownerToken = ownerAuth.token;
    ownerAddress = ownerAuth.address;

    const nonOwnerAuth = await authenticateUser(nonOwnerWallet);
    nonOwnerToken = nonOwnerAuth.token;
    nonOwnerAddress = nonOwnerAuth.address;

    // Seed 3 agents owned by ownerAddress with different strategies and stats
    agentId1 = await seedTestAgent(pool, ownerAddress, {
      name: 'Alpha Agent',
      strategy: 'momentum',
    });
    agentId2 = await seedTestAgent(pool, ownerAddress, {
      name: 'Beta Agent',
      strategy: 'random',
    });
    agentId3 = await seedTestAgent(pool, ownerAddress, {
      name: 'Gamma Agent',
      strategy: 'contrarian',
    });

    // Give agents different win_rates for sorting tests
    await pool.query('UPDATE agents SET win_rate = 0.9 WHERE id = $1', [agentId1]);
    await pool.query('UPDATE agents SET win_rate = 0.5 WHERE id = $1', [agentId2]);
    await pool.query('UPDATE agents SET win_rate = 0.7 WHERE id = $1', [agentId3]);
  });

  afterAll(async () => {
    await cleanDatabase(pool);
  });

  // ---------- GET /api/agents ----------

  it('GET /api/agents returns agent list', async () => {
    const res = await pub.get('/api/agents');
    expect(res.status).toBe(200);
    const data = await res.json();
    // Could be an array directly or wrapped in { agents: [...] }
    const agents = Array.isArray(data) ? data : data.agents;
    expect(agents.length).toBeGreaterThanOrEqual(3);
  });

  it('GET /api/agents?sort=win_rate sorts by win_rate', async () => {
    const res = await pub.get('/api/agents?sort=win_rate');
    expect(res.status).toBe(200);
    const data = await res.json();
    const agents = Array.isArray(data) ? data : data.agents;
    expect(agents.length).toBeGreaterThanOrEqual(2);
    // First agent should have highest win_rate
    const rates = agents.map((a: any) => parseFloat(a.win_rate ?? a.winRate ?? '0'));
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i - 1]).toBeGreaterThanOrEqual(rates[i]);
    }
  });

  it('GET /api/agents?strategy=random filters by strategy', async () => {
    const res = await pub.get('/api/agents?strategy=random');
    expect(res.status).toBe(200);
    const data = await res.json();
    const agents = Array.isArray(data) ? data : data.agents;
    expect(agents.length).toBeGreaterThanOrEqual(1);
    for (const agent of agents) {
      expect(agent.strategy).toBe('random');
    }
  });

  // ---------- GET /api/agents/leaderboard ----------

  it('GET /api/agents/leaderboard returns top agents', async () => {
    const res = await pub.get('/api/agents/leaderboard');
    expect(res.status).toBe(200);
    const data = await res.json();
    const agents = Array.isArray(data) ? data : data.agents ?? data.leaderboard;
    expect(Array.isArray(agents)).toBe(true);
  });

  // ---------- GET /api/agents/marketplace ----------

  it('GET /api/agents/marketplace returns for-sale/rent agents', async () => {
    const res = await pub.get('/api/agents/marketplace');
    expect(res.status).toBe(200);
    const data = await res.json();
    // Marketplace may return empty until agents are listed
    const agents = Array.isArray(data) ? data : data.agents ?? [];
    expect(Array.isArray(agents)).toBe(true);
  });

  // ---------- GET /api/agents/:id ----------

  it('GET /api/agents/:id returns agent detail + trades', async () => {
    const res = await pub.get(`/api/agents/${agentId1}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    const agent = data.agent ?? data;
    expect(agent.id).toBe(agentId1);
    expect(agent.name).toBe('Alpha Agent');
  });

  it('GET /api/agents/:id returns 404 for nonexistent', async () => {
    const res = await pub.get('/api/agents/nonexistent-agent-id-12345');
    expect(res.status).toBe(404);
  });

  // ---------- GET /api/agents/check ----------

  it('GET /api/agents/check returns agent count for user', async () => {
    const client = createAuthClient(ownerToken);
    const res = await client.get('/api/agents/check');
    expect(res.status).toBe(200);
    const data = await res.json();
    // Should contain a count field
    const count = data.count ?? data.agentCount;
    expect(count).toBeGreaterThanOrEqual(3);
  });

  // ---------- GET /api/agents/my ----------

  it('GET /api/agents/my returns user\'s agents (auth)', async () => {
    const client = createAuthClient(ownerToken);
    const res = await client.get('/api/agents/my');
    expect(res.status).toBe(200);
    const data = await res.json();
    const agents = Array.isArray(data) ? data : data.agents;
    expect(agents.length).toBeGreaterThanOrEqual(3);
    for (const agent of agents) {
      expect(agent.owner_address ?? agent.ownerAddress).toBe(ownerAddress);
    }
  });

  // ---------- PUT /api/agents/:id ----------

  it('PUT /api/agents/:id updates agent (owner only, auth)', async () => {
    const client = createAuthClient(ownerToken);
    const res = await client.put(`/api/agents/${agentId2}`, {
      name: 'Updated Beta Agent',
      description: 'Updated description',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const agent = data.agent ?? data;
    expect(agent.name).toBe('Updated Beta Agent');
  });

  it('PUT /api/agents/:id rejects non-owner (403)', async () => {
    const client = createAuthClient(nonOwnerToken);
    const res = await client.put(`/api/agents/${agentId1}`, {
      name: 'Hacked Name',
    });
    expect(res.status).toBe(403);
  });

  // ---------- POST /api/agents/:id/list-sale ----------

  it('POST /api/agents/:id/list-sale lists for sale (auth, owner)', async () => {
    const client = createAuthClient(ownerToken);
    const res = await client.post(`/api/agents/${agentId1}/list-sale`, {
      price: 500,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const agent = data.agent ?? data;
    expect(agent.is_for_sale ?? agent.for_sale ?? agent.forSale).toBeTruthy();
  });

  // ---------- POST /api/agents/:id/list-rent ----------

  it('POST /api/agents/:id/list-rent lists for rent (auth, owner)', async () => {
    const client = createAuthClient(ownerToken);
    const res = await client.post(`/api/agents/${agentId3}/list-rent`, {
      pricePerDay: 50,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const agent = data.agent ?? data;
    expect(agent.is_for_rent ?? agent.for_rent ?? agent.forRent).toBeTruthy();
  });

  // ---------- DELETE /api/agents/:id/delist ----------

  it('DELETE /api/agents/:id/delist removes listings (auth, owner)', async () => {
    const client = createAuthClient(ownerToken);
    const res = await client.del(`/api/agents/${agentId1}/delist`);
    expect(res.status).toBe(200);
    // Verify the agent is no longer listed
    const checkRes = await pub.get(`/api/agents/${agentId1}`);
    const checkData = await checkRes.json();
    const agent = checkData.agent ?? checkData;
    expect(agent.is_for_sale ?? agent.for_sale ?? agent.forSale).toBeFalsy();
  });

  // ---------- POST /api/agents/mint ----------

  it('POST /api/agents/mint returns 503 when NFA not configured', async () => {
    // Use nonOwner who has 0 agents (avoids 3-agent cap)
    const client = createAuthClient(nonOwnerToken);
    const res = await client.post('/api/agents/mint', {
      name: 'New Minted Agent',
      strategy: 'random',
      avatar: '/avatars/default.png',
      mintTxHash: '0x' + '0'.repeat(64),
    });
    // When NFA_CONTRACT_ADDRESS is empty, server returns 503 from verifyAgentMintTxOnChain
    expect(res.status).toBe(503);
  });
});
