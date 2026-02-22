import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestPool,
  createTestWallet,
  authenticateUser,
  createAuthClient,
  createPublicClient,
  seedBalance,
  cleanDatabase,
} from '../setup/test-helpers';

/**
 * Wallet deposit/withdraw routes were removed in v2 (non-custodial model).
 * Users hold USDT in their own wallets and interact via on-chain transactions.
 * These tests verify that the old custodial endpoints no longer exist (404)
 * and that balance queries still work correctly.
 */
describe('Wallet API (v2 non-custodial)', () => {
  const pool = getTestPool();
  let token: string;
  let address: string;

  beforeAll(async () => {
    await cleanDatabase(pool);

    const wallet = createTestWallet(13);
    const auth = await authenticateUser(wallet);
    token = auth.token;
    address = auth.address;
  });

  afterAll(async () => {
    await cleanDatabase(pool);
  });

  // ------ Removed endpoints return 404 ------

  it('POST /api/wallet/deposit returns 404 (removed in v2)', async () => {
    const client = createAuthClient(token);
    const res = await client.post('/api/wallet/deposit', {
      txHash: '0xabc123',
      amount: 100,
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/wallet/withdraw returns 404 (removed in v2)', async () => {
    const client = createAuthClient(token);
    const res = await client.post('/api/wallet/withdraw', {
      amount: 1000,
      toAddress: address,
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/wallet/transactions returns 404 (removed in v2)', async () => {
    const client = createAuthClient(token);
    const res = await client.get('/api/wallet/transactions');
    expect(res.status).toBe(404);
  });

  // ------ Balance API still works ------

  it('GET /api/balances returns balance after seeding', async () => {
    await seedBalance(pool, address, 5000);
    const client = createAuthClient(token);
    const res = await client.get('/api/balances');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Number(body.available)).toBe(5000);
  });

  it('GET /api/balances without auth returns 401', async () => {
    const pub = createPublicClient();
    const res = await pub.get('/api/balances');
    expect(res.status).toBe(401);
  });

  it('GET /api/balances shows 0 for fresh user', async () => {
    const freshWallet = createTestWallet(14);
    const { token: freshToken } = await authenticateUser(freshWallet);
    const client = createAuthClient(freshToken);
    const res = await client.get('/api/balances');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Number(body.available)).toBe(0);
  });
});
