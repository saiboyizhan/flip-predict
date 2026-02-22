import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestPool,
  createTestWallet,
  authenticateUser,
  createAuthClient,
  seedTestMarket,
  seedTestAgent,
  cleanDatabase,
} from '../setup/test-helpers';

describe('Full User Flows', () => {
  const pool = getTestPool();

  beforeAll(async () => {
    await cleanDatabase(pool);
  });

  afterAll(async () => {
    await cleanDatabase(pool);
  });

  // ======================== Flow A: Social ========================
  describe('Flow A: Social', () => {
    let tokenA: string;
    let addressA: string;
    let tokenB: string;

    beforeAll(async () => {
      const walletA = createTestWallet(31);
      const authA = await authenticateUser(walletA);
      tokenA = authA.token;
      addressA = authA.address;

      const walletB = createTestWallet(32);
      const authB = await authenticateUser(walletB);
      tokenB = authB.token;
    });

    it('UserB follows UserA', async () => {
      const clientB = createAuthClient(tokenB);
      const res = await clientB.post('/api/social/follow', {
        followedAddress: addressA,
      });
      expect([200, 201]).toContain(res.status);
    });
  });

  // ======================== Flow B: Comment Interaction ========================
  describe('Flow B: Comment interaction', () => {
    let token: string;
    const marketId = 'flow-b-market';
    let parentCommentId: string;

    beforeAll(async () => {
      const wallet = createTestWallet(33);
      const auth = await authenticateUser(wallet);
      token = auth.token;

      await seedTestMarket(pool, {
        id: marketId,
        title: 'Flow B Comment Market',
        status: 'active',
      });
    });

    it('posts a comment on the market', async () => {
      const client = createAuthClient(token);
      const res = await client.post(`/api/comments/${marketId}`, {
        content: 'This is a top-level test comment',
      });
      expect([200, 201]).toContain(res.status);
      const body = await res.json();
      parentCommentId = body.id || body.comment?.id;
      expect(parentCommentId).toBeDefined();
    });

    it('replies to the comment', async () => {
      const client = createAuthClient(token);
      const res = await client.post(`/api/comments/${marketId}`, {
        content: 'This is a reply to the first comment',
        parentId: parentCommentId,
      });
      expect([200, 201]).toContain(res.status);
      const body = await res.json();
      expect(body.id || body.comment?.id).toBeDefined();
    });

    it('likes the parent comment', async () => {
      const client = createAuthClient(token);
      const res = await client.post(`/api/comments/${parentCommentId}/like`);
      expect([200, 201]).toContain(res.status);
    });

    it('GET /api/comments/:marketId returns 2 comments with nesting', async () => {
      const client = createAuthClient(token);
      const res = await client.get(`/api/comments/${marketId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      const comments = Array.isArray(body) ? body : body.comments;
      expect(comments).toBeDefined();
      expect(comments.length).toBeGreaterThanOrEqual(1);

      const parent = comments.find((c: any) => c.id === parentCommentId);
      expect(parent).toBeDefined();

      const totalComments = comments.length +
        comments.reduce((acc: number, c: any) => acc + (c.replies?.length || 0), 0);
      expect(totalComments).toBeGreaterThanOrEqual(2);
    });
  });
});
