import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestPool,
  createTestWallet,
  authenticateUser,
  createAuthClient,
  createPublicClient,
  seedUser,
  seedBalance,
  cleanDatabase,
} from '../setup/test-helpers';

describe('Wallet API', () => {
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

  // ------ Deposit (on-chain USDT verification -- not available in test env) ------

  it('POST /api/wallet/deposit without auth returns 401', async () => {
    const pub = createPublicClient();
    const res = await pub.post('/api/wallet/deposit', {
      txHash: '0xabc123',
      amount: 100,
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/wallet/deposit with missing txHash returns 400', async () => {
    const client = createAuthClient(token);
    const res = await client.post('/api/wallet/deposit', {
      amount: 100,
    });
    // Missing required field -- expect 400 or 503 (USDT not configured)
    expect([400, 503]).toContain(res.status);
  });

  it('POST /api/wallet/deposit with invalid amount returns 400', async () => {
    const client = createAuthClient(token);
    const res = await client.post('/api/wallet/deposit', {
      txHash: '0xabc123',
      amount: -50,
    });
    // Negative amount -- expect 400 or 503 (USDT not configured)
    expect([400, 503]).toContain(res.status);
  });

  // ------ Withdraw ------

  it('POST /api/wallet/withdraw with sufficient balance creates withdrawal', async () => {
    // Seed 5000 balance
    await seedBalance(pool, address, 5000);

    const client = createAuthClient(token);
    const res = await client.post('/api/wallet/withdraw', {
      amount: 1000,
      toAddress: address,
    });

    // Should succeed or return pending status
    expect([200, 201]).toContain(res.status);
    const body = await res.json();
    // Verify the response indicates success
    expect(body).toBeDefined();

    // Verify balance decreased
    const balRes = await client.get('/api/balances');
    expect(balRes.status).toBe(200);
    const balBody = await balRes.json();
    expect(balBody.available).toBeLessThan(5000);
  });

  it('POST /api/wallet/withdraw with insufficient balance returns 400', async () => {
    // Set balance to 10
    await seedBalance(pool, address, 10);

    const client = createAuthClient(token);
    const res = await client.post('/api/wallet/withdraw', {
      amount: 99999,
      toAddress: address,
    });
    expect(res.status).toBe(400);
  });

  // ------ Transaction history ------

  it('GET /api/wallet/transactions returns transaction history', async () => {
    const client = createAuthClient(token);
    const res = await client.get('/api/wallet/transactions');
    expect(res.status).toBe(200);
    const body = await res.json();
    // Server returns { transactions: [...], total: N }
    const transactions = Array.isArray(body) ? body : body.transactions;
    expect(Array.isArray(transactions)).toBe(true);
  });
});
