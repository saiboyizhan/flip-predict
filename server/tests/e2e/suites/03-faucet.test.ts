import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestWallet,
  getTestPool,
  cleanDatabase,
  authenticateUser,
  createAuthClient,
  createPublicClient,
} from '../setup/test-helpers';

describe('Faucet', () => {
  const pool = getTestPool();
  const publicClient = createPublicClient();

  // Wallets for faucet tests (index 20-29)
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

  it('POST /api/faucet with auth returns balance', async () => {
    const res = await mainClient.post('/api/faucet', { amount: 500 });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Server returns { success: true, balance: { available, locked } }
    expect(body).toBeDefined();
    const bal = Number(body.balance?.available ?? body.available ?? body.balance);
    expect(typeof bal).toBe('number');
    expect(bal).toBeGreaterThan(0);
  });

  it('Faucet credits the requested amount', async () => {
    // Use a fresh wallet to avoid faucet rate limit from prior test
    const freshWallet = createTestWallet(24);
    const { token: freshToken, address: freshAddress } = await authenticateUser(freshWallet);
    const freshClient = createAuthClient(freshToken);

    // Clean balance to start fresh
    await pool.query('DELETE FROM balances WHERE user_address = $1', [freshAddress]);

    const res = await freshClient.post('/api/faucet', { amount: 2000 });
    expect(res.status).toBe(200);
    const body = await res.json();
    const bal = Number(body.balance?.available ?? body.available ?? body.balance);
    expect(bal).toBe(2000);
  });

  it('Faucet defaults to 1000 if no amount specified', async () => {
    // Use a fresh wallet so there is no rate-limit or prior balance
    const freshWallet = createTestWallet(21);
    const { token } = await authenticateUser(freshWallet);
    const freshClient = createAuthClient(token);

    const res = await freshClient.post('/api/faucet', {});
    expect(res.status).toBe(200);
    const body = await res.json();
    const bal = Number(body.balance?.available ?? body.available ?? body.balance);
    expect(bal).toBe(1000);
  });

  it('Faucet caps at MAX_FAUCET (10000)', async () => {
    const freshWallet = createTestWallet(22);
    const { token } = await authenticateUser(freshWallet);
    const freshClient = createAuthClient(token);

    const res = await freshClient.post('/api/faucet', { amount: 99999 });
    expect(res.status).toBe(200);
    const body = await res.json();
    const bal = Number(body.balance?.available ?? body.available ?? body.balance);
    expect(bal).toBeLessThanOrEqual(10000);
  });

  it('Faucet rate limits (429 on second request within 60s)', async () => {
    // Use a dedicated wallet for rate-limit testing
    const rateLimitWallet = createTestWallet(23);
    const { token } = await authenticateUser(rateLimitWallet);
    const rlClient = createAuthClient(token);

    // First request should succeed
    const first = await rlClient.post('/api/faucet', { amount: 500 });
    expect(first.status).toBe(200);

    // Second request within rate window should be rejected
    const second = await rlClient.post('/api/faucet', { amount: 500 });
    expect(second.status).toBe(429);
  });

  it('Faucet without auth returns 401', async () => {
    const res = await publicClient.post('/api/faucet', { amount: 1000 });
    expect(res.status).toBe(401);
  });
});
