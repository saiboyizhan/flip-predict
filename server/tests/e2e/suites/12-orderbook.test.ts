import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestPool,
  createTestWallet,
  authenticateUser,
  createAuthClient,
  createPublicClient,
  cleanDatabase,
  seedTestMarket,
  seedBalance,
} from '../setup/test-helpers';

describe('Orderbook / Limit Orders API', () => {
  const pool = getTestPool();
  const pub = createPublicClient();

  let userToken: string;
  let userAddress: string;
  let client: ReturnType<typeof createAuthClient>;
  let marketId: string;
  let orderId: string;

  beforeAll(async () => {
    await cleanDatabase(pool);

    const wallet = createTestWallet(80);
    const auth = await authenticateUser(wallet);
    userToken = auth.token;
    userAddress = auth.address;
    client = createAuthClient(userToken);

    // Seed a market and give user balance
    marketId = await seedTestMarket(pool);
    await seedBalance(pool, userAddress, 10000);
  });

  afterAll(async () => {
    await cleanDatabase(pool);
  });

  // ---------- GET /api/orderbook/:marketId/:side ----------

  it('GET /api/orderbook/:marketId/:side returns order book', async () => {
    const res = await pub.get(`/api/orderbook/${marketId}/yes`);
    expect(res.status).toBe(200);
    const data = await res.json();
    // Orderbook may be empty initially but should return valid structure
    const orders = Array.isArray(data) ? data : data.orders ?? data.bids ?? data.asks ?? [];
    expect(Array.isArray(orders)).toBe(true);
  });

  // ---------- POST /api/orderbook/limit ----------

  it('POST /api/orderbook/limit places limit order (auth)', async () => {
    const res = await client.post('/api/orderbook/limit', {
      marketId,
      side: 'yes',
      orderSide: 'buy',
      price: 0.4,
      amount: 200,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const order = data.order ?? data;
    const oid = order.orderId ?? order.id ?? order.order_id;
    expect(oid).toBeDefined();
    orderId = oid;
  });

  // ---------- GET /api/orderbook/open ----------

  it('GET /api/orderbook/open returns user\'s open orders (auth)', async () => {
    const res = await client.get('/api/orderbook/open');
    expect(res.status).toBe(200);
    const data = await res.json();
    const orders = Array.isArray(data) ? data : data.orders;
    expect(orders.length).toBeGreaterThanOrEqual(1);
    const found = orders.find((o: any) => o.id === orderId);
    expect(found).toBeDefined();
  });

  // ---------- DELETE /api/orderbook/:orderId ----------

  it('DELETE /api/orderbook/:orderId cancels order (auth)', async () => {
    const res = await client.del(`/api/orderbook/${orderId}`);
    expect(res.status).toBe(200);

    // Verify order is no longer in open orders
    const openRes = await client.get('/api/orderbook/open');
    const openData = await openRes.json();
    const orders = Array.isArray(openData) ? openData : openData.orders;
    const found = orders.find((o: any) => o.id === orderId);
    expect(found).toBeUndefined();
  });

  // ---------- POST /api/orderbook/limit with invalid price ----------

  it('POST /api/orderbook/limit with invalid price range fails (400)', async () => {
    const res = await client.post('/api/orderbook/limit', {
      marketId,
      side: 'yes',
      orderSide: 'buy',
      price: 1.5, // invalid: price must be between 0.01 and 0.99
      amount: 100,
    });
    expect(res.status).toBe(400);
  });
});
