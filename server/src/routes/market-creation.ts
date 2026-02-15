import { Router, Request, Response } from 'express';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { getDb } from '../db';
import { createLMSRPool, getLMSRPrices } from '../engine/lmsr';

const router = Router();

function generateId(): string {
  return 'ucm-' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

const OPTION_COLORS = ['#10b981', '#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'];

const VALID_CATEGORIES = [
  'four-meme', 'flap', 'nfa', 'hackathon'
];
const VALID_RESOLUTION_TYPES = ['manual', 'price_above', 'price_below'] as const;

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
    } catch {
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
    const endTimeMs = Number(endTime);
    const now = Date.now();
    if (!Number.isFinite(endTimeMs)) {
      res.status(400).json({ error: '结束时间格式无效' });
      return;
    }
    if (endTimeMs <= now + 3600000) {
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

    if (!Number.isInteger(parsedOnChainMarketId) || parsedOnChainMarketId < 0) {
      res.status(400).json({ error: 'onChainMarketId is required and must be a non-negative integer' });
      return;
    }
    if (!isTxHash(normalizedCreateTxHash)) {
      res.status(400).json({ error: 'createTxHash is required and must be a valid transaction hash' });
      return;
    }

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

      // Atomically increment daily_count only if under the limit (FOR UPDATE locks the row)
      const rateLimitResult = await client.query(
        `UPDATE market_creation_ratelimit
         SET daily_count = daily_count + 1, total_created = total_created + 1
         WHERE user_address = $1 AND daily_count < 3
         RETURNING *`,
        [userAddress]
      );

      if (rateLimitResult.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(429).json({ error: '今日创建市场数量已达上限 (3/天)' });
        return;
      }

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
        await client.query('ROLLBACK');
        res.status(400).json({ error: '当前链上主流程仅支持二元市场（YES/NO）' });
        return;
      }

      // Create market
      const marketId = generateId();
      const totalLiquidity = 10000;
      // Bug D10 Fix: Truncate endTimeMs to integer to prevent storing fractional timestamps.

      if (isMulti) {
        const numOptions = optionLabels.length;
        const pool = createLMSRPool(numOptions, totalLiquidity);
        const initialPrices = getLMSRPrices(pool.reserves, pool.b);

        await client.query(`
          INSERT INTO markets (id, on_chain_market_id, title, description, category, end_time, status, yes_price, no_price, volume, total_liquidity, yes_reserve, no_reserve, created_at, market_type)
          VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, 0, $9, 0, 0, $10, 'multi')
        `, [marketId, parsedOnChainMarketId, normalizedTitle, normalizedDescription, normalizedCategory || 'four-meme', Math.floor(endTimeMs), initialPrices[0], 1 - initialPrices[0], totalLiquidity, Math.floor(now)]);

        // Insert market_options rows
        for (let i = 0; i < numOptions; i++) {
          const opt = optionLabels[i];
          const optId = generateId();
          const color = opt.color || OPTION_COLORS[i % OPTION_COLORS.length];
          await client.query(`
            INSERT INTO market_options (id, market_id, option_index, label, color, reserve, price)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [optId, marketId, i, opt.label.trim(), color, pool.reserves[i], initialPrices[i]]);
        }
      } else {
        await client.query(`
          INSERT INTO markets (id, on_chain_market_id, title, description, category, end_time, status, yes_price, no_price, volume, total_liquidity, yes_reserve, no_reserve, created_at, market_type)
          VALUES ($1, $2, $3, $4, $5, $6, 'active', 0.5, 0.5, 0, 10000, 10000, 10000, $7, 'binary')
        `, [marketId, parsedOnChainMarketId, normalizedTitle, normalizedDescription, normalizedCategory || 'four-meme', Math.floor(endTimeMs), Math.floor(now)]);
      }

      // Track in user_created_markets
      await client.query(`
        INSERT INTO user_created_markets (id, market_id, creator_address, creation_fee, create_tx_hash, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [generateId(), marketId, userAddress, recordedCreationFee, normalizedCreateTxHash, now]);

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
      res.json({ market: marketResult.rows[0], fee: recordedCreationFee });
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
      creationFee: 10,
      balance: balance?.available || 0,
    });
  } catch (err: any) {
    console.error('Creation stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
