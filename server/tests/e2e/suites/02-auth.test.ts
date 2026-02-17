import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestWallet,
  getTestPool,
  cleanDatabase,
  authenticateUser,
  createPublicClient,
  createAuthClient,
  getBaseUrl,
} from '../setup/test-helpers';

describe('Auth Flow', () => {
  const pool = getTestPool();
  const publicClient = createPublicClient();

  // Use wallet index 10-19 range for auth tests
  const wallet = createTestWallet(10);
  const address = wallet.address.toLowerCase();

  beforeAll(async () => {
    await cleanDatabase(pool);
  });

  afterAll(async () => {
    await cleanDatabase(pool);
  });

  it('GET /api/auth/nonce/:address returns nonce for valid address', async () => {
    const res = await publicClient.get(`/api/auth/nonce/${address}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('nonce');
    expect(body).toHaveProperty('message');
    expect(typeof body.nonce).toBe('string');
    expect(typeof body.message).toBe('string');
  });

  it('GET /api/auth/nonce/:address returns 400 for invalid address', async () => {
    const res = await publicClient.get('/api/auth/nonce/not-a-valid-address');
    expect(res.status).toBe(400);
  });

  it('POST /api/auth/verify with valid signature returns JWT token', async () => {
    // Get nonce first
    const nonceRes = await publicClient.get(`/api/auth/nonce/${address}`);
    const { message } = await nonceRes.json();

    // Sign message
    const signature = await wallet.signMessage(message);

    // Verify
    const verifyRes = await publicClient.post('/api/auth/verify', {
      address,
      signature,
    });
    expect(verifyRes.status).toBe(200);
    const body = await verifyRes.json();
    expect(body).toHaveProperty('token');
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);
  });

  it('POST /api/auth/verify with wrong signature returns 401', async () => {
    // Get nonce for a fresh wallet
    const wrongWallet = createTestWallet(11);
    const wrongAddr = wrongWallet.address.toLowerCase();
    const nonceRes = await publicClient.get(`/api/auth/nonce/${wrongAddr}`);
    const { message } = await nonceRes.json();

    // Sign with the WRONG wallet (wallet index 12)
    const otherWallet = createTestWallet(12);
    const badSignature = await otherWallet.signMessage(message);

    const verifyRes = await publicClient.post('/api/auth/verify', {
      address: wrongAddr,
      signature: badSignature,
    });
    expect(verifyRes.status).toBe(401);
  });

  it('POST /api/auth/verify without prior nonce returns 400', async () => {
    // Use an address that has never requested a nonce
    const freshWallet = createTestWallet(13);
    const freshAddr = freshWallet.address.toLowerCase();
    const fakeSig = await freshWallet.signMessage('no nonce was issued');

    const verifyRes = await publicClient.post('/api/auth/verify', {
      address: freshAddr,
      signature: fakeSig,
    });
    // Should fail because no nonce was generated for this address
    expect([400, 401]).toContain(verifyRes.status);
  });

  it('JWT token contains correct address', async () => {
    const w = createTestWallet(14);
    const { token, address: authedAddr } = await authenticateUser(w);
    expect(authedAddr).toBe(w.address.toLowerCase());

    // Decode JWT payload (base64url)
    const payloadB64 = token.split('.')[1];
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf-8')
    );
    expect(payload.address || payload.sub).toBe(w.address.toLowerCase());
  });

  it('Auth middleware rejects missing token', async () => {
    const res = await publicClient.get('/api/positions');
    expect(res.status).toBe(401);
  });

  it('Auth middleware rejects invalid token', async () => {
    const badClient = createAuthClient('this.is.not.a.valid.jwt');
    const res = await badClient.get('/api/positions');
    expect(res.status).toBe(401);
  });

  it('Nonce is rotated after successful verify (replay same signature fails)', async () => {
    const replayWallet = createTestWallet(15);
    const replayAddr = replayWallet.address.toLowerCase();

    // First: get nonce and sign
    const nonceRes = await publicClient.get(`/api/auth/nonce/${replayAddr}`);
    const { message } = await nonceRes.json();
    const signature = await replayWallet.signMessage(message);

    // First verify should succeed
    const firstVerify = await publicClient.post('/api/auth/verify', {
      address: replayAddr,
      signature,
    });
    expect(firstVerify.status).toBe(200);

    // Replay the same signature should fail (nonce has been rotated)
    const replayVerify = await publicClient.post('/api/auth/verify', {
      address: replayAddr,
      signature,
    });
    expect(replayVerify.status).not.toBe(200);
    expect([400, 401]).toContain(replayVerify.status);
  });
});
