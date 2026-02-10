import { Pool } from 'pg';
import { createHash } from 'crypto';

/**
 * Compute sha256 hash for off-chain learning tree commitments.
 */
function hashLeaf(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hashPair(left: string, right: string): string {
  const sorted = [left, right].sort();
  return createHash('sha256').update(sorted[0] + sorted[1]).digest('hex');
}

export interface LearningMetrics {
  totalInteractions: number;
  successfulOutcomes: number;
  learningRoot: string | null;
  lastUpdated: number | null;
}

/**
 * Build a Merkle tree from agent's prediction history
 */
export async function buildLearningTree(db: Pool, agentId: string): Promise<{ root: string; leaves: string[] }> {
  const predictions = (await db.query(
    'SELECT id, market_id, prediction, confidence, is_correct, category, created_at FROM agent_predictions WHERE agent_id = $1 AND actual_outcome IS NOT NULL ORDER BY created_at ASC',
    [agentId]
  )).rows as any[];

  if (predictions.length === 0) {
    return { root: '0'.repeat(64), leaves: [] };
  }

  // Create leaves from prediction data
  const leaves: string[] = predictions.map((p: any) => {
    const data = `${p.id}:${p.market_id}:${p.prediction}:${p.confidence}:${p.is_correct}:${p.category || 'none'}:${p.created_at}`;
    return hashLeaf(data);
  });

  // Build Merkle tree
  let currentLevel = [...leaves];
  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        nextLevel.push(hashPair(currentLevel[i], currentLevel[i + 1]));
      } else {
        nextLevel.push(currentLevel[i]); // Odd node, promote
      }
    }
    currentLevel = nextLevel;
  }

  return { root: currentLevel[0], leaves };
}

/**
 * Update the learning root for an agent in DB
 */
export async function updateLearningRoot(db: Pool, agentId: string): Promise<string> {
  const { root } = await buildLearningTree(db, agentId);
  const now = Date.now();

  await db.query(`
    INSERT INTO agent_style_profile (agent_id, learning_root, updated_at)
    VALUES ($1, $2, $3)
    ON CONFLICT(agent_id) DO UPDATE SET
      learning_root = EXCLUDED.learning_root,
      updated_at = EXCLUDED.updated_at
  `, [agentId, root, now]);

  return root;
}

/**
 * Verify a learning claim against the stored Merkle root
 */
export async function verifyLearningClaim(
  db: Pool,
  agentId: string,
  claimHash: string,
  proof: string[]
): Promise<boolean> {
  const profile = (await db.query('SELECT learning_root FROM agent_style_profile WHERE agent_id = $1', [agentId])).rows[0] as any;
  if (!profile || !profile.learning_root) return false;

  // Verify Merkle proof
  let currentHash = claimHash;
  for (const proofElement of proof) {
    currentHash = hashPair(currentHash, proofElement);
  }

  return currentHash === profile.learning_root;
}

/**
 * Get learning metrics for an agent (aligned with ILearningModule interface)
 */
export async function getLearningMetrics(db: Pool, agentId: string): Promise<LearningMetrics> {
  const predictions = (await db.query(
    'SELECT COUNT(*) as total, SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct FROM agent_predictions WHERE agent_id = $1 AND actual_outcome IS NOT NULL',
    [agentId]
  )).rows[0] as any;

  const profile = (await db.query('SELECT learning_root, updated_at FROM agent_style_profile WHERE agent_id = $1', [agentId])).rows[0] as any;

  return {
    totalInteractions: parseInt(predictions?.total) || 0,
    successfulOutcomes: parseInt(predictions?.correct) || 0,
    learningRoot: profile?.learning_root || null,
    lastUpdated: profile?.updated_at || null,
  };
}
