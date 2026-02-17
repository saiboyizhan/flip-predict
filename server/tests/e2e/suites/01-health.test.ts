import { describe, it, expect } from 'vitest';
import { createPublicClient } from '../setup/test-helpers';

describe('Health Check', () => {
  const client = createPublicClient();

  it('GET /api/health returns 200 with status ok', async () => {
    const res = await client.get('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
