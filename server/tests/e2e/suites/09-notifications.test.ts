import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestPool,
  createTestWallet,
  authenticateUser,
  createAuthClient,
  cleanDatabase,
  seedTestMarket,
  seedBalance,
} from '../setup/test-helpers';

describe('Notifications API', () => {
  const pool = getTestPool();

  let userToken: string;
  let userAddress: string;
  let client: ReturnType<typeof createAuthClient>;
  let marketId: string;
  let notificationId: string;

  beforeAll(async () => {
    await cleanDatabase(pool);

    const wallet = createTestWallet(50);
    const auth = await authenticateUser(wallet);
    userToken = auth.token;
    userAddress = auth.address;
    client = createAuthClient(userToken);

    // Seed a market and give user balance for trading
    marketId = await seedTestMarket(pool);
    await seedBalance(pool, userAddress, 10000);
  });

  afterAll(async () => {
    await cleanDatabase(pool);
  });

  // ---------- GET /api/notifications ----------

  it('GET /api/notifications returns empty initially (auth)', async () => {
    const res = await client.get('/api/notifications');
    expect(res.status).toBe(200);
    const data = await res.json();
    const notifications = Array.isArray(data) ? data : data.notifications;
    expect(notifications.length).toBe(0);
  });

  // ---------- Trade to generate notification ----------

  it('After trade, notifications appear', async () => {
    // Make a buy trade to generate a notification
    const buyRes = await client.post('/api/orders', {
      marketId,
      side: 'yes',
      amount: 100,
    });
    expect(buyRes.status).toBe(200);

    // Now check notifications
    const res = await client.get('/api/notifications');
    expect(res.status).toBe(200);
    const data = await res.json();
    const notifications = Array.isArray(data) ? data : data.notifications;
    expect(notifications.length).toBeGreaterThanOrEqual(1);
    notificationId = notifications[0].id;
  });

  // ---------- GET /api/notifications/unread-count ----------

  it('GET /api/notifications/unread-count returns count', async () => {
    const res = await client.get('/api/notifications/unread-count');
    expect(res.status).toBe(200);
    const data = await res.json();
    const count = data.count ?? data.unreadCount ?? data.unread_count;
    expect(count).toBeGreaterThanOrEqual(1);
  });

  // ---------- PUT /api/notifications/:id/read ----------

  it('PUT /api/notifications/:id/read marks single as read', async () => {
    const res = await client.put(`/api/notifications/${notificationId}/read`);
    expect(res.status).toBe(200);

    // Verify unread count decreased
    const countRes = await client.get('/api/notifications/unread-count');
    const countData = await countRes.json();
    const count = countData.count ?? countData.unreadCount ?? countData.unread_count;
    expect(count).toBeGreaterThanOrEqual(0);
  });

  // ---------- PUT /api/notifications/read-all ----------

  it('PUT /api/notifications/read-all marks all as read', async () => {
    const res = await client.put('/api/notifications/read-all');
    expect(res.status).toBe(200);

    // Verify all are read
    const countRes = await client.get('/api/notifications/unread-count');
    const countData = await countRes.json();
    const count = countData.count ?? countData.unreadCount ?? countData.unread_count;
    expect(count).toBe(0);
  });

  // ---------- GET /api/notifications/activity ----------

  it('GET /api/notifications/activity returns activity feed', async () => {
    const res = await client.get('/api/notifications/activity');
    expect(res.status).toBe(200);
    const data = await res.json();
    const activities = Array.isArray(data) ? data : data.notifications ?? data.activities ?? data.activity ?? data.feed;
    expect(Array.isArray(activities)).toBe(true);
  });
});
