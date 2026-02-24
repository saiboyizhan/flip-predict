import { Router, Request, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { adminMiddleware } from './middleware/admin';
import { getDb } from '../db';
import { ethers } from 'ethers';
import { BSC_RPC_URL } from '../config/network';

const router = Router();

function generateId(): string {
  return 'ucm-' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

const VALID_CATEGORIES = [
  'four-meme', 'flap', 'nfa', 'other'
];
const VALID_RESOLUTION_TYPES = ['manual', 'price_above', 'price_below'] as const;
const MARKET_CREATION_RPC_URL =
  (process.env.MARKET_CREATION_RPC_URL || '').trim() ||
  (process.env.SETTLEMENT_RPC_URL || '').trim() ||
  BSC_RPC_URL;
const RAW_PREDICTION_MARKET_CONTRACT_ADDRESS =
  process.env.PREDICTION_MARKET_ADDRESS ||
  process.env.SETTLEMENT_CONTRACT_ADDRESS ||
  process.env.VITE_PREDICTION_MARKET_ADDRESS ||
  '';
const PREDICTION_MARKET_CONTRACT_ADDRESS = ethers.isAddress(RAW_PREDICTION_MARKET_CONTRACT_ADDRESS)
  ? RAW_PREDICTION_MARKET_CONTRACT_ADDRESS.toLowerCase()
  : null;

let marketCreationProvider: ethers.JsonRpcProvider | null = null;

function getMarketCreationProvider(): ethers.JsonRpcProvider {
  if (!marketCreationProvider) {
    marketCreationProvider = new ethers.JsonRpcProvider(MARKET_CREATION_RPC_URL);
  }
  return marketCreationProvider;
}

function parseAddressArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((addr) => String(addr).toLowerCase());
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((addr) => String(addr).toLowerCase());
      }
    } catch (err) {
      console.warn('parseAddressArray JSON parse failed:', err instanceof Error ? err.message : 'unknown error');
      return [];
    }
  }
  return [];
}

function normalizeOptionalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

function isTxHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

async function getContractCreationFee(): Promise<bigint> {
  if (!PREDICTION_MARKET_CONTRACT_ADDRESS) return 0n;
  const provider = getMarketCreationProvider();
  const contract = new ethers.Contract(
    PREDICTION_MARKET_CONTRACT_ADDRESS,
    ['function marketCreationFee() view returns (uint256)'],
    provider,
  );
  try {
    const fee: bigint = await contract.marketCreationFee();
    return fee;
  } catch {
    return 0n;
  }
}

async function verifyCreateMarketTxOnChain(params: {
  txHash: string;
  expectedCreator: string;
  expectedMarketId: number;
  expectedEndTimeMs: number;
  expectedTitle: string;
}): Promise<{ ok: true; blockNumber: number; creationFeeWei: bigint; initialLiquidityWei: bigint } | { ok: false; statusCode: number; error: string }> {
  if (!PREDICTION_MARKET_CONTRACT_ADDRESS) {
    return { ok: false, statusCode: 503, error: 'Market creation verification is not configured' };
  }

  const expectedCreator = params.expectedCreator.toLowerCase();
  const expectedMarketId = String(params.expectedMarketId);
  const expectedEndTime = BigInt(Math.floor(params.expectedEndTimeMs / 1000));
  const expectedTitle = params.expectedTitle.trim();

  const iface = new ethers.Interface([
    'function createUserMarket(string title, uint256 endTime, uint256 initialLiquidity)',
    'event UserMarketCreated(uint256 indexed marketId, address indexed creator, string title, uint256 creationFee)',
  ]);
  const createUserMarketSelector = ethers.id('createUserMarket(string,uint256,uint256)').slice(0, 10);
  const createdEventTopic = ethers.id('UserMarketCreated(uint256,address,string,uint256)');
  const provider = getMarketCreationProvider();

  try {
    const receipt = await provider.getTransactionReceipt(params.txHash);
    if (!receipt) {
      return { ok: false, statusCode: 400, error: 'createTxHash not found or not confirmed yet' };
    }
    if (receipt.status !== 1) {
      return { ok: false, statusCode: 400, error: 'createTxHash failed on-chain' };
    }

    const tx = await provider.getTransaction(params.txHash);
    if (!tx) {
      return { ok: false, statusCode: 400, error: 'createTxHash transaction details unavailable' };
    }

    const txFrom = (tx.from || '').toLowerCase();
    if (txFrom !== expectedCreator) {
      return { ok: false, statusCode: 400, error: 'createTxHash sender does not match creator wallet' };
    }

    const txTo = (tx.to || receipt.to || null)?.toLowerCase() ?? null;
    if (!txTo || txTo !== PREDICTION_MARKET_CONTRACT_ADDRESS) {
      return { ok: false, statusCode: 400, error: 'createTxHash target does not match PredictionMarket contract' };
    }

    const calldata = tx.data || '';
    if (calldata.length < 10 || calldata.slice(0, 10) !== createUserMarketSelector) {
      return { ok: false, statusCode: 400, error: 'createTxHash must call createUserMarket' };
    }

    let decodedTitle = '';
    let decodedEndTime = 0n;
    let decodedInitialLiquidity = 0n;
    try {
      const decoded = iface.decodeFunctionData('createUserMarket', calldata);
      decodedTitle = String(decoded[0] ?? '').trim();
      decodedEndTime = decoded[1] as bigint;
      decodedInitialLiquidity = decoded[2] as bigint;
    } catch {
      return { ok: false, statusCode: 400, error: 'createTxHash calldata decode failed' };
    }

    if (decodedTitle !== expectedTitle) {
      return { ok: false, statusCode: 400, error: 'createTxHash title does not match request payload' };
    }
    if (decodedEndTime !== expectedEndTime) {
      return { ok: false, statusCode: 400, error: 'createTxHash endTime does not match request payload' };
    }
    // initialLiquidity must be >= 10 USDT (10e18 wei)
    const MIN_INITIAL_LIQ_WEI = 10n * 10n ** 18n;
    if (decodedInitialLiquidity < MIN_INITIAL_LIQ_WEI) {
      return { ok: false, statusCode: 400, error: `createTxHash initialLiquidity (${decodedInitialLiquidity.toString()}) is below minimum 10 USDT` };
    }

    let foundCreatedEvent = false;
    let eventCreationFee = 0n;
    for (const log of receipt.logs) {
      if ((log.address || '').toLowerCase() !== PREDICTION_MARKET_CONTRACT_ADDRESS) continue;
      if (!log.topics?.length || log.topics[0] !== createdEventTopic) continue;
      try {
        const decoded = iface.decodeEventLog('UserMarketCreated', log.data, log.topics);
        const eventMarketId = (decoded[0] as bigint).toString();
        const eventCreator = String(decoded[1] || '').toLowerCase();
        if (eventCreator === expectedCreator && eventMarketId === expectedMarketId) {
          foundCreatedEvent = true;
          eventCreationFee = decoded[3] as bigint;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!foundCreatedEvent) {
      return { ok: false, statusCode: 400, error: 'createTxHash does not prove the provided onChainMarketId' };
    }

    // Verify creation fee meets the contract minimum
    const minFee = await getContractCreationFee();
    if (minFee > 0n && eventCreationFee < minFee) {
      return { ok: false, statusCode: 400, error: `Creation fee ${eventCreationFee.toString()} is below contract minimum ${minFee.toString()}` };
    }

    return { ok: true, blockNumber: receipt.blockNumber, creationFeeWei: eventCreationFee, initialLiquidityWei: decodedInitialLiquidity };
  } catch (err) {
    console.error('Create market tx verification error:', err);
    return { ok: false, statusCode: 503, error: 'Market creation verification service unavailable' };
  }
}

// POST /api/markets/create — create user market
router.post('/create', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const {
      title,
      description,
      category,
      endTime,
      marketType,
      options: optionLabels,
      resolutionType,
      oraclePair,
      targetPrice,
      resolutionRule,
      resolutionSourceUrl,
      resolutionTimeUtc,
      onChainMarketId,
      createTxHash,
      onChainCreationFee,
    } = req.body;
    const userAddress = req.userAddress!;
    const normalizedTitle = typeof title === 'string' ? title.trim() : '';
    const normalizedDescription = typeof description === 'string' ? description.trim() : '';
    const normalizedCategory = typeof category === 'string' ? category.trim() : '';
    const normalizedResolutionType = typeof resolutionType === 'string' && VALID_RESOLUTION_TYPES.includes(resolutionType as any)
      ? resolutionType
      : 'manual';
    const normalizedOraclePair = typeof oraclePair === 'string' ? oraclePair.trim() : '';
    const parsedTargetPrice = Number(targetPrice);
    const normalizedRuleText = typeof resolutionRule === 'string' ? resolutionRule.trim() : '';
    const normalizedSourceUrl = normalizeOptionalUrl(resolutionSourceUrl);
    if (typeof resolutionSourceUrl === 'string' && resolutionSourceUrl.trim() && !normalizedSourceUrl) {
      res.status(400).json({ error: 'resolutionSourceUrl 必须是合法的 http/https 链接' });
      return;
    }

    // Validate title
    if (!normalizedTitle || normalizedTitle.length < 10 || normalizedTitle.length > 200) {
      res.status(400).json({ error: '标题长度需在 10-200 字之间' });
      return;
    }

    // Validate category
    if (normalizedCategory && !VALID_CATEGORIES.includes(normalizedCategory)) {
      res.status(400).json({ error: '无效分类' });
      return;
    }

    // Validate endTime
    const endTimeMs = Math.floor(Number(endTime));
    const now = Date.now();
    if (!Number.isFinite(endTimeMs)) {
      res.status(400).json({ error: '结束时间格式无效' });
      return;
    }
    if (endTimeMs < now + 3600000) {
      res.status(400).json({ error: '结束时间至少需要1小时后' });
      return;
    }
    if (endTimeMs > now + 90 * 86400000) {
      res.status(400).json({ error: '结束时间不能超过90天' });
      return;
    }

    if (!VALID_RESOLUTION_TYPES.includes(normalizedResolutionType as any)) {
      res.status(400).json({ error: '无效结算类型' });
      return;
    }

    if (normalizedResolutionType === 'manual' && normalizedRuleText.length < 10) {
      res.status(400).json({ error: '手动结算市场必须提供至少10个字符的判定规则' });
      return;
    }

    if ((normalizedResolutionType === 'price_above' || normalizedResolutionType === 'price_below')) {
      if (!normalizedOraclePair) {
        res.status(400).json({ error: '价格类市场必须提供 oraclePair' });
        return;
      }
      if (!Number.isFinite(parsedTargetPrice) || parsedTargetPrice <= 0) {
        res.status(400).json({ error: '价格类市场必须提供有效 targetPrice' });
        return;
      }
    }

    const parsedResolutionTime = Number(resolutionTimeUtc);
    const parsedOnChainMarketId = Number(onChainMarketId);
    const normalizedCreateTxHash = typeof createTxHash === 'string' ? createTxHash.trim().toLowerCase() : '';
    const parsedOnChainCreationFee = Number(onChainCreationFee);
    const recordedCreationFee = Number.isFinite(parsedOnChainCreationFee) && parsedOnChainCreationFee >= 0
      ? parsedOnChainCreationFee
      : 10;

    if (!Number.isSafeInteger(parsedOnChainMarketId) || parsedOnChainMarketId < 0) {
      res.status(400).json({ error: 'onChainMarketId is required and must be a non-negative integer' });
      return;
    }
    if (!isTxHash(normalizedCreateTxHash)) {
      res.status(400).json({ error: 'createTxHash is required and must be a valid transaction hash' });
      return;
    }

    const createTxVerification = await verifyCreateMarketTxOnChain({
      txHash: normalizedCreateTxHash,
      expectedCreator: userAddress,
      expectedMarketId: parsedOnChainMarketId,
      expectedEndTimeMs: endTimeMs,
      expectedTitle: normalizedTitle,
    });
    if (!createTxVerification.ok) {
      res.status(createTxVerification.statusCode).json({ error: createTxVerification.error });
      return;
    }
    // Use on-chain fee from event instead of client-reported value
    const verifiedCreationFee = Number(ethers.formatUnits(createTxVerification.creationFeeWei, 18));
    // Use on-chain initial liquidity from calldata
    const verifiedInitialLiquidity = Number(ethers.formatUnits(createTxVerification.initialLiquidityWei, 18));

    const resolutionTimeMs = Number.isFinite(parsedResolutionTime)
      ? Math.floor(parsedResolutionTime)
      : Math.floor(endTimeMs);
    if (resolutionTimeMs < endTimeMs) {
      res.status(400).json({ error: '结算时间必须晚于市场结束时间' });
      return;
    }

    // Use a single transaction for rate limit check + creation
    // to prevent race conditions where concurrent requests bypass the rate limit
    const client = await db.connect();
    let committed = false;
    try {
      await client.query('BEGIN');

      // Atomic rate limit check inside transaction:
      // First, ensure the ratelimit row exists (upsert)
      const today = Math.floor(now / 86400000);
      await client.query(`
        INSERT INTO market_creation_ratelimit (user_address, daily_count, last_reset_day, total_created)
        VALUES ($1, 0, $2, 0)
        ON CONFLICT (user_address) DO UPDATE
        SET daily_count = CASE
          WHEN market_creation_ratelimit.last_reset_day != $2 THEN 0
          ELSE market_creation_ratelimit.daily_count
        END,
        last_reset_day = $2
      `, [userAddress, today]);

      // Increment counters (no daily limit)
      await client.query(
        `UPDATE market_creation_ratelimit
         SET daily_count = daily_count + 1, total_created = total_created + 1
         WHERE user_address = $1`,
        [userAddress]
      );

      const existingOnChainMarket = await client.query(
        'SELECT id FROM markets WHERE on_chain_market_id = $1 LIMIT 1 FOR UPDATE',
        [parsedOnChainMarketId],
      );
      if (existingOnChainMarket.rows.length > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'onChainMarketId already exists' });
        return;
      }
      const existingCreateTx = await client.query(
        'SELECT id FROM user_created_markets WHERE LOWER(create_tx_hash) = LOWER($1) LIMIT 1 FOR UPDATE',
        [normalizedCreateTxHash],
      );
      if (existingCreateTx.rows.length > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'createTxHash already exists' });
        return;
      }

      // Validate multi-option specific fields
      const isMulti = marketType === 'multi';
      if (isMulti) {
        // Validate options array length
        if (optionLabels && (!Array.isArray(optionLabels) || optionLabels.length > 20 || optionLabels.length < 2)) {
          await client.query('ROLLBACK');
          res.status(400).json({ error: 'Options must be an array of 2-20 items' });
          return;
        }
        await client.query('ROLLBACK');
        res.status(400).json({ error: '当前链上主流程仅支持二元市场（YES/NO）' });
        return;
      }

      // Create market (binary only - multi blocked above)
      const marketId = generateId();

      // Use verified on-chain initial liquidity (already validated >= 10 USDT)
      const finalInitialLiquidity = Math.max(10, Math.min(100000, verifiedInitialLiquidity));
      const virtualLpShares = finalInitialLiquidity * 2;

      await client.query(`
        INSERT INTO markets (id, on_chain_market_id, title, description, category, end_time, status, yes_price, no_price, volume, total_liquidity, yes_reserve, no_reserve, created_at, market_type, initial_liquidity, virtual_lp_shares)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending_approval', 0.5, 0.5, 0, $8, $8, $8, $7, 'binary', $8, $9)
      `, [marketId, parsedOnChainMarketId, normalizedTitle, normalizedDescription, normalizedCategory || 'four-meme', Math.floor(endTimeMs), Math.floor(now), finalInitialLiquidity, virtualLpShares]);

      // Track in user_created_markets
      await client.query(`
        INSERT INTO user_created_markets (id, market_id, creator_address, creation_fee, create_tx_hash, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [generateId(), marketId, userAddress, verifiedCreationFee, normalizedCreateTxHash, now]);

      // Also create market_resolution entry
      await client.query(
        `INSERT INTO market_resolution (
          market_id, resolution_type, oracle_pair, target_price, rule_text, data_source_url, resolution_time_utc
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          marketId,
          normalizedResolutionType,
          normalizedOraclePair || null,
          Number.isFinite(parsedTargetPrice) ? parsedTargetPrice : null,
          normalizedRuleText || null,
          normalizedSourceUrl,
          resolutionTimeMs,
        ]
      );

      await client.query('COMMIT');
      committed = true;

      const marketResult = await db.query('SELECT * FROM markets WHERE id = $1', [marketId]);
      res.json({ market: marketResult.rows[0], fee: verifiedCreationFee, message: 'Market submitted for review' });
    } catch (txErr) {
      if (!committed) {
        await client.query('ROLLBACK');
      }
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Market creation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/markets/user-created — my created markets
router.get('/user-created', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { rows: markets } = await db.query(`
      SELECT m.*, ucm.creation_fee, ucm.create_tx_hash, ucm.flag_count, ucm.status as ucm_status
      FROM user_created_markets ucm
      JOIN markets m ON m.id = ucm.market_id
      WHERE ucm.creator_address = $1
      ORDER BY ucm.created_at DESC
    `, [req.userAddress]);
    res.json({ markets });
  } catch (err: any) {
    console.error('User-created markets error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/markets/:id/flag — flag a market
router.post('/:id/flag', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();

    // Use transaction with FOR UPDATE to prevent race conditions on concurrent flags
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const ucmResult = await client.query(
        'SELECT * FROM user_created_markets WHERE market_id = $1 FOR UPDATE',
        [req.params.id]
      );
      const ucm = ucmResult.rows[0] as any;

      if (!ucm) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: '市场不是用户创建的' });
        return;
      }

      // Check if already flagged by this user
      const normalizedFlagged = parseAddressArray(ucm.flagged_by);
      const currentUser = req.userAddress!.toLowerCase();
      if (normalizedFlagged.includes(currentUser)) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: '你已经举报过了' });
        return;
      }

      normalizedFlagged.push(currentUser);
      const newFlagCount = ucm.flag_count + 1;
      const newStatus = newFlagCount >= 5 ? 'flagged' : ucm.status;

      await client.query(
        'UPDATE user_created_markets SET flag_count = $1, flagged_by = $2, status = $3 WHERE market_id = $4',
        [newFlagCount, JSON.stringify(normalizedFlagged), newStatus, req.params.id]
      );

      await client.query('COMMIT');

      res.json({ flagCount: newFlagCount, status: newStatus });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Market flag error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/markets/creation-stats — creation stats
router.get('/creation-stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const today = Math.floor(Date.now() / 86400000);

    const rateLimitResult = await db.query(
      'SELECT * FROM market_creation_ratelimit WHERE user_address = $1',
      [req.userAddress]
    );
    const rateLimit = rateLimitResult.rows[0] as any;

    const dailyCount = rateLimit && rateLimit.last_reset_day === today ? rateLimit.daily_count : 0;
    const totalCreated = rateLimit?.total_created || 0;

    const balanceResult = await db.query('SELECT available FROM balances WHERE user_address = $1', [req.userAddress]);
    const balance = balanceResult.rows[0] as any;

    res.json({
      dailyCount,
      maxPerDay: 3,
      totalCreated,
      creationFee: 0,
      balance: balance?.available || 0,
    });
  } catch (err: any) {
    console.error('Creation stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/markets/:id/approve — admin approves a pending market
router.post('/:id/approve', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const marketResult = await db.query(
      'SELECT id, status, title, end_time, on_chain_market_id FROM markets WHERE id = $1',
      [id],
    );
    if (marketResult.rows.length === 0) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    const market = marketResult.rows[0] as any;
    if (market.status !== 'pending_approval') {
      res.status(400).json({ error: `Market is not pending approval (current status: ${market.status})` });
      return;
    }

    // Re-verify on-chain tx before approving
    const ucmResult = await db.query(
      'SELECT create_tx_hash, creator_address FROM user_created_markets WHERE market_id = $1',
      [id],
    );
    const ucm = ucmResult.rows[0] as any;
    if (ucm?.create_tx_hash && market.on_chain_market_id != null) {
      const reVerify = await verifyCreateMarketTxOnChain({
        txHash: ucm.create_tx_hash,
        expectedCreator: ucm.creator_address,
        expectedMarketId: Number(market.on_chain_market_id),
        expectedEndTimeMs: Number(market.end_time),
        expectedTitle: market.title,
      });
      if (!reVerify.ok) {
        res.status(400).json({
          error: `On-chain re-verification failed: ${reVerify.error}`,
        });
        return;
      }
    }

    await db.query('UPDATE markets SET status = $1 WHERE id = $2', ['active', id]);

    // Sync user_created_markets status
    await db.query(
      "UPDATE user_created_markets SET status = 'active' WHERE market_id = $1",
      [id]
    );

    res.json({ success: true, message: 'Market approved' });
  } catch (err: any) {
    console.error('Market approve error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/markets/:id/reject — admin rejects a pending market
router.post('/:id/reject', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { reason } = req.body;

    const marketResult = await db.query('SELECT id, status FROM markets WHERE id = $1', [id]);
    if (marketResult.rows.length === 0) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    const market = marketResult.rows[0] as any;
    if (market.status !== 'pending_approval') {
      res.status(400).json({ error: `Market is not pending approval (current status: ${market.status})` });
      return;
    }

    await db.query(
      'UPDATE markets SET status = $1, rejection_reason = $2 WHERE id = $3',
      ['rejected', reason || null, id]
    );

    // Sync user_created_markets status
    await db.query(
      "UPDATE user_created_markets SET status = 'rejected' WHERE market_id = $1",
      [id]
    );

    res.json({ success: true, message: 'Market rejected', reason: reason || null });
  } catch (err: any) {
    console.error('Market reject error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
