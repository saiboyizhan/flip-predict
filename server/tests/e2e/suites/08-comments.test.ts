import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestPool,
  createTestWallet,
  authenticateUser,
  createAuthClient,
  createPublicClient,
  cleanDatabase,
  seedTestMarket,
} from '../setup/test-helpers';

describe('Comments API', () => {
  const pool = getTestPool();
  const pub = createPublicClient();

  let userToken: string;
  let userAddress: string;
  let marketId: string;
  let commentId: string;
  let replyId: string;

  beforeAll(async () => {
    await cleanDatabase(pool);

    const wallet = createTestWallet(40);
    const auth = await authenticateUser(wallet);
    userToken = auth.token;
    userAddress = auth.address;

    marketId = await seedTestMarket(pool);
  });

  afterAll(async () => {
    await cleanDatabase(pool);
  });

  // ---------- GET /api/comments/:marketId ----------

  it('GET /api/comments/:marketId returns empty comments', async () => {
    const res = await pub.get(`/api/comments/${marketId}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    const comments = Array.isArray(data) ? data : data.comments;
    expect(comments.length).toBe(0);
  });

  // ---------- POST /api/comments/:marketId ----------

  it('POST /api/comments/:marketId creates comment (auth)', async () => {
    const client = createAuthClient(userToken);
    const res = await client.post(`/api/comments/${marketId}`, {
      content: 'This is a test comment',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const comment = data.comment ?? data;
    expect(comment.content).toBe('This is a test comment');
    expect(comment.market_id ?? comment.marketId).toBe(marketId);
    commentId = comment.id;
  });

  it('POST /api/comments/:marketId with parentId creates reply', async () => {
    const client = createAuthClient(userToken);
    const res = await client.post(`/api/comments/${marketId}`, {
      content: 'This is a reply',
      parentId: commentId,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const reply = data.comment ?? data;
    expect(reply.content).toBe('This is a reply');
    expect(reply.parent_id ?? reply.parentId).toBe(commentId);
    replyId = reply.id;
  });

  it('Cannot reply to a reply (max 1 level nesting) - 400', async () => {
    const client = createAuthClient(userToken);
    const res = await client.post(`/api/comments/${marketId}`, {
      content: 'Nested reply attempt',
      parentId: replyId,
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/comments/:marketId without auth fails (401)', async () => {
    const res = await pub.post(`/api/comments/${marketId}`, {
      content: 'Unauthorized comment',
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/comments/:marketId with empty content fails (400)', async () => {
    const client = createAuthClient(userToken);
    const res = await client.post(`/api/comments/${marketId}`, {
      content: '',
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/comments/:marketId with content > 500 chars fails (400)', async () => {
    const client = createAuthClient(userToken);
    const longContent = 'x'.repeat(501);
    const res = await client.post(`/api/comments/${marketId}`, {
      content: longContent,
    });
    expect(res.status).toBe(400);
  });

  // ---------- POST /api/comments/:commentId/like ----------

  it('POST /api/comments/:commentId/like toggles like (auth)', async () => {
    const client = createAuthClient(userToken);
    const res = await client.post(`/api/comments/${commentId}/like`);
    expect(res.status).toBe(200);
    const data = await res.json();
    // Server returns { comment: updated } with likes count and liked_by array
    const comment = data.comment ?? data;
    expect(Number(comment.likes)).toBeGreaterThanOrEqual(1);
  });

  it('Like again toggles unlike', async () => {
    const client = createAuthClient(userToken);
    const res = await client.post(`/api/comments/${commentId}/like`);
    expect(res.status).toBe(200);
    const data = await res.json();
    // After unliking, likes should be 0
    const comment = data.comment ?? data;
    expect(Number(comment.likes)).toBe(0);
  });

  // ---------- Edge cases ----------

  it('Comments for nonexistent market returns empty list (no 404)', async () => {
    const res = await pub.get('/api/comments/nonexistent-market-id-99999');
    expect(res.status).toBe(200);
    const data = await res.json();
    const comments = Array.isArray(data) ? data : data.comments;
    expect(comments.length).toBe(0);
  });
});
