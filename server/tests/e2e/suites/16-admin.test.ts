import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestPool,
  createTestWallet,
  getAdminWallet,
  authenticateUser,
  createAuthClient,
  createPublicClient,
  seedTestMarket,
  cleanDatabase,
} from '../setup/test-helpers';

describe('Admin API', () => {
  const pool = getTestPool();
  let adminToken: string;
  let adminAddress: string;

  const pendingMarketApprove = 'admin-approve-market';
  const pendingMarketReject = 'admin-reject-market';

  beforeAll(async () => {
    await cleanDatabase(pool);

    // Authenticate admin (wallet index 99)
    const adminWallet = getAdminWallet();
    const auth = await authenticateUser(adminWallet);
    adminToken = auth.token;
    adminAddress = auth.address;

    // Seed pending_approval markets for approve/reject tests
    await seedTestMarket(pool, {
      id: pendingMarketApprove,
      title: 'Market to Approve',
      status: 'pending_approval',
    });
    await seedTestMarket(pool, {
      id: pendingMarketReject,
      title: 'Market to Reject',
      status: 'pending_approval',
    });
  });

  afterAll(async () => {
    await cleanDatabase(pool);
  });

  // ------ Cleanup Seed ------

  it('POST /api/admin/cleanup-seed with correct secret succeeds', async () => {
    const pub = createPublicClient();
    const res = await pub.post('/api/admin/cleanup-seed', {
      secret: 'test-secret-for-e2e',
    });
    expect([200, 204]).toContain(res.status);
  });

  it('POST /api/admin/cleanup-seed with wrong secret returns 403', async () => {
    const pub = createPublicClient();
    const res = await pub.post('/api/admin/cleanup-seed', {
      secret: 'wrong-secret',
    });
    expect(res.status).toBe(403);
  });

  // ------ Approve / Reject Markets ------

  it('POST /api/markets/:id/approve by admin approves pending market', async () => {
    // Re-seed the market in case cleanup-seed wiped it
    await seedTestMarket(pool, {
      id: pendingMarketApprove,
      title: 'Market to Approve',
      status: 'pending_approval',
    });

    const client = createAuthClient(adminToken);
    const res = await client.post(`/api/markets/${pendingMarketApprove}/approve`);
    expect([200, 201]).toContain(res.status);

    // Verify market status changed to active
    const dbRes = await pool.query(
      'SELECT status FROM markets WHERE id = $1',
      [pendingMarketApprove]
    );
    expect(dbRes.rows.length).toBe(1);
    expect(dbRes.rows[0].status).toBe('active');
  });

  it('POST /api/markets/:id/reject by admin rejects pending market', async () => {
    // Re-seed the market in case cleanup-seed wiped it
    await seedTestMarket(pool, {
      id: pendingMarketReject,
      title: 'Market to Reject',
      status: 'pending_approval',
    });

    const client = createAuthClient(adminToken);
    const res = await client.post(`/api/markets/${pendingMarketReject}/reject`);
    expect([200, 201]).toContain(res.status);

    // Verify market status changed to rejected
    const dbRes = await pool.query(
      'SELECT status FROM markets WHERE id = $1',
      [pendingMarketReject]
    );
    expect(dbRes.rows.length).toBe(1);
    expect(dbRes.rows[0].status).toBe('rejected');
  });
});
