import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestPool,
  createTestWallet,
  authenticateUser,
  createAuthClient,
  createPublicClient,
  cleanDatabase,
  seedUser,
} from '../setup/test-helpers';

describe('Social API', () => {
  const pool = getTestPool();
  const pub = createPublicClient();

  let userAToken: string;
  let userAAddress: string;
  let clientA: ReturnType<typeof createAuthClient>;

  let userBToken: string;
  let userBAddress: string;
  let clientB: ReturnType<typeof createAuthClient>;

  beforeAll(async () => {
    await cleanDatabase(pool);

    // UserA (wallet index 60)
    const walletA = createTestWallet(60);
    const authA = await authenticateUser(walletA);
    userAToken = authA.token;
    userAAddress = authA.address;
    clientA = createAuthClient(userAToken);

    // UserB (wallet index 61)
    const walletB = createTestWallet(61);
    const authB = await authenticateUser(walletB);
    userBToken = authB.token;
    userBAddress = authB.address;
    clientB = createAuthClient(userBToken);

    // Ensure both users exist in DB (authenticateUser should handle this, but seed as backup)
    await seedUser(pool, userAAddress);
    await seedUser(pool, userBAddress);
  });

  afterAll(async () => {
    await cleanDatabase(pool);
  });

  // ---------- POST /api/social/follow ----------

  it('POST /api/social/follow follows a user (auth)', async () => {
    const res = await clientA.post('/api/social/follow', {
      followedAddress: userBAddress,
    });
    expect(res.status).toBe(200);
  });

  it('POST /api/social/follow same user again returns 409', async () => {
    const res = await clientA.post('/api/social/follow', {
      followedAddress: userBAddress,
    });
    expect(res.status).toBe(409);
  });

  it('POST /api/social/follow yourself returns 400', async () => {
    const res = await clientA.post('/api/social/follow', {
      followedAddress: userAAddress,
    });
    expect(res.status).toBe(400);
  });

  // ---------- GET /api/social/following/:addr ----------

  it('GET /api/social/following/:addr returns following list', async () => {
    const res = await pub.get(`/api/social/following/${userAAddress}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    const following = Array.isArray(data) ? data : data.following;
    expect(following.length).toBeGreaterThanOrEqual(1);
    const addresses = following.map((f: any) =>
      (f.address ?? f.followed_address ?? f.followedAddress ?? '').toLowerCase()
    );
    expect(addresses).toContain(userBAddress.toLowerCase());
  });

  // ---------- GET /api/social/followers/:addr ----------

  it('GET /api/social/followers/:addr returns followers list', async () => {
    const res = await pub.get(`/api/social/followers/${userBAddress}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    const followers = Array.isArray(data) ? data : data.followers;
    expect(followers.length).toBeGreaterThanOrEqual(1);
    const addresses = followers.map((f: any) =>
      (f.address ?? f.follower_address ?? f.followerAddress ?? '').toLowerCase()
    );
    expect(addresses).toContain(userAAddress.toLowerCase());
  });

  // ---------- DELETE /api/social/unfollow ----------

  it('DELETE /api/social/unfollow unfollows (auth)', async () => {
    const res = await clientA.del('/api/social/unfollow', {
      followedAddress: userBAddress,
    });
    expect(res.status).toBe(200);

    // Verify A no longer follows B
    const checkRes = await pub.get(`/api/social/following/${userAAddress}`);
    const checkData = await checkRes.json();
    const following = Array.isArray(checkData) ? checkData : checkData.following;
    expect(following.length).toBe(0);
  });

  it('DELETE /api/social/unfollow non-followed returns 404', async () => {
    const res = await clientA.del('/api/social/unfollow', {
      followedAddress: userBAddress,
    });
    expect(res.status).toBe(404);
  });

  // ---------- GET /api/social/feed ----------

  it('GET /api/social/feed returns empty feed initially (auth)', async () => {
    const res = await clientA.get('/api/social/feed');
    expect(res.status).toBe(200);
    const data = await res.json();
    const feed = Array.isArray(data) ? data : data.feed ?? data.activities;
    expect(Array.isArray(feed)).toBe(true);
    expect(feed.length).toBe(0);
  });

  // ---------- GET /api/social/feed/public ----------

  it('GET /api/social/feed/public returns public feed', async () => {
    const res = await pub.get('/api/social/feed/public');
    expect(res.status).toBe(200);
    const data = await res.json();
    const feed = Array.isArray(data) ? data : data.feed ?? data.activities;
    expect(Array.isArray(feed)).toBe(true);
  });
});
