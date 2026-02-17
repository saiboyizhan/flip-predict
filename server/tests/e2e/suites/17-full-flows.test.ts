import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestPool,
  createTestWallet,
  authenticateUser,
  createAuthClient,
  seedUser,
  seedTestMarket,
  seedTestAgent,
  seedBalance,
  cleanDatabase,
} from '../setup/test-helpers';

describe('Full User Flows', () => {
  const pool = getTestPool();

  beforeAll(async () => {
    await cleanDatabase(pool);
  });

  afterAll(async () => {
    await cleanDatabase(pool);
  });

  // ======================== Flow A: Trading Lifecycle ========================
  describe('Flow A: Trading lifecycle', () => {
    let token: string;
    let address: string;
    const marketId = 'flow-a-market';

    beforeAll(async () => {
      // Authenticate user
      const wallet = createTestWallet(30);
      const auth = await authenticateUser(wallet);
      token = auth.token;
      address = auth.address;

      // Seed market for trading
      await seedTestMarket(pool, {
        id: marketId,
        title: 'Flow A Test Market',
        status: 'active',
        yesPrice: 0.5,
        noPrice: 0.5,
      });
    });

    it('completes full trading lifecycle', async () => {
      const client = createAuthClient(token);

      // Step 1: Faucet 5000 balance
      const faucetRes = await client.post('/api/faucet', { amount: 5000 });
      expect(faucetRes.status).toBe(200);

      // Step 2: Verify markets are visible
      const marketsRes = await client.get('/api/markets');
      expect(marketsRes.status).toBe(200);
      const marketsBody = await marketsRes.json();
      const markets = Array.isArray(marketsBody) ? marketsBody : marketsBody.markets;
      expect(Array.isArray(markets)).toBe(true);
      const found = markets.find((m: any) => m.id === marketId);
      expect(found).toBeDefined();

      // Step 3: Buy 100 YES shares
      const buyRes = await client.post('/api/orders', {
        marketId,
        side: 'yes',
        amount: 100,
      });
      expect(buyRes.status).toBe(200);
      const buyBody = await buyRes.json();
      expect(buyBody.shares || buyBody.order).toBeDefined();

      // Step 4: Verify position exists
      const posRes = await client.get('/api/positions');
      expect(posRes.status).toBe(200);
      const posBody = await posRes.json();
      const positionsArr = Array.isArray(posBody) ? posBody : posBody.positions;
      const pos = positionsArr.find((p: any) => (p.market_id === marketId || p.marketId === marketId) && p.side === 'yes');
      expect(pos).toBeDefined();
      expect(Number(pos.shares)).toBeGreaterThan(0);

      // Step 5: Check balance decreased
      const balRes1 = await client.get('/api/balances');
      expect(balRes1.status).toBe(200);
      const bal1 = await balRes1.json();
      const balanceAfterBuy = Number(bal1.available);
      expect(balanceAfterBuy).toBeLessThan(5000);

      // Step 6: Sell all YES shares
      const sellRes = await client.post('/api/orders/sell', {
        marketId,
        side: 'yes',
        shares: Number(pos.shares),
      });
      expect(sellRes.status).toBe(200);

      // Step 7: Verify balance recovered (close to original minus spread)
      const balRes2 = await client.get('/api/balances');
      expect(balRes2.status).toBe(200);
      const bal2 = await balRes2.json();
      const balanceAfterSell = Number(bal2.available);
      // Balance should have recovered most of the spent amount (within AMM spread)
      expect(balanceAfterSell).toBeGreaterThan(balanceAfterBuy);
      // Should be reasonably close to original (within 10% loss from spread)
      expect(balanceAfterSell).toBeGreaterThan(4500);
    });
  });

  // ======================== Flow B: Social + Copy Trading ========================
  describe('Flow B: Social + Copy Trading', () => {
    let tokenA: string;
    let addressA: string;
    let tokenB: string;
    let addressB: string;
    let agentId: string;

    beforeAll(async () => {
      // Auth UserA
      const walletA = createTestWallet(31);
      const authA = await authenticateUser(walletA);
      tokenA = authA.token;
      addressA = authA.address;

      // Auth UserB
      const walletB = createTestWallet(32);
      const authB = await authenticateUser(walletB);
      tokenB = authB.token;
      addressB = authB.address;

      // Seed balance for UserB (needed for copy trading)
      await seedBalance(pool, addressB, 5000);

      // Seed an agent owned by UserA
      agentId = await seedTestAgent(pool, addressA, {
        id: 'flow-b-agent',
        name: 'Flow B Test Agent',
        strategy: 'momentum',
      });
    });

    it('UserB follows UserA', async () => {
      const clientB = createAuthClient(tokenB);
      const res = await clientB.post('/api/social/follow', {
        followedAddress: addressA,
      });
      expect([200, 201]).toContain(res.status);
    });

    it('UserB starts copy trading UserA agent', async () => {
      const clientB = createAuthClient(tokenB);
      const res = await clientB.post('/api/copy-trading/start', {
        agentId,
        copyPercentage: 50,
        maxPerTrade: 1000,
        dailyLimit: 5000,
      });
      expect([200, 201]).toContain(res.status);
    });

    it('GET /api/copy-trading/status/:agentId shows active', async () => {
      const clientB = createAuthClient(tokenB);
      const res = await clientB.get(`/api/copy-trading/status/${agentId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      const follower = body.follower ?? body;
      expect(follower.status === 'active' || follower.active).toBeTruthy();
    });

    it('UserB stops copy trading', async () => {
      const clientB = createAuthClient(tokenB);
      const res = await clientB.post('/api/copy-trading/stop', {
        agentId,
      });
      expect([200, 201]).toContain(res.status);
    });

    it('GET /api/copy-trading/status/:agentId shows stopped', async () => {
      const clientB = createAuthClient(tokenB);
      const res = await clientB.get(`/api/copy-trading/status/${agentId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      const follower = body.follower ?? body;
      // After stopping, should not be active
      expect(follower === null || follower.status === 'stopped' || follower.status === 'inactive' || follower.active === false).toBeTruthy();
    });
  });

  // ======================== Flow C: Comment Interaction ========================
  describe('Flow C: Comment interaction', () => {
    let token: string;
    let address: string;
    const marketId = 'flow-c-market';
    let parentCommentId: string;

    beforeAll(async () => {
      const wallet = createTestWallet(33);
      const auth = await authenticateUser(wallet);
      token = auth.token;
      address = auth.address;

      // Seed a market for commenting
      await seedTestMarket(pool, {
        id: marketId,
        title: 'Flow C Comment Market',
        status: 'active',
      });
    });

    it('posts a comment on the market', async () => {
      const client = createAuthClient(token);
      const res = await client.post(`/api/comments/${marketId}`, {
        content: 'This is a top-level test comment',
      });
      expect([200, 201]).toContain(res.status);
      const body = await res.json();
      parentCommentId = body.id || body.comment?.id;
      expect(parentCommentId).toBeDefined();
    });

    it('replies to the comment', async () => {
      const client = createAuthClient(token);
      const res = await client.post(`/api/comments/${marketId}`, {
        content: 'This is a reply to the first comment',
        parentId: parentCommentId,
      });
      expect([200, 201]).toContain(res.status);
      const body = await res.json();
      expect(body.id || body.comment?.id).toBeDefined();
    });

    it('likes the parent comment', async () => {
      const client = createAuthClient(token);
      const res = await client.post(`/api/comments/${parentCommentId}/like`);
      expect([200, 201]).toContain(res.status);
    });

    it('GET /api/comments/:marketId returns 2 comments with nesting', async () => {
      const client = createAuthClient(token);
      const res = await client.get(`/api/comments/${marketId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      const comments = Array.isArray(body) ? body : body.comments;
      expect(comments).toBeDefined();
      // Should have at least the parent comment
      expect(comments.length).toBeGreaterThanOrEqual(1);

      // Find the parent comment
      const parent = comments.find((c: any) => c.id === parentCommentId);
      expect(parent).toBeDefined();

      // If nesting is flat, both comments should be in the array
      // If nesting is hierarchical, parent should have replies
      const totalComments = comments.length +
        comments.reduce((acc: number, c: any) => acc + (c.replies?.length || 0), 0);
      expect(totalComments).toBeGreaterThanOrEqual(2);
    });
  });
});
