import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestWallet,
  getTestPool,
  cleanDatabase,
  authenticateUser,
  createAuthClient,
  seedBalance,
} from '../setup/test-helpers';

/**
 * Faucet was removed in v2 (non-custodial model).
 * These tests verify that seedBalance (direct DB write) works correctly
 * and that /api/balances reflects the seeded amount.
 */
describe('Balance Seeding (v2 — faucet removed)', () => {
  const pool = getTestPool();

  const mainWallet = createTestWallet(20);
  let mainToken: string;
  let mainAddress: string;
  let mainClient: ReturnType<typeof createAuthClient>;

  beforeAll(async () => {
    await cleanDatabase(pool);
    const auth = await authenticateUser(mainWallet);
    mainToken = auth.token;
    mainAddress = auth.address;
    mainClient = createAuthClient(mainToken);
  });

  afterAll(async () => {
    await cleanDatabase(pool);
  });

  it('seedBalance credits the requested amount', async () => {
    await seedBalance(pool, mainAddress, 500);
    const res = await mainClient.get('/api/balances');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Number(body.available)).toBe(500);
  });

  it('seedBalance overwrites previous balance', async () => {
    await seedBalance(pool, mainAddress, 2000);
    const res = await mainClient.get('/api/balances');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Number(body.available)).toBe(2000);
  });

  it('seedBalance works for fresh wallets', async () => {
    const freshWallet = createTestWallet(21);
    const { token: freshToken, address: freshAddress } = await authenticateUser(freshWallet);
    const freshClient = createAuthClient(freshToken);

    await seedBalance(pool, freshAddress, 1000);
    const res = await freshClient.get('/api/balances');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Number(body.available)).toBe(1000);
  });

  it('seedBalance supports large amounts', async () => {
    const freshWallet = createTestWallet(22);
    const { token, address } = await authenticateUser(freshWallet);
    const client = createAuthClient(token);

    await seedBalance(pool, address, 10000);
    const res = await client.get('/api/balances');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Number(body.available)).toBe(10000);
  });

  it('balance starts at 0 without seeding', async () => {
    const freshWallet = createTestWallet(23);
    const { token } = await authenticateUser(freshWallet);
    const client = createAuthClient(token);

    const res = await client.get('/api/balances');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Number(body.available)).toBe(0);
  });
});
