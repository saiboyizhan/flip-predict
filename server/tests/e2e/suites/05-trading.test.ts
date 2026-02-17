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

describe('Trading / AMM', () => {
  const pool = getTestPool();
  const publicClient = createPublicClient();

  // Wallets for trading tests (index 30-39)
  const traderWallet = createTestWallet(30);
  let traderToken: string;
  let traderAddress: string;
  let traderClient: ReturnType<typeof createAuthClient>;

  let activeMarketId: string;
  let resolvedMarketId: string;

  beforeAll(async () => {
    await cleanDatabase(pool);

    // Authenticate trader
    const auth = await authenticateUser(traderWallet);
    traderToken = auth.token;
    traderAddress = auth.address;
    traderClient = createAuthClient(traderToken);

    // Seed an active market for trading
    activeMarketId = await seedTestMarket(pool, {
      id: 'e2e-trade-active',
      title: 'Trading Test Market',
      category: 'meme',
      status: 'active',
    });

    // Seed a resolved market (should reject trades)
    resolvedMarketId = await seedTestMarket(pool, {
      id: 'e2e-trade-resolved',
      title: 'Resolved Market',
      category: 'meme',
      status: 'resolved',
    });

    // Give the trader a generous balance
    await seedBalance(pool, traderAddress, 50000);
  });

  afterAll(async () => {
    await cleanDatabase(pool);
  });

  // ---- Buy Tests ----

  it('Buy YES shares succeeds with sufficient balance', async () => {
    const res = await traderClient.post('/api/orders', {
      marketId: activeMarketId,
      side: 'yes',
      amount: 100,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  it('Buy NO shares succeeds', async () => {
    const res = await traderClient.post('/api/orders', {
      marketId: activeMarketId,
      side: 'no',
      amount: 100,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  it('Buy returns order with shares, price, orderId', async () => {
    const res = await traderClient.post('/api/orders', {
      marketId: activeMarketId,
      side: 'yes',
      amount: 50,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const order = body.order ?? body;
    expect(order).toHaveProperty('shares');
    expect(order).toHaveProperty('price');
    expect(order.orderId ?? order.id ?? order.order_id).toBeDefined();
    expect(Number(order.shares)).toBeGreaterThan(0);
  });

  it('Price moves after buy (yes_price increases after YES buy)', async () => {
    // Get price before
    const beforeRes = await publicClient.get(`/api/markets/${activeMarketId}`);
    const beforeBody = await beforeRes.json();
    const beforeMarket = beforeBody.market ?? beforeBody;
    const priceBefore = Number(beforeMarket.yes_price ?? beforeMarket.yesPrice);

    // Make a sizable YES buy
    await traderClient.post('/api/orders', {
      marketId: activeMarketId,
      side: 'yes',
      amount: 500,
    });

    // Get price after
    const afterRes = await publicClient.get(`/api/markets/${activeMarketId}`);
    const afterBody = await afterRes.json();
    const afterMarket = afterBody.market ?? afterBody;
    const priceAfter = Number(afterMarket.yes_price ?? afterMarket.yesPrice);

    expect(priceAfter).toBeGreaterThan(priceBefore);
  });

  // ---- Sell Tests ----

  it('Sell YES shares succeeds after buying', async () => {
    // Ensure we have a position from prior buys
    const res = await traderClient.post('/api/orders/sell', {
      marketId: activeMarketId,
      side: 'yes',
      shares: 10,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  it('Sell returns amountOut', async () => {
    const res = await traderClient.post('/api/orders/sell', {
      marketId: activeMarketId,
      side: 'yes',
      shares: 5,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const result = body.order ?? body;
    const amountOut = result.amountOut ?? result.amount_out ?? result.amount ?? result.payout;
    expect(amountOut).toBeDefined();
    expect(Number(amountOut)).toBeGreaterThan(0);
  });

  // ---- Error Cases ----

  it('Buy with insufficient balance fails (400)', async () => {
    // Create a broke user
    const brokeWallet = createTestWallet(31);
    const { token } = await authenticateUser(brokeWallet);
    const brokeClient = createAuthClient(token);
    // No balance seeded -- should fail
    const res = await brokeClient.post('/api/orders', {
      marketId: activeMarketId,
      side: 'yes',
      amount: 100,
    });
    expect(res.status).toBe(400);
  });

  it('Buy with invalid marketId fails (400)', async () => {
    const res = await traderClient.post('/api/orders', {
      marketId: 'nonexistent-market-xyz',
      side: 'yes',
      amount: 100,
    });
    expect([400, 404]).toContain(res.status);
  });

  it('Buy with amount=0 fails (400)', async () => {
    const res = await traderClient.post('/api/orders', {
      marketId: activeMarketId,
      side: 'yes',
      amount: 0,
    });
    expect(res.status).toBe(400);
  });

  it('Buy with negative amount fails (400)', async () => {
    const res = await traderClient.post('/api/orders', {
      marketId: activeMarketId,
      side: 'yes',
      amount: -100,
    });
    expect(res.status).toBe(400);
  });

  it('Buy with amount > 1,000,000 fails (400)', async () => {
    const res = await traderClient.post('/api/orders', {
      marketId: activeMarketId,
      side: 'yes',
      amount: 1_000_001,
    });
    expect(res.status).toBe(400);
  });

  it('Sell with no position fails (400)', async () => {
    // Use a wallet with no trades
    const noPositionWallet = createTestWallet(32);
    const { token } = await authenticateUser(noPositionWallet);
    await seedBalance(pool, noPositionWallet.address.toLowerCase(), 5000);
    const noPositionClient = createAuthClient(token);

    const res = await noPositionClient.post('/api/orders/sell', {
      marketId: activeMarketId,
      side: 'yes',
      shares: 10,
    });
    expect(res.status).toBe(400);
  });

  it('Sell more shares than owned fails (400)', async () => {
    const res = await traderClient.post('/api/orders/sell', {
      marketId: activeMarketId,
      side: 'yes',
      shares: 999999,
    });
    expect(res.status).toBe(400);
  });

  it('Buy on non-active market fails (400)', async () => {
    const res = await traderClient.post('/api/orders', {
      marketId: resolvedMarketId,
      side: 'yes',
      amount: 100,
    });
    expect(res.status).toBe(400);
  });

  it('Buy without auth fails (401)', async () => {
    const res = await publicClient.post('/api/orders', {
      marketId: activeMarketId,
      side: 'yes',
      amount: 100,
    });
    expect(res.status).toBe(401);
  });

  it('Sell without auth fails (401)', async () => {
    const res = await publicClient.post('/api/orders/sell', {
      marketId: activeMarketId,
      side: 'yes',
      shares: 10,
    });
    expect(res.status).toBe(401);
  });

  it('Side must be yes or no (400)', async () => {
    const res = await traderClient.post('/api/orders', {
      marketId: activeMarketId,
      side: 'maybe',
      amount: 100,
    });
    expect(res.status).toBe(400);
  });
});
