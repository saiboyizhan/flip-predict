import { Router, Request, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';
import { recordPrediction, analyzeStyle } from '../engine/agent-prediction';
import { generateSuggestion, calculateRisk } from '../engine/agent-advisor';
import { getLearningMetrics } from '../engine/agent-learning';
import { syncOwnerProfile, getOwnerInfluence } from '../engine/agent-owner-learning';
import { encrypt, decrypt, maskApiKey } from '../utils/crypto';
import { ethers } from 'ethers';
import { BSC_CHAIN_ID, getRpcUrl } from '../config/network';

const router = Router();

const VALID_STRATEGIES = ['conservative', 'aggressive', 'contrarian', 'momentum', 'random'];
const NFA_RPC_URL = getRpcUrl('NFA_RPC_URL');
const RAW_NFA_CONTRACT_ADDRESS =
  process.env.NFA_CONTRACT_ADDRESS ||
  process.env.VITE_NFA_CONTRACT_ADDRESS ||
  process.env.VITE_NFA_ADDRESS ||
  '';
const NFA_CONTRACT_ADDRESS = ethers.isAddress(RAW_NFA_CONTRACT_ADDRESS)
  ? RAW_NFA_CONTRACT_ADDRESS.toLowerCase()
  : null;

let nfaProvider: ethers.JsonRpcProvider | null = null;

function getNfaProvider(): ethers.JsonRpcProvider {
  if (!nfaProvider) {
    nfaProvider = new ethers.JsonRpcProvider(NFA_RPC_URL);
  }
  return nfaProvider;
}

function generateId(): string {
  return 'agent-' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseNonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function isTxHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

async function verifyAgentMintTxOnChain(params: {
  txHash: string;
  expectedMinter: string;
  expectedTokenId?: number | null;
}): Promise<{ ok: true; blockNumber: number; tokenId: number } | { ok: false; statusCode: number; error: string }> {
  if (!NFA_CONTRACT_ADDRESS) {
    return { ok: false, statusCode: 503, error: 'NFA mint verification is not configured' };
  }

  const expectedMinter = params.expectedMinter.toLowerCase();
  const expectedTokenId = params.expectedTokenId == null ? null : String(params.expectedTokenId);
  const mintSelector = ethers.id('mint((string,string,bytes32,string,string,bytes32,uint8))').slice(0, 10);
  const transferTopic = ethers.id('Transfer(address,address,uint256)');
  const iface = new ethers.Interface([
    'function mint((string name,string persona,bytes32 voiceHash,string animationURI,string vaultURI,bytes32 vaultHash,uint8 avatarId) metadata)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  ]);
  const provider = getNfaProvider();

  try {
    const network = await provider.getNetwork();
    const connectedChainId = Number(network.chainId);
    const receipt = await provider.getTransactionReceipt(params.txHash);
    if (!receipt) {
      return {
        ok: false,
        statusCode: 400,
        error: `mintTxHash not found on chain ${connectedChainId}. Check NFA_RPC_URL/BSC_RPC_URL and contract network alignment`,
      };
    }
    if (receipt.status !== 1) {
      return { ok: false, statusCode: 400, error: 'mintTxHash failed on-chain' };
    }

    const tx = await provider.getTransaction(params.txHash);
    if (!tx) {
      return { ok: false, statusCode: 400, error: 'mintTxHash transaction details unavailable' };
    }

    const txFrom = (tx.from || '').toLowerCase();
    if (txFrom !== expectedMinter) {
      return { ok: false, statusCode: 400, error: 'mintTxHash sender does not match current wallet' };
    }

    const txTo = (tx.to || receipt.to || null)?.toLowerCase() ?? null;
    if (!txTo || txTo !== NFA_CONTRACT_ADDRESS) {
      return { ok: false, statusCode: 400, error: 'mintTxHash target does not match NFA contract' };
    }

    const calldata = tx.data || '';
    if (calldata.length < 10 || calldata.slice(0, 10) !== mintSelector) {
      return { ok: false, statusCode: 400, error: 'mintTxHash must call NFA.mint' };
    }

    try {
      iface.decodeFunctionData('mint', calldata);
    } catch {
      return { ok: false, statusCode: 400, error: 'mintTxHash calldata decode failed' };
    }

    let resolvedTokenId: number | null = null;
    for (const log of receipt.logs) {
      if ((log.address || '').toLowerCase() !== NFA_CONTRACT_ADDRESS) continue;
      if (!log.topics?.length || log.topics[0] !== transferTopic) continue;
      try {
        const decoded = iface.decodeEventLog('Transfer', log.data, log.topics);
        const from = String(decoded[0] || '').toLowerCase();
        const to = String(decoded[1] || '').toLowerCase();
        const tokenIdRaw = (decoded[2] as bigint).toString();
        if (from === ethers.ZeroAddress && to === expectedMinter) {
          if (expectedTokenId !== null && tokenIdRaw !== expectedTokenId) {
            continue;
          }
          const parsedTokenId = Number(tokenIdRaw);
          if (!Number.isSafeInteger(parsedTokenId) || parsedTokenId < 0) {
            return { ok: false, statusCode: 400, error: 'mintTxHash tokenId is out of supported range' };
          }
          resolvedTokenId = parsedTokenId;
          break;
        }
      } catch {
        continue;
      }
    }

    if (resolvedTokenId == null) {
      if (expectedTokenId !== null) {
        return { ok: false, statusCode: 400, error: 'mintTxHash does not prove ownership of the provided tokenId' };
      }
      return { ok: false, statusCode: 400, error: 'mintTxHash does not contain a valid mint Transfer event for current wallet' };
    }

    return { ok: true, blockNumber: receipt.blockNumber, tokenId: resolvedTokenId };
  } catch (err) {
    console.error('Agent mint tx verification error:', err);
    return {
      ok: false,
      statusCode: 503,
      error: `NFA mint verification service unavailable (expected chain ${BSC_CHAIN_ID})`,
    };
  }
}

// ========== Public Routes ==========

// GET /api/agents — list agents
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { sort = 'roi', strategy, limit = '50' } = req.query;
    const rawLimit = Number.parseInt(String(limit), 10);
    const parsedLimit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 50, 100));

    let orderBy = 'roi DESC';
    switch (sort) {
      case 'win_rate': orderBy = 'win_rate DESC'; break;
      case 'profit': orderBy = 'total_profit DESC'; break;
      case 'newest': orderBy = 'created_at DESC'; break;
      case 'level': orderBy = 'level DESC, experience DESC'; break;
      default: orderBy = 'roi DESC';
    }

    let sql = `SELECT * FROM agents`;
    const params: any[] = [];
    let paramIndex = 1;

    if (strategy && VALID_STRATEGIES.includes(strategy as string)) {
      sql += ` WHERE strategy = $${paramIndex++}`;
      params.push(strategy);
    }

    sql += ` ORDER BY ${orderBy} LIMIT $${paramIndex}`;
    params.push(parsedLimit);

    const agents = (await db.query(sql, params)).rows;

    // Add copy follower counts
    if (agents.length > 0) {
      const agentIds = agents.map((a: any) => a.id);
      const followerCounts = (await db.query(
        "SELECT agent_id, COUNT(*) as count FROM agent_followers WHERE agent_id = ANY($1) AND status = 'active' GROUP BY agent_id",
        [agentIds]
      )).rows;
      const countMap: Record<string, number> = {};
      for (const fc of followerCounts) {
        countMap[fc.agent_id] = Number(fc.count);
      }
      for (const agent of agents) {
        (agent as any).copyFollowerCount = countMap[(agent as any).id] || 0;
      }
    }

    res.json({ agents });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agents/leaderboard — top 20 by ROI
router.get('/leaderboard', async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const agents = (await db.query(
      'SELECT * FROM agents ORDER BY roi DESC LIMIT 20'
    )).rows;
    res.json({ agents });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agents/marketplace — for sale or rent
router.get('/marketplace', async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const agents = (await db.query(
      'SELECT * FROM agents WHERE is_for_sale = 1 OR is_for_rent = 1 ORDER BY created_at DESC'
    )).rows;
    res.json({ agents });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agents/check — quick check if user has agent (JWT required)
router.get('/check', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const result = await db.query(
      'SELECT COUNT(*) as count FROM agents WHERE owner_address = $1',
      [req.userAddress]
    );
    const count = Number(result.rows[0]?.count) || 0;
    res.json({ hasAgent: count > 0, agentCount: count });
  } catch (err: any) {
    console.error('Agent check error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agents/my — my agents (JWT required) — must be before /:id
router.get('/my', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agents = (await db.query(
      'SELECT * FROM agents WHERE owner_address = $1 ORDER BY created_at DESC',
      [req.userAddress]
    )).rows;
    res.json({ agents });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agents/:id — agent detail + recent trades
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const trades = (await db.query(
      'SELECT * FROM agent_trades WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.params.id]
    )).rows;

    // Add copy follower count
    const followerCount = (await db.query(
      "SELECT COUNT(*) as count FROM agent_followers WHERE agent_id = $1 AND status = 'active'",
      [req.params.id]
    )).rows[0];
    (agent as any).copyFollowerCount = Number(followerCount.count) || 0;

    res.json({ agent, trades });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== Authenticated Routes ==========

// POST /api/agents/mint — create agent (free, max 3 per address)
router.post('/mint', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { name, strategy, description, persona, avatar, tokenId, mintTxHash } = req.body;
    const parsedTokenId = tokenId == null ? null : parseNonNegativeInteger(tokenId);
    const normalizedMintTxHash = typeof mintTxHash === 'string' ? mintTxHash.trim().toLowerCase() : null;

    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    if (name.trim().length > 30) {
      res.status(400).json({ error: 'Name must be 30 characters or less' });
      return;
    }
    if (strategy && !VALID_STRATEGIES.includes(strategy)) {
      res.status(400).json({ error: 'Invalid strategy' });
      return;
    }

    // Check 3-agent limit per address
    const countRes = await db.query(
      'SELECT COUNT(*) as count FROM agents WHERE owner_address = $1',
      [req.userAddress]
    );
    const currentCount = Number(countRes.rows[0]?.count) || 0;
    if (currentCount >= 3) {
      res.status(400).json({ error: 'Max 3 agents per address' });
      return;
    }

    // Avatar is required (preset avatar path)
    if (!avatar || typeof avatar !== 'string') {
      res.status(400).json({ error: 'Avatar is required' });
      return;
    }
    if (tokenId != null && parsedTokenId === null) {
      res.status(400).json({ error: 'tokenId must be a non-negative integer' });
      return;
    }
    if (normalizedMintTxHash && !isTxHash(normalizedMintTxHash)) {
      res.status(400).json({ error: 'mintTxHash must be a valid transaction hash' });
      return;
    }
    if (normalizedMintTxHash == null) {
      res.status(400).json({ error: 'mintTxHash is required for on-chain mint sync' });
      return;
    }

    const mintTxVerification = await verifyAgentMintTxOnChain({
      txHash: normalizedMintTxHash,
      expectedMinter: req.userAddress!,
      expectedTokenId: parsedTokenId,
    });
    if (!mintTxVerification.ok) {
      res.status(mintTxVerification.statusCode).json({ error: mintTxVerification.error });
      return;
    }
    const resolvedTokenId = mintTxVerification.tokenId;

    const existingToken = await db.query('SELECT id FROM agents WHERE token_id = $1 LIMIT 1', [resolvedTokenId]);
    if (existingToken.rows.length > 0) {
      res.status(409).json({ error: 'tokenId already exists' });
      return;
    }
    const existingMintTx = await db.query('SELECT id FROM agents WHERE LOWER(mint_tx_hash) = LOWER($1) LIMIT 1', [normalizedMintTxHash]);
    if (existingMintTx.rows.length > 0) {
      res.status(409).json({ error: 'mintTxHash already exists' });
      return;
    }

    const id = generateId();
    const now = Date.now();

    await db.query(`
      INSERT INTO agents (id, name, owner_address, strategy, description, persona, avatar, token_id, mint_tx_hash, wallet_balance, level, experience, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1000, 1, 0, $10)
    `, [id, name.trim(), req.userAddress, strategy || 'random', description || '', persona || '', avatar, resolvedTokenId, normalizedMintTxHash, now]);

    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [id])).rows[0];
    res.json({ agent });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/agents/recover — recover on-chain minted agents that failed backend registration
router.post('/recover', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { name, strategy, description, persona, avatar, mintTxHash } = req.body;
    const normalizedMintTxHash = typeof mintTxHash === 'string' ? mintTxHash.trim().toLowerCase() : null;

    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    if (name.trim().length > 30) {
      res.status(400).json({ error: 'Name must be 30 characters or less' });
      return;
    }
    if (strategy && !VALID_STRATEGIES.includes(strategy)) {
      res.status(400).json({ error: 'Invalid strategy' });
      return;
    }
    if (!avatar || typeof avatar !== 'string') {
      res.status(400).json({ error: 'Avatar is required' });
      return;
    }
    if (!normalizedMintTxHash || !isTxHash(normalizedMintTxHash)) {
      res.status(400).json({ error: 'A valid mintTxHash is required for recovery' });
      return;
    }

    // Check duplicate txHash
    const existingMintTx = await db.query('SELECT id FROM agents WHERE LOWER(mint_tx_hash) = LOWER($1) LIMIT 1', [normalizedMintTxHash]);
    if (existingMintTx.rows.length > 0) {
      res.status(409).json({ error: 'This transaction has already been registered' });
      return;
    }

    // Verify on-chain — this confirms the tx is a valid NFA.mint from this wallet
    const mintTxVerification = await verifyAgentMintTxOnChain({
      txHash: normalizedMintTxHash,
      expectedMinter: req.userAddress!,
    });
    if (!mintTxVerification.ok) {
      res.status(mintTxVerification.statusCode).json({ error: mintTxVerification.error });
      return;
    }
    const resolvedTokenId = mintTxVerification.tokenId;

    // Check duplicate tokenId
    const existingToken = await db.query('SELECT id FROM agents WHERE token_id = $1 LIMIT 1', [resolvedTokenId]);
    if (existingToken.rows.length > 0) {
      res.status(409).json({ error: 'This token ID has already been registered' });
      return;
    }

    const id = generateId();
    const now = Date.now();

    await db.query(`
      INSERT INTO agents (id, name, owner_address, strategy, description, persona, avatar, token_id, mint_tx_hash, wallet_balance, level, experience, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1000, 1, 0, $10)
    `, [id, name.trim(), req.userAddress, strategy || 'random', description || '', persona || '', avatar, resolvedTokenId, normalizedMintTxHash, now]);

    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [id])).rows[0];
    res.json({ agent });
  } catch (err: any) {
    console.error('Agent recover error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/agents/:id — update agent (owner only)
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    if (agent.owner_address !== req.userAddress) {
      res.status(403).json({ error: 'Not the owner' });
      return;
    }

    const { strategy, description, name, avatar } = req.body;
    if (strategy && !VALID_STRATEGIES.includes(strategy)) {
      res.status(400).json({ error: 'Invalid strategy' });
      return;
    }

    await db.query(`
      UPDATE agents SET
        name = COALESCE($1, name),
        strategy = COALESCE($2, strategy),
        description = COALESCE($3, description),
        avatar = COALESCE($4, avatar)
      WHERE id = $5
    `, [name || null, strategy || null, description || null, avatar || null, req.params.id]);

    const updated = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    res.json({ agent: updated });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/agents/:id/list-sale — list for sale
router.post('/:id/list-sale', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    const parsedPrice = parsePositiveNumber(req.body?.price);
    if (parsedPrice === null) { res.status(400).json({ error: 'Valid price required' }); return; }

    await db.query('UPDATE agents SET is_for_sale = 1, sale_price = $1 WHERE id = $2', [parsedPrice, req.params.id]);
    const updated = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    res.json({ agent: updated });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/agents/:id/list-rent — list for rent
router.post('/:id/list-rent', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    const parsedPricePerDay = parsePositiveNumber(req.body?.pricePerDay);
    if (parsedPricePerDay === null) { res.status(400).json({ error: 'Valid pricePerDay required' }); return; }

    await db.query('UPDATE agents SET is_for_rent = 1, rent_price = $1 WHERE id = $2', [parsedPricePerDay, req.params.id]);
    const updated = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    res.json({ agent: updated });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/agents/:id/buy — buy agent
router.post('/:id/buy', authMiddleware, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const client = await db.connect();
  let committed = false;
  try {
    await client.query('BEGIN');

    const agent = (await client.query('SELECT * FROM agents WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0] as any;
    if (!agent) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Agent not found' }); return; }
    if (!agent.is_for_sale) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Agent is not for sale' }); return; }
    if (agent.owner_address === req.userAddress) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Cannot buy your own agent' }); return; }

    // If agent is minted on-chain, require and verify txHash
    if (agent.token_id != null) {
      const { txHash } = req.body;
      if (!txHash || !isTxHash(txHash)) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Valid transaction hash required for on-chain purchase' });
        return;
      }

      // Verify the on-chain Transfer event (seller -> buyer for this tokenId)
      if (NFA_CONTRACT_ADDRESS) {
        try {
          const provider = getNfaProvider();
          const receipt = await provider.getTransactionReceipt(txHash);
          if (!receipt || receipt.status !== 1) {
            await client.query('ROLLBACK');
            res.status(400).json({ error: 'Transaction not found or failed on-chain' });
            return;
          }
          const transferTopic = ethers.id('Transfer(address,address,uint256)');
          const iface = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)']);
          let verified = false;
          for (const log of receipt.logs) {
            if ((log.address || '').toLowerCase() !== NFA_CONTRACT_ADDRESS) continue;
            if (!log.topics?.length || log.topics[0] !== transferTopic) continue;
            try {
              const decoded = iface.decodeEventLog('Transfer', log.data, log.topics);
              const from = String(decoded[0] || '').toLowerCase();
              const to = String(decoded[1] || '').toLowerCase();
              const tokenId = (decoded[2] as bigint).toString();
              if (from === agent.owner_address && to === req.userAddress && tokenId === String(agent.token_id)) {
                verified = true;
                break;
              }
            } catch { continue; }
          }
          if (!verified) {
            await client.query('ROLLBACK');
            res.status(400).json({ error: 'On-chain NFT transfer not verified for this agent' });
            return;
          }
        } catch (verifyErr: any) {
          console.error('NFT transfer verification error:', verifyErr.message);
          await client.query('ROLLBACK');
          res.status(500).json({ error: 'Failed to verify on-chain transfer' });
          return;
        }
      }
    }

    const price = agent.sale_price;

    // Check buyer has sufficient balance
    const buyerBalance = (await client.query(
      'SELECT available FROM balances WHERE user_address = $1 FOR UPDATE',
      [req.userAddress]
    )).rows[0];
    if (!buyerBalance || buyerBalance.available < price) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Insufficient balance' });
      return;
    }

    // Deduct buyer's balance
    await client.query(
      'UPDATE balances SET available = available - $1 WHERE user_address = $2',
      [price, req.userAddress]
    );

    // Credit seller's balance
    await client.query(`
      INSERT INTO balances (user_address, available, locked)
      VALUES ($1, $2, 0)
      ON CONFLICT (user_address)
      DO UPDATE SET available = balances.available + $2
    `, [agent.owner_address, price]);

    // Transfer ownership
    await client.query(`
      UPDATE agents SET owner_address = $1, is_for_sale = 0, sale_price = NULL WHERE id = $2
    `, [req.userAddress, req.params.id]);

    await client.query('COMMIT');
    committed = true;

    const updated = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    res.json({ agent: updated });
  } catch (err: any) {
    if (!committed) {
      await client.query('ROLLBACK');
    }
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/agents/:id/rent — rent agent
router.post('/:id/rent', authMiddleware, async (req: AuthRequest, res: Response) => {
  const db = getDb();
  const client = await db.connect();
  let committed = false;
  try {
    await client.query('BEGIN');

    const agent = (await client.query('SELECT * FROM agents WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0] as any;
    if (!agent) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Agent not found' }); return; }
    if (!agent.is_for_rent) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Agent is not for rent' }); return; }
    if (agent.rented_by) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Agent is already rented' }); return; }
    if (agent.owner_address === req.userAddress) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Cannot rent your own agent' }); return; }

    const parsedDays = parsePositiveInteger(req.body?.days);
    if (parsedDays === null) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Valid days required' }); return; }

    const totalRentCost = agent.rent_price * parsedDays;

    // Check renter has sufficient balance
    const renterBalance = (await client.query(
      'SELECT available FROM balances WHERE user_address = $1 FOR UPDATE',
      [req.userAddress]
    )).rows[0];
    if (!renterBalance || renterBalance.available < totalRentCost) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Insufficient balance' });
      return;
    }

    // Deduct renter's balance
    await client.query(
      'UPDATE balances SET available = available - $1 WHERE user_address = $2',
      [totalRentCost, req.userAddress]
    );

    // Credit owner's balance
    await client.query(`
      INSERT INTO balances (user_address, available, locked)
      VALUES ($1, $2, 0)
      ON CONFLICT (user_address)
      DO UPDATE SET available = balances.available + $2
    `, [agent.owner_address, totalRentCost]);

    // Set rental info
    const rentExpires = Date.now() + parsedDays * 86400000;
    await client.query('UPDATE agents SET rented_by = $1, rent_expires = $2 WHERE id = $3',
      [req.userAddress, rentExpires, req.params.id]);

    await client.query('COMMIT');
    committed = true;

    const updated = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    res.json({ agent: updated });
  } catch (err: any) {
    if (!committed) {
      await client.query('ROLLBACK');
    }
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// DELETE /api/agents/:id/delist — remove from sale/rent
router.delete('/:id/delist', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    await db.query('UPDATE agents SET is_for_sale = 0, sale_price = NULL, is_for_rent = 0, rent_price = NULL WHERE id = $1',
      [req.params.id]);

    const updated = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    res.json({ agent: updated });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== BAP-578 Agent Prediction & Advisory Routes ==========

// POST /api/agents/:id/predict — record prediction
router.post('/:id/predict', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    const { marketId, prediction, confidence, reasoning } = req.body;
    const parsedConfidence = Number(confidence);
    if (typeof marketId !== 'string' || !marketId.trim()) {
      res.status(400).json({ error: 'marketId is required' });
      return;
    }
    if (prediction !== 'yes' && prediction !== 'no') {
      res.status(400).json({ error: 'prediction must be "yes" or "no"' });
      return;
    }
    if (!Number.isFinite(parsedConfidence) || parsedConfidence < 0 || parsedConfidence > 1) {
      res.status(400).json({ error: 'confidence must be between 0 and 1' });
      return;
    }

    const result = await recordPrediction(db, {
      agentId: req.params.id as string,
      marketId,
      prediction,
      confidence: parsedConfidence,
      reasoning,
    });
    res.json({ prediction: result });
  } catch (err: any) {
    const safePredictionMessages = ['Agent not found', 'Market not found', 'Market is not active', 'already has a prediction', 'Prediction must be', 'Confidence must be'];
    const isSafe = safePredictionMessages.some(m => err.message?.includes(m));
    if (isSafe) {
      res.status(400).json({ error: err.message });
    } else {
      console.error('Agent prediction error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// GET /api/agents/:id/predictions — prediction history
router.get('/:id/predictions', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rawLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
    const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 50, 100));
    const predictions = (await db.query(
      'SELECT * FROM agent_predictions WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2',
      [req.params.id, limit]
    )).rows;
    res.json({ predictions });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agents/:id/style-profile — style profile
router.get('/:id/style-profile', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const report = await analyzeStyle(db, req.params.id as string);
    res.json({ profile: report });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/agents/:id/suggest — generate suggestion
router.post('/:id/suggest', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    const { marketId } = req.body;
    const suggestion = await generateSuggestion(db, req.params.id as string, marketId);
    res.json({ suggestion });
  } catch (err: any) {
    const safeSuggestionMessages = ['Agent not found', 'Market not found', 'Market is not active'];
    const isSafe = safeSuggestionMessages.some(m => err.message?.includes(m));
    if (isSafe) {
      res.status(400).json({ error: err.message });
    } else {
      console.error('Agent suggestion error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// POST /api/agents/:id/execute-suggestion — execute suggestion with risk confirmation
router.post('/:id/execute-suggestion', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    const { suggestionId, riskConfirmed } = req.body;
    if (!riskConfirmed) {
      res.status(400).json({ error: '请确认你已了解交易风险' });
      return;
    }

    const suggestion = (await db.query('SELECT * FROM agent_trade_suggestions WHERE id = $1 AND agent_id = $2', [suggestionId, req.params.id])).rows[0] as any;
    if (!suggestion) { res.status(404).json({ error: 'Suggestion not found' }); return; }
    if (suggestion.user_action) { res.status(400).json({ error: '建议已被处理' }); return; }

    // Mark as accepted
    await db.query('UPDATE agent_trade_suggestions SET user_action = $1, acted_at = $2 WHERE id = $3',
      ['accepted', Date.now(), suggestionId]);

    res.json({ success: true, suggestion: { ...suggestion, user_action: 'accepted' } });
  } catch (err: any) {
    console.error('Agent execute-suggestion error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/agents/:id/authorize-trade — authorize auto trading
router.post('/:id/authorize-trade', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    const parsedMaxPerTrade = parsePositiveNumber(req.body?.maxPerTrade);
    const parsedMaxDailyAmount = parsePositiveNumber(req.body?.maxDailyAmount);
    const parsedDurationHours = parsePositiveInteger(req.body?.durationHours);

    if (parsedMaxPerTrade === null) { res.status(400).json({ error: 'Invalid maxPerTrade' }); return; }
    if (parsedMaxDailyAmount === null) { res.status(400).json({ error: 'Invalid maxDailyAmount' }); return; }
    if (parsedDurationHours === null || parsedDurationHours < 1 || parsedDurationHours > 720) {
      res.status(400).json({ error: 'Duration must be 1-720 hours' });
      return;
    }

    const expiresAt = Date.now() + parsedDurationHours * 3600000;

    await db.query(`
      UPDATE agents SET
        prediction_mode = 'auto_trade',
        auto_trade_enabled = 1,
        max_per_trade = $1,
        max_daily_amount = $2,
        daily_trade_used = 0,
        auto_trade_expires = $3
      WHERE id = $4
    `, [parsedMaxPerTrade, parsedMaxDailyAmount, expiresAt, req.params.id]);

    const updated = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    res.json({ agent: updated });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/agents/:id/revoke-trade — revoke auto trading
router.post('/:id/revoke-trade', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    await db.query(`
      UPDATE agents SET
        prediction_mode = 'observe',
        auto_trade_enabled = 0,
        auto_trade_expires = NULL
      WHERE id = $1
    `, [req.params.id]);

    const updated = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0];
    res.json({ agent: updated });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/agents/:id/vault — update vault
router.put('/:id/vault', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { vaultURI, vaultHash } = req.body;
    const userAddress = req.userAddress;

    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address.toLowerCase() !== userAddress!.toLowerCase()) {
      res.status(403).json({ error: 'Not owner' });
      return;
    }

    await db.query('UPDATE agents SET vault_uri = $1, vault_hash = $2 WHERE id = $3',
      [vaultURI || null, vaultHash || null, id]);

    res.json({ success: true, vaultURI, vaultHash });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agents/:id/vault — get vault info
router.get('/:id/vault', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const agent = (await db.query('SELECT vault_uri, vault_hash FROM agents WHERE id = $1', [id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json({ vaultURI: agent.vault_uri, vaultHash: agent.vault_hash });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agents/:id/learning-metrics — learning metrics
router.get('/:id/learning-metrics', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const metrics = await getLearningMetrics(db, req.params.id as string);
    res.json({ metrics });
  } catch (err: any) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== Owner Learning Routes ==========

// POST /api/agents/:id/learn-from-owner -- toggle learn_from_owner
router.post('/:id/learn-from-owner', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    const { enabled } = req.body;
    const val = enabled ? 1 : 0;

    await db.query('UPDATE agents SET learn_from_owner = $1 WHERE id = $2', [val, req.params.id]);

    // If enabling, trigger an immediate sync
    if (val === 1) {
      try {
        await syncOwnerProfile(db, req.params.id as string);
      } catch (syncErr: any) {
        console.error('Owner profile initial sync error:', syncErr.message);
      }
    }

    res.json({ success: true, learnFromOwner: val });
  } catch (err: any) {
    console.error('Learn-from-owner toggle error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agents/:id/owner-profile -- view owner trading profile and derived influence
router.get('/:id/owner-profile', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    if (!agent.learn_from_owner) {
      res.json({ profile: null, influence: null, enabled: false });
      return;
    }

    // Force a fresh sync
    const profile = await syncOwnerProfile(db, req.params.id as string);
    const influence = await getOwnerInfluence(db, req.params.id as string);

    res.json({ profile, influence, enabled: true });
  } catch (err: any) {
    console.error('Owner profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== NFA Agent LLM Configuration Routes ==========

const VALID_PROVIDERS = ['openai', 'anthropic', 'google', 'deepseek', 'zhipu', 'custom'];

// PUT /api/agents/:id/llm-config -- set or update LLM config
router.put('/:id/llm-config', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    const { provider, model, apiKey, baseUrl, systemPrompt, temperature, maxTokens } = req.body;

    if (!provider || !VALID_PROVIDERS.includes(provider)) {
      res.status(400).json({ error: 'Invalid provider. Must be one of: ' + VALID_PROVIDERS.join(', ') });
      return;
    }
    if (!model || typeof model !== 'string') {
      res.status(400).json({ error: 'Model is required' });
      return;
    }
    if (provider === 'custom' && (!baseUrl || typeof baseUrl !== 'string')) {
      res.status(400).json({ error: 'Base URL is required for custom provider' });
      return;
    }

    const temp = typeof temperature === 'number' ? Math.max(0, Math.min(1, temperature)) : 0.7;
    const tokens = typeof maxTokens === 'number' ? Math.max(64, Math.min(4096, maxTokens)) : 1024;
    const now = Date.now();

    // Check if updating existing config with "KEEP_EXISTING" sentinel
    let encryptedKey: string;
    if (apiKey === 'KEEP_EXISTING') {
      const existing = (await db.query('SELECT api_key_encrypted FROM agent_llm_config WHERE agent_id = $1', [req.params.id])).rows[0] as any;
      if (!existing) {
        res.status(400).json({ error: 'Valid API key is required (no existing config found)' });
        return;
      }
      encryptedKey = existing.api_key_encrypted;
    } else {
      if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 8) {
        res.status(400).json({ error: 'Valid API key is required (min 8 chars)' });
        return;
      }
      encryptedKey = encrypt(apiKey);
    }

    await db.query(`
      INSERT INTO agent_llm_config (agent_id, provider, model, api_key_encrypted, base_url, system_prompt, temperature, max_tokens, enabled, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $9)
      ON CONFLICT (agent_id)
      DO UPDATE SET provider = $2, model = $3, api_key_encrypted = $4, base_url = $5, system_prompt = $6, temperature = $7, max_tokens = $8, updated_at = $9
    `, [req.params.id, provider, model, encryptedKey, baseUrl || null, systemPrompt || null, temp, tokens, now]);

    res.json({ success: true });
  } catch (err: any) {
    console.error('LLM config update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/agents/:id/llm-config -- get LLM config (key masked)
router.get('/:id/llm-config', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT owner_address FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    const config = (await db.query('SELECT * FROM agent_llm_config WHERE agent_id = $1', [req.params.id])).rows[0] as any;
    if (!config) {
      res.json({ config: null });
      return;
    }

    let maskedKey = '****';
    try {
      const rawKey = decrypt(config.api_key_encrypted);
      maskedKey = maskApiKey(rawKey);
    } catch {}

    res.json({
      config: {
        provider: config.provider,
        model: config.model,
        apiKeyMasked: maskedKey,
        baseUrl: config.base_url,
        systemPrompt: config.system_prompt,
        temperature: config.temperature,
        maxTokens: config.max_tokens,
        enabled: config.enabled,
        lastUsedAt: config.last_used_at,
        totalCalls: config.total_calls,
        totalErrors: config.total_errors,
        createdAt: config.created_at,
        updatedAt: config.updated_at,
      },
    });
  } catch (err: any) {
    console.error('LLM config get error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/agents/:id/llm-config -- remove LLM config
router.delete('/:id/llm-config', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT owner_address FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    await db.query('DELETE FROM agent_llm_config WHERE agent_id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    console.error('LLM config delete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/agents/:id/llm-config/toggle -- toggle LLM on/off
router.post('/:id/llm-config/toggle', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const agent = (await db.query('SELECT owner_address FROM agents WHERE id = $1', [req.params.id])).rows[0] as any;
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.owner_address !== req.userAddress) { res.status(403).json({ error: 'Not the owner' }); return; }

    const { enabled } = req.body;
    const val = enabled ? 1 : 0;

    const result = await db.query(
      'UPDATE agent_llm_config SET enabled = $1, updated_at = $2 WHERE agent_id = $3',
      [val, Date.now(), req.params.id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'No LLM config found for this agent' });
      return;
    }

    res.json({ success: true, enabled: val });
  } catch (err: any) {
    console.error('LLM config toggle error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
