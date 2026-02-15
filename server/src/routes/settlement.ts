import { Router, Request, Response } from 'express';
import { randomUUID, createHash } from 'crypto';
import { ethers } from 'ethers';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { adminMiddleware } from './middleware/admin';
import { getDb } from '../db';
import { settleMarketPositions } from '../engine/keeper';
import { broadcastMarketResolved } from '../ws';
import { resolvePredictions } from '../engine/agent-prediction';
import { getOraclePrice, SUPPORTED_PAIRS } from '../engine/oracle';
import { fetchTokenPrice } from '../engine/dexscreener';

const router = Router();
const DEFAULT_CHALLENGE_WINDOW_MS = Math.max(
  1 * 60 * 60 * 1000,
  Number(process.env.SETTLEMENT_CHALLENGE_WINDOW_MS || 6 * 60 * 60 * 1000),
);
const MAX_CHALLENGES_PER_PROPOSAL = Math.max(
  1,
  Number(process.env.SETTLEMENT_MAX_CHALLENGES || 5),
);
const DEFAULT_BSC_RPC = 'https://bsc-dataseed.bnbchain.org';
const SETTLEMENT_RPC_URL = process.env.SETTLEMENT_RPC_URL || process.env.BSC_RPC_URL || DEFAULT_BSC_RPC;
const RAW_SETTLEMENT_CONTRACT_ADDRESS =
  process.env.SETTLEMENT_CONTRACT_ADDRESS ||
  process.env.PREDICTION_MARKET_ADDRESS ||
  process.env.VITE_PREDICTION_MARKET_ADDRESS ||
  '';
const ADMIN_ADDRESSES = new Set(
  (process.env.ADMIN_ADDRESSES || '')
    .split(',')
    .map((addr) => addr.trim().toLowerCase())
    .filter(Boolean),
);
const SETTLEMENT_CONTRACT_ADDRESS = ethers.isAddress(RAW_SETTLEMENT_CONTRACT_ADDRESS)
  ? RAW_SETTLEMENT_CONTRACT_ADDRESS.toLowerCase()
  : null;
let settlementProvider: ethers.JsonRpcProvider | null = null;

function isTokenAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isTxHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function normalizeOptionalHttpUrl(value: unknown): string | null {
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

function normalizeOptionalText(value: unknown, maxLen = 2000): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function isAdminAddress(address: string | undefined): boolean {
  if (!address) return false;
  return ADMIN_ADDRESSES.has(address.toLowerCase());
}

function isInvalidOptionalHttpUrl(raw: unknown, normalized: string | null): boolean {
  return typeof raw === 'string' && raw.trim().length > 0 && !normalized;
}

function getSettlementProvider(): ethers.JsonRpcProvider {
  if (!settlementProvider) {
    settlementProvider = new ethers.JsonRpcProvider(SETTLEMENT_RPC_URL);
  }
  return settlementProvider;
}

async function verifyResolveTxHashOnChain(
  resolveTxHash: string,
  expectedOnChainMarketId?: string | null,
  expectedOutcome?: string | null,
): Promise<{
  ok: boolean;
  error?: string;
  blockNumber?: number;
  txTo?: string | null;
  decodedMethod?: string | null;
  decodedMarketId?: string | null;
  decodedOutcome?: boolean | null;
}> {
  try {
    const provider = getSettlementProvider();
    const receipt = await provider.getTransactionReceipt(resolveTxHash);
    if (!receipt) {
      return { ok: false, error: 'resolveTxHash not found or not confirmed yet' };
    }
    if (receipt.status !== 1) {
      return { ok: false, error: 'resolveTxHash failed on-chain' };
    }

    const tx = await provider.getTransaction(resolveTxHash);
    if (!tx) {
      return { ok: false, error: 'resolveTxHash transaction details unavailable' };
    }

    const txTo = (tx.to || receipt.to || null)?.toLowerCase() ?? null;
    if (SETTLEMENT_CONTRACT_ADDRESS && txTo !== SETTLEMENT_CONTRACT_ADDRESS) {
      return {
        ok: false,
        error: `resolveTxHash target ${txTo || 'null'} does not match settlement contract ${SETTLEMENT_CONTRACT_ADDRESS}`,
        blockNumber: receipt.blockNumber,
        txTo,
      };
    }

    // Decode calldata to verify method and parameters
    const data = tx.data;
    let decodedMethod: string | null = null;
    let decodedMarketId: string | null = null;
    let decodedOutcome: boolean | null = null;

    if (!data || data.length < 10) {
      return {
        ok: false,
        error: 'resolveTxHash calldata is empty or invalid',
        blockNumber: receipt.blockNumber,
        txTo,
      };
    }

    if (data && data.length >= 10) {
      const selector = data.slice(0, 10);
      // Compute 4-byte selectors for known settlement functions
      const RESOLVE_MARKET = ethers.id("resolveMarket(uint256,bool)").slice(0, 10);
      const RESOLVE_BY_ORACLE = ethers.id("resolveByOracle(uint256)").slice(0, 10);
      const FINALIZE_RESOLUTION = ethers.id("finalizeResolution(uint256,bool)").slice(0, 10);
      const CANCEL_MARKET = ethers.id("cancelMarket(uint256)").slice(0, 10);

      const iface = new ethers.Interface([
        "function resolveMarket(uint256 marketId, bool outcome)",
        "function resolveByOracle(uint256 marketId)",
        "function finalizeResolution(uint256 marketId, bool outcome)",
        "function cancelMarket(uint256 marketId)",
      ]);

      try {
        if (selector === RESOLVE_MARKET) {
          const decoded = iface.decodeFunctionData("resolveMarket", data);
          decodedMethod = "resolveMarket";
          decodedMarketId = decoded[0].toString();
          decodedOutcome = decoded[1];
        } else if (selector === RESOLVE_BY_ORACLE) {
          const decoded = iface.decodeFunctionData("resolveByOracle", data);
          decodedMethod = "resolveByOracle";
          decodedMarketId = decoded[0].toString();
        } else if (selector === FINALIZE_RESOLUTION) {
          const decoded = iface.decodeFunctionData("finalizeResolution", data);
          decodedMethod = "finalizeResolution";
          decodedMarketId = decoded[0].toString();
          decodedOutcome = decoded[1];
        } else if (selector === CANCEL_MARKET) {
          const decoded = iface.decodeFunctionData("cancelMarket", data);
          decodedMethod = "cancelMarket";
          decodedMarketId = decoded[0].toString();
        }
      } catch {
        return {
          ok: false,
          error: 'resolveTxHash calldata decode failed',
          blockNumber: receipt.blockNumber,
          txTo,
        };
      }
    }

    if (!decodedMethod) {
      return {
        ok: false,
        error: 'resolveTxHash must call resolveMarket, resolveByOracle, finalizeResolution, or cancelMarket',
        blockNumber: receipt.blockNumber,
        txTo,
      };
    }

    // Validate decoded marketId if we have an expected value
    if (expectedOnChainMarketId != null && decodedMarketId == null) {
      return {
        ok: false,
        error: 'resolveTxHash is missing decoded marketId',
        blockNumber: receipt.blockNumber,
        txTo,
        decodedMethod,
        decodedMarketId,
        decodedOutcome,
      };
    }
    if (expectedOnChainMarketId != null && decodedMarketId != null) {
      if (decodedMarketId !== expectedOnChainMarketId) {
        return {
          ok: false,
          error: `resolveTxHash targets marketId ${decodedMarketId}, expected ${expectedOnChainMarketId}`,
          blockNumber: receipt.blockNumber,
          txTo,
          decodedMethod,
          decodedMarketId,
          decodedOutcome,
        };
      }
    }

    // Validate decoded outcome only for binary yes/no expectations
    const normalizedExpectedOutcome = typeof expectedOutcome === 'string'
      ? expectedOutcome.trim().toLowerCase()
      : null;
    const shouldValidateOutcome = normalizedExpectedOutcome === 'yes' || normalizedExpectedOutcome === 'no';
    if (shouldValidateOutcome && decodedOutcome == null) {
      return {
        ok: false,
        error: 'resolveTxHash is missing decoded outcome',
        blockNumber: receipt.blockNumber,
        txTo,
        decodedMethod,
        decodedMarketId,
        decodedOutcome,
      };
    }
    if (shouldValidateOutcome && decodedOutcome != null) {
      const expectedBool = normalizedExpectedOutcome === 'yes';
      if (decodedOutcome !== expectedBool) {
        return {
          ok: false,
          error: `resolveTxHash outcome is ${decodedOutcome ? 'yes' : 'no'}, expected ${normalizedExpectedOutcome}`,
          blockNumber: receipt.blockNumber,
          txTo,
          decodedMethod,
          decodedMarketId,
          decodedOutcome,
        };
      }
    }

    return {
      ok: true,
      blockNumber: receipt.blockNumber,
      txTo,
      decodedMethod,
      decodedMarketId,
      decodedOutcome,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'resolveTxHash verification failed' };
  }
}

function toSafeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeExpectedOutcome(
  resolutionType: unknown,
  currentPrice: number | null,
  targetPrice: number | null,
): 'yes' | 'no' | null {
  if (currentPrice == null || targetPrice == null) return null;
  if (resolutionType === 'price_above') {
    return currentPrice >= targetPrice ? 'yes' : 'no';
  }
  // Align preview semantics with keeper and on-chain resolution behavior.
  if (resolutionType === 'price_below') {
    return currentPrice <= targetPrice ? 'yes' : 'no';
  }
  return null;
}

// IMPORTANT: Specific named routes MUST come before parameterized routes
// to avoid "resolved" being captured as a :marketId parameter.

// GET /api/settlement/resolved — list resolved/pending_resolution markets
router.get('/resolved', async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const { rows: markets } = await db.query(
      "SELECT m.*, mr.outcome, mr.resolved_price, mr.resolved_at FROM markets m LEFT JOIN market_resolution mr ON m.id = mr.market_id WHERE m.status IN ('resolved', 'pending_resolution') ORDER BY m.end_time DESC"
    );
    res.json({ markets });
  } catch (err: any) {
    console.error('Settlement resolved error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/settlement/:marketId/preview — pre-resolution verification snapshot
router.get('/:marketId/preview', async (req: Request, res: Response) => {
  try {
    const { marketId } = req.params;
    const db = getDb();
    const now = Date.now();

    const marketRes = await db.query(`
      SELECT
        m.id, m.title, m.status, m.end_time, m.market_type,
        mr.resolution_type, mr.oracle_pair, mr.target_price,
        mr.outcome, mr.resolved_price, mr.resolved_at, mr.resolved_by, mr.winning_option_id,
        mr.rule_text, mr.data_source_url, mr.resolution_time_utc, mr.resolve_tx_hash
      FROM markets m
      LEFT JOIN market_resolution mr ON m.id = mr.market_id
      WHERE m.id = $1
    `, [marketId]);

    if (marketRes.rows.length === 0) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    const row = marketRes.rows[0] as any;
    const latestProposalRes = await db.query(`
      SELECT
        rp.id, rp.status, rp.proposed_outcome, rp.proposed_winning_option_id,
        rp.proposed_by, rp.evidence_url, rp.evidence_hash, rp.source_url,
        rp.resolve_tx_hash, rp.challenge_window_ends_at, rp.created_at,
        COALESCE((
          SELECT COUNT(*)::int FROM resolution_challenges rc WHERE rc.proposal_id = rp.id
        ), 0) as challenge_count
      FROM resolution_proposals rp
      WHERE rp.market_id = $1
      ORDER BY rp.created_at DESC
      LIMIT 1
    `, [marketId]);
    const latestProposal = latestProposalRes.rows[0] || null;
    const ended = Number(row.end_time) <= now;
    const targetPrice = toSafeNumber(row.target_price);
    let currentPrice: number | null = null;
    let priceUpdatedAt: number | null = null;
    let priceSource: 'oracle' | 'dexscreener' | null = null;
    let priceError: string | null = null;

    const isOracleResolvedByRule =
      row.resolution_type === 'price_above' || row.resolution_type === 'price_below';

    if (isOracleResolvedByRule) {
      try {
        if (typeof row.oracle_pair === 'string' && SUPPORTED_PAIRS.includes(row.oracle_pair)) {
          const oracleData = await getOraclePrice(row.oracle_pair);
          currentPrice = oracleData.price;
          priceUpdatedAt = oracleData.updatedAt * 1000;
          priceSource = 'oracle';
        } else if (isTokenAddress(row.oracle_pair)) {
          const tokenPrice = await fetchTokenPrice(row.oracle_pair);
          currentPrice = tokenPrice.price;
          priceUpdatedAt = tokenPrice.fetchedAt;
          priceSource = 'dexscreener';
        } else {
          priceError = 'Unsupported oracle_pair for automatic verification';
        }
      } catch (err: any) {
        priceError = err?.message || 'Failed to fetch verification price';
      }
    }

    const expectedOutcome = computeExpectedOutcome(row.resolution_type, currentPrice, targetPrice);
    const canAutoResolveNow = Boolean(
      ended &&
      row.status === 'active' &&
      isOracleResolvedByRule &&
      expectedOutcome &&
      !priceError
    );

    res.json({
      marketId,
      market: {
        id: row.id,
        title: row.title,
        status: row.status,
        marketType: row.market_type || 'binary',
        endTime: Number(row.end_time),
        ended,
      },
      resolution: {
        type: row.resolution_type || 'manual',
        oraclePair: row.oracle_pair || null,
        targetPrice,
        currentPrice,
        priceSource,
        priceUpdatedAt,
        expectedOutcome,
        resolvedOutcome: row.outcome || null,
        resolvedPrice: toSafeNumber(row.resolved_price),
        resolvedAt: row.resolved_at ? Number(row.resolved_at) : null,
        resolvedBy: row.resolved_by || null,
        winningOptionId: row.winning_option_id || null,
        ruleText: row.rule_text || null,
        dataSourceUrl: row.data_source_url || null,
        resolutionTimeUtc: row.resolution_time_utc ? Number(row.resolution_time_utc) : null,
        resolveTxHash: row.resolve_tx_hash || null,
        priceError,
      },
      arbitration: latestProposal ? {
        latestProposalId: latestProposal.id,
        status: latestProposal.status,
        proposedOutcome: latestProposal.proposed_outcome || null,
        proposedWinningOptionId: latestProposal.proposed_winning_option_id || null,
        proposedBy: latestProposal.proposed_by || null,
        evidenceUrl: latestProposal.evidence_url || null,
        evidenceHash: latestProposal.evidence_hash || null,
        sourceUrl: latestProposal.source_url || null,
        resolveTxHash: latestProposal.resolve_tx_hash || null,
        challengeWindowEndsAt: Number(latestProposal.challenge_window_ends_at || 0),
        challengeCount: Number(latestProposal.challenge_count || 0),
        createdAt: Number(latestProposal.created_at || 0),
      } : null,
      canAutoResolveNow,
      generatedAt: now,
    });
  } catch (err: any) {
    console.error('Settlement preview error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/settlement/:marketId/proof — settlement reproducibility proof
router.get('/:marketId/proof', async (req: Request, res: Response) => {
  try {
    const { marketId } = req.params;
    const db = getDb();

    const [marketResult, resolutionResult] = await Promise.all([
      db.query('SELECT id, title, status, market_type, end_time, on_chain_market_id FROM markets WHERE id = $1', [marketId]),
      db.query('SELECT * FROM market_resolution WHERE market_id = $1', [marketId]),
    ]);

    if (marketResult.rows.length === 0) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    const market = marketResult.rows[0] as any;
    const resolution = resolutionResult.rows[0] || null;

    const [aggregateResult, netDepositResult, winnerLogs, loserLogs, resolveLogs, latestProposalRes, challengeSamplesRes] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE action = 'settle_winner') as winner_count,
          COALESCE(SUM(amount) FILTER (WHERE action = 'settle_winner'), 0) as winner_total,
          COUNT(*) FILTER (WHERE action = 'settle_loser') as loser_count,
          COALESCE(SUM(amount) FILTER (WHERE action = 'settle_loser'), 0) as loser_total,
          COUNT(*) FILTER (WHERE action = 'cancel_open_order') as cancelled_open_orders,
          COALESCE(SUM(amount) FILTER (WHERE action = 'cancel_open_order'), 0) as cancelled_open_orders_total,
          COUNT(*) FILTER (WHERE action = 'claimed') as claimed_count,
          COALESCE(SUM(amount) FILTER (WHERE action = 'claimed'), 0) as claimed_total
        FROM settlement_log
        WHERE market_id = $1
      `, [marketId]),
      db.query(`
        SELECT
          COALESCE(SUM(CASE WHEN type = 'buy' THEN amount ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN type = 'sell' THEN amount ELSE 0 END), 0) as net_deposits
        FROM orders
        WHERE market_id = $1 AND status = 'filled'
      `, [marketId]),
      db.query(`
        SELECT user_address, amount, details, created_at
        FROM settlement_log
        WHERE market_id = $1 AND action = 'settle_winner'
        ORDER BY amount DESC
        LIMIT 50
      `, [marketId]),
      db.query(`
        SELECT user_address, amount, details, created_at
        FROM settlement_log
        WHERE market_id = $1 AND action = 'settle_loser'
        ORDER BY amount DESC
        LIMIT 50
      `, [marketId]),
      db.query(`
        SELECT action, user_address, details, created_at
        FROM settlement_log
        WHERE market_id = $1 AND action IN ('resolve', 'manual_resolve', 'manual_finalize')
        ORDER BY created_at DESC
        LIMIT 10
      `, [marketId]),
      db.query(`
        SELECT
          rp.*,
          COALESCE((
            SELECT COUNT(*)::int FROM resolution_challenges rc WHERE rc.proposal_id = rp.id
          ), 0) as challenge_count
        FROM resolution_proposals rp
        WHERE rp.market_id = $1
        ORDER BY rp.created_at DESC
        LIMIT 1
      `, [marketId]),
      db.query(`
        SELECT id, proposal_id, challenger_address, reason, evidence_url, evidence_hash, created_at
        FROM resolution_challenges
        WHERE market_id = $1
        ORDER BY created_at DESC
        LIMIT 20
      `, [marketId]),
    ]);

    const agg = aggregateResult.rows[0] as any;
    const latestProposal = latestProposalRes.rows[0] as any | undefined;
    const netDeposits = Math.max(0, Number(netDepositResult.rows[0]?.net_deposits || 0));
    const winnerTotal = Number(agg.winner_total || 0);
    const settlementGap = Math.abs(netDeposits - winnerTotal);
    const epsilon = 0.01;
    const challengeCount = Number(latestProposal?.challenge_count || 0);
    const resolvedTxHash = (resolution?.resolve_tx_hash || latestProposal?.resolve_tx_hash || null) as string | null;
    const resolveTxVerification = resolvedTxHash
      ? await verifyResolveTxHashOnChain(String(resolvedTxHash).toLowerCase())
      : { ok: false, error: 'resolveTxHash missing' };
    const hasEvidence = Boolean(
      resolvedTxHash ||
      resolution?.evidence_url ||
      resolution?.evidence_hash ||
      latestProposal?.evidence_url ||
      latestProposal?.evidence_hash ||
      resolveLogs.rows.length > 0
    );

    const resolutionType = String(resolution?.resolution_type || 'manual').toLowerCase();
    const isManualResolution = resolutionType === 'manual';

    const checks = [
      {
        key: 'market_resolved',
        pass: market.status === 'resolved',
        message: market.status === 'resolved'
          ? 'Market status is resolved'
          : `Market status is ${market.status}, expected resolved`,
      },
      {
        key: 'resolution_outcome_present',
        pass: Boolean(resolution?.outcome),
        message: resolution?.outcome
          ? `Outcome recorded as "${resolution.outcome}"`
          : 'No outcome recorded in market_resolution',
      },
      {
        key: 'settlement_not_overpaid',
        pass: winnerTotal <= netDeposits + epsilon,
        message: `Winner payout ${winnerTotal.toFixed(6)} vs net deposits ${netDeposits.toFixed(6)}`,
      },
      {
        key: 'settlement_within_tolerance',
        pass: settlementGap <= epsilon || netDeposits === 0,
        message: `Absolute payout gap ${settlementGap.toFixed(6)} (epsilon ${epsilon})`,
      },
      {
        key: 'resolution_evidence_present',
        pass: isManualResolution ? hasEvidence : true,
        message: isManualResolution
          ? (hasEvidence
            ? 'Resolution contains on-chain hash or evidence reference'
            : 'No evidence URL/hash or resolve tx hash recorded')
          : 'Oracle path: evidence optional',
      },
      {
        key: 'resolve_tx_on_chain_verified',
        pass: isManualResolution ? resolveTxVerification.ok : true,
        message: isManualResolution
          ? (resolveTxVerification.ok
            ? `resolveTxHash is confirmed on-chain (block ${resolveTxVerification.blockNumber})`
            : `resolveTxHash verification failed: ${resolveTxVerification.error || 'unknown'}`)
          : 'Oracle path: no manual resolve tx required',
      },
      {
        key: 'arbitration_window_respected',
        pass: isManualResolution
          ? Boolean(
            latestProposal &&
            latestProposal.challenge_window_ends_at &&
            Number(latestProposal.finalized_at || 0) >= Number(latestProposal.challenge_window_ends_at),
          )
          : true,
        message: isManualResolution
          ? latestProposal
            ? `Finalized at ${Number(latestProposal.finalized_at || 0)}, challenge window ended at ${Number(latestProposal.challenge_window_ends_at || 0)}, challenges=${challengeCount}`
            : 'Manual resolution requires proposal + challenge window finalization'
          : 'Non-manual resolution path',
      },
    ];

    const mandatoryChecks = isManualResolution
      ? ['market_resolved', 'resolution_outcome_present', 'settlement_not_overpaid', 'resolution_evidence_present', 'resolve_tx_on_chain_verified', 'arbitration_window_respected']
      : ['market_resolved', 'resolution_outcome_present', 'settlement_not_overpaid', 'settlement_within_tolerance'];
    const overallPass = checks
      .filter(c => mandatoryChecks.includes(c.key))
      .every(c => c.pass);

    const summary = {
      winnerCount: Number(agg.winner_count || 0),
      loserCount: Number(agg.loser_count || 0),
      cancelledOpenOrders: Number(agg.cancelled_open_orders || 0),
      claimedCount: Number(agg.claimed_count || 0),
      winnerTotal,
      loserTotal: Number(agg.loser_total || 0),
      claimedTotal: Number(agg.claimed_total || 0),
      cancelledOpenOrdersTotal: Number(agg.cancelled_open_orders_total || 0),
      netDeposits,
      settlementGap,
      challengeCount,
    };

    const digestPayload = {
      marketId,
      onChainMarketId: market.on_chain_market_id != null ? String(market.on_chain_market_id) : null,
      status: market.status,
      resolutionType,
      outcome: resolution?.outcome || null,
      resolvedPrice: toSafeNumber(resolution?.resolved_price),
      resolveTxHash: resolvedTxHash,
      resolveTxVerification,
      challengeCount,
      summary,
      checks,
    };
    const proofDigest = createHash('sha256').update(JSON.stringify(digestPayload)).digest('hex');

    res.json({
      market: {
        id: market.id,
        title: market.title,
        status: market.status,
        marketType: market.market_type || 'binary',
        endTime: Number(market.end_time),
        onChainMarketId: market.on_chain_market_id != null ? String(market.on_chain_market_id) : null,
      },
      resolution,
      resolveTxVerification,
      summary,
      checks,
      overallPass,
      proofDigest,
      arbitration: latestProposal ? {
        proposalId: latestProposal.id,
        status: latestProposal.status,
        proposedBy: latestProposal.proposed_by,
        proposedOutcome: latestProposal.proposed_outcome,
        proposedWinningOptionId: latestProposal.proposed_winning_option_id,
        challengeWindowEndsAt: Number(latestProposal.challenge_window_ends_at || 0),
        challengeCount,
        sourceUrl: latestProposal.source_url || null,
        evidenceUrl: latestProposal.evidence_url || null,
        evidenceHash: latestProposal.evidence_hash || null,
        resolveTxHash: latestProposal.resolve_tx_hash || null,
        finalizedAt: latestProposal.finalized_at ? Number(latestProposal.finalized_at) : null,
        finalizedBy: latestProposal.finalized_by || null,
      } : null,
      logs: {
        resolveLogs: resolveLogs.rows,
        winnerSamples: winnerLogs.rows,
        loserSamples: loserLogs.rows,
        challengeSamples: challengeSamplesRes.rows,
      },
      generatedAt: Date.now(),
    });
  } catch (err: any) {
    console.error('Settlement proof error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/settlement/:marketId/propose — propose manual resolution with evidence
router.post('/:marketId/propose', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { marketId } = req.params;
  const userAddress = req.userAddress!;
  const {
    outcome,
    winningOptionId,
    evidenceUrl,
    evidenceHash,
    sourceUrl,
    notes,
    resolveTxHash,
    challengeWindowHours,
  } = req.body ?? {};
  const db = getDb();
  const now = Date.now();

  const parsedChallengeHours = Number(challengeWindowHours);
  const challengeWindowMs = Number.isFinite(parsedChallengeHours)
    ? Math.min(72, Math.max(1, Math.floor(parsedChallengeHours))) * 3600000
    : DEFAULT_CHALLENGE_WINDOW_MS;
  const challengeWindowEndsAt = now + challengeWindowMs;

  const normalizedEvidenceUrl = normalizeOptionalHttpUrl(evidenceUrl);
  const normalizedSourceUrl = normalizeOptionalHttpUrl(sourceUrl);
  const normalizedEvidenceHash = normalizeOptionalText(evidenceHash, 256);
  const normalizedNotes = normalizeOptionalText(notes, 5000);
  const normalizedResolveTxHash = typeof resolveTxHash === 'string' ? resolveTxHash.trim().toLowerCase() : '';

  if (isInvalidOptionalHttpUrl(evidenceUrl, normalizedEvidenceUrl) || isInvalidOptionalHttpUrl(sourceUrl, normalizedSourceUrl)) {
    res.status(400).json({ error: 'evidenceUrl/sourceUrl must be valid http/https URLs' });
    return;
  }
  if (normalizedResolveTxHash && !isTxHash(normalizedResolveTxHash)) {
    res.status(400).json({ error: 'resolveTxHash must be a valid transaction hash' });
    return;
  }
  if (!normalizedEvidenceUrl && !normalizedEvidenceHash && !normalizedResolveTxHash) {
    res.status(400).json({ error: 'Provide at least one evidence field: evidenceUrl, evidenceHash, or resolveTxHash' });
    return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const marketRes = await client.query(
      'SELECT id, market_type, status, end_time, on_chain_market_id FROM markets WHERE id = $1 FOR UPDATE',
      [marketId],
    );
    const market = marketRes.rows[0] as any;
    if (!market) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Market not found' });
      return;
    }
    if (market.status === 'resolved') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Market already resolved' });
      return;
    }
    if (Number(market.end_time) > now) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Market has not ended yet' });
      return;
    }
    if (market.on_chain_market_id == null) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Market is not linked to on-chain market id' });
      return;
    }
    if (market.market_type === 'multi') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: '当前版本仲裁结算仅支持二元市场（YES/NO）' });
      return;
    }

    const creatorRes = await client.query(
      'SELECT creator_address FROM user_created_markets WHERE market_id = $1',
      [marketId],
    );
    const creatorAddress = (creatorRes.rows[0]?.creator_address || '').toLowerCase();
    const canPropose = isAdminAddress(userAddress) || creatorAddress === userAddress.toLowerCase();
    if (!canPropose) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'Only market creator or admin can propose resolution' });
      return;
    }

    const openProposalRes = await client.query(
      "SELECT id FROM resolution_proposals WHERE market_id = $1 AND status IN ('proposed', 'challenged') LIMIT 1 FOR UPDATE",
      [marketId],
    );
    if (openProposalRes.rows.length > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'There is already an active proposal for this market' });
      return;
    }

    let proposedOutcome: string | null = null;
    let proposedWinningOptionId: string | null = null;
    if (market.market_type === 'multi') {
      if (typeof winningOptionId !== 'string' || !winningOptionId.trim()) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'winningOptionId is required for multi-option markets' });
        return;
      }
      const winOptRes = await client.query(
        'SELECT id, label FROM market_options WHERE id = $1 AND market_id = $2',
        [winningOptionId, marketId],
      );
      if (winOptRes.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Invalid winningOptionId for this market' });
        return;
      }
      proposedWinningOptionId = String(winOptRes.rows[0].id);
      proposedOutcome = String(winOptRes.rows[0].label);
    } else {
      if (outcome !== 'yes' && outcome !== 'no') {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'outcome must be "yes" or "no"' });
        return;
      }
      proposedOutcome = outcome;
    }

    // Verify resolveTxHash on-chain with decoded calldata (market context now available)
    if (normalizedResolveTxHash) {
      const verification = await verifyResolveTxHashOnChain(
        normalizedResolveTxHash,
        market.on_chain_market_id != null ? String(market.on_chain_market_id) : null,
        proposedOutcome,
      );
      if (!verification.ok) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: verification.error || 'resolveTxHash verification failed' });
        return;
      }
    }

    if (market.status === 'active') {
      await client.query("UPDATE markets SET status = 'pending_resolution' WHERE id = $1", [marketId]);
    }

    const proposalId = randomUUID();
    await client.query(`
      INSERT INTO resolution_proposals (
        id, market_id, proposed_by, proposed_outcome, proposed_winning_option_id, notes,
        evidence_url, evidence_hash, source_url, resolve_tx_hash, status, challenge_window_ends_at, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'proposed', $11, $12)
    `, [
      proposalId,
      marketId,
      userAddress,
      proposedOutcome,
      proposedWinningOptionId,
      normalizedNotes,
      normalizedEvidenceUrl,
      normalizedEvidenceHash,
      normalizedSourceUrl,
      normalizedResolveTxHash || null,
      challengeWindowEndsAt,
      now,
    ]);

    await client.query(`
      INSERT INTO market_resolution (
        market_id, proposed_outcome, proposed_winning_option_id, proposed_at, proposer_address,
        evidence_url, evidence_hash, resolve_tx_hash, challenge_window_ends_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (market_id) DO UPDATE SET
        proposed_outcome = EXCLUDED.proposed_outcome,
        proposed_winning_option_id = EXCLUDED.proposed_winning_option_id,
        proposed_at = EXCLUDED.proposed_at,
        proposer_address = EXCLUDED.proposer_address,
        evidence_url = EXCLUDED.evidence_url,
        evidence_hash = EXCLUDED.evidence_hash,
        resolve_tx_hash = EXCLUDED.resolve_tx_hash,
        challenge_window_ends_at = EXCLUDED.challenge_window_ends_at
    `, [
      marketId,
      proposedOutcome,
      proposedWinningOptionId,
      now,
      userAddress,
      normalizedEvidenceUrl,
      normalizedEvidenceHash,
      normalizedResolveTxHash || null,
      challengeWindowEndsAt,
    ]);

    await client.query(`
      INSERT INTO settlement_log (id, market_id, action, user_address, details, created_at)
      VALUES ($1, $2, 'proposal_created', $3, $4, $5)
    `, [
      randomUUID(),
      marketId,
      userAddress,
      JSON.stringify({
        proposalId,
        proposedOutcome,
        proposedWinningOptionId,
        challengeWindowEndsAt,
        evidenceUrl: normalizedEvidenceUrl,
        evidenceHash: normalizedEvidenceHash,
        sourceUrl: normalizedSourceUrl,
        resolveTxHash: normalizedResolveTxHash || null,
      }),
      now,
    ]);

    await client.query('COMMIT');
    res.json({
      success: true,
      proposal: {
        id: proposalId,
        marketId,
        proposedBy: userAddress,
        proposedOutcome,
        proposedWinningOptionId,
        challengeWindowEndsAt,
        status: 'proposed',
      },
    });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Settlement proposal error:', err);
    res.status(500).json({ error: 'Failed to create settlement proposal' });
  } finally {
    client.release();
  }
});

// POST /api/settlement/:marketId/challenge — challenge active proposal
router.post('/:marketId/challenge', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { marketId } = req.params;
  const userAddress = req.userAddress!;
  const { proposalId, reason, evidenceUrl, evidenceHash } = req.body ?? {};
  const db = getDb();
  const now = Date.now();

  const normalizedReason = normalizeOptionalText(reason, 5000);
  const normalizedEvidenceUrl = normalizeOptionalHttpUrl(evidenceUrl);
  const normalizedEvidenceHash = normalizeOptionalText(evidenceHash, 256);

  if (isInvalidOptionalHttpUrl(evidenceUrl, normalizedEvidenceUrl)) {
    res.status(400).json({ error: 'evidenceUrl must be a valid http/https URL' });
    return;
  }
  if (!normalizedReason || normalizedReason.length < 10) {
    res.status(400).json({ error: 'Challenge reason must be at least 10 characters' });
    return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const proposalRes = await client.query(`
      SELECT *
      FROM resolution_proposals
      WHERE market_id = $1
        AND status IN ('proposed', 'challenged')
        AND ($2::text IS NULL OR id = $2)
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `, [marketId, proposalId ?? null]);
    const proposal = proposalRes.rows[0] as any;
    if (!proposal) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'No active proposal found for this market' });
      return;
    }
    if (String(proposal.proposed_by || '').toLowerCase() === userAddress.toLowerCase()) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Proposer cannot challenge their own proposal' });
      return;
    }
    if (Number(proposal.challenge_window_ends_at) <= now) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Challenge window has already closed' });
      return;
    }

    const challengeRowsRes = await client.query(
      'SELECT id FROM resolution_challenges WHERE proposal_id = $1 FOR UPDATE',
      [proposal.id],
    );
    const challengeCount = challengeRowsRes.rows.length;
    if (challengeCount >= MAX_CHALLENGES_PER_PROPOSAL) {
      await client.query('ROLLBACK');
      res.status(409).json({
        error: `Maximum challenges reached for this proposal (${MAX_CHALLENGES_PER_PROPOSAL})`,
      });
      return;
    }

    // Check for duplicate challenge from same address on same proposal
    const existingChallengeRes = await client.query(
      `SELECT id FROM resolution_challenges WHERE proposal_id = $1 AND LOWER(challenger_address) = LOWER($2) LIMIT 1`,
      [proposal.id, userAddress],
    );
    if (existingChallengeRes.rows.length > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'You have already challenged this proposal' });
      return;
    }

    const challengeId = randomUUID();
    await client.query(`
      INSERT INTO resolution_challenges (
        id, market_id, proposal_id, challenger_address, reason, evidence_url, evidence_hash, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [challengeId, marketId, proposal.id, userAddress, normalizedReason, normalizedEvidenceUrl, normalizedEvidenceHash, now]);

    const extendedChallengeWindowEndsAt = Math.max(
      Number(proposal.challenge_window_ends_at || 0),
      now + DEFAULT_CHALLENGE_WINDOW_MS,
    );
    await client.query(
      "UPDATE resolution_proposals SET status = 'challenged', challenge_window_ends_at = $2 WHERE id = $1",
      [proposal.id, extendedChallengeWindowEndsAt],
    );
    await client.query(
      `UPDATE market_resolution
       SET challenge_window_ends_at = GREATEST(COALESCE(challenge_window_ends_at, 0), $2)
       WHERE market_id = $1`,
      [marketId, extendedChallengeWindowEndsAt],
    );

    await client.query(`
      INSERT INTO settlement_log (id, market_id, action, user_address, details, created_at)
      VALUES ($1, $2, 'proposal_challenged', $3, $4, $5)
    `, [
      randomUUID(),
      marketId,
      userAddress,
      JSON.stringify({
        challengeId,
        proposalId: proposal.id,
        challengeCount: challengeCount + 1,
        maxChallenges: MAX_CHALLENGES_PER_PROPOSAL,
        challengeWindowEndsAt: extendedChallengeWindowEndsAt,
        reason: normalizedReason,
        evidenceUrl: normalizedEvidenceUrl,
        evidenceHash: normalizedEvidenceHash,
      }),
      now,
    ]);

    await client.query('COMMIT');
    res.json({
      success: true,
      challenge: {
        id: challengeId,
        proposalId: proposal.id,
        marketId,
        challenger: userAddress,
        createdAt: now,
      },
    });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Settlement challenge error:', err);
    res.status(500).json({ error: 'Failed to challenge proposal' });
  } finally {
    client.release();
  }
});

// POST /api/settlement/:marketId/finalize — finalize market from proposal (admin)
router.post('/:marketId/finalize', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  const marketId = req.params.marketId as string;
  const userAddress = req.userAddress!;
  const {
    proposalId,
    outcome,
    winningOptionId,
    evidenceUrl,
    evidenceHash,
    resolveTxHash,
    notes,
  } = req.body ?? {};
  const db = getDb();
  const now = Date.now();

  const normalizedEvidenceUrl = normalizeOptionalHttpUrl(evidenceUrl);
  const normalizedEvidenceHash = normalizeOptionalText(evidenceHash, 256);
  const normalizedNotes = normalizeOptionalText(notes, 5000);
  const normalizedResolveTxHash = typeof resolveTxHash === 'string' ? resolveTxHash.trim().toLowerCase() : '';
  if (isInvalidOptionalHttpUrl(evidenceUrl, normalizedEvidenceUrl)) {
    res.status(400).json({ error: 'evidenceUrl must be a valid http/https URL' });
    return;
  }
  if (!normalizedResolveTxHash || !isTxHash(normalizedResolveTxHash)) {
    res.status(400).json({ error: 'resolveTxHash is required and must be a valid transaction hash' });
    return;
  }

  const client = await db.connect();
  let committed = false;
  let resolvedOutcome: string | null = null;
  let resolveTxVerification: Awaited<ReturnType<typeof verifyResolveTxHashOnChain>> | null = null;
  try {
    await client.query('BEGIN');
    const marketResult = await client.query(
      'SELECT id, status, market_type, on_chain_market_id FROM markets WHERE id = $1 FOR UPDATE',
      [marketId],
    );
    const market = marketResult.rows[0] as any;
    if (!market) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Market not found' });
      return;
    }
    if (market.status === 'resolved') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Market already resolved' });
      return;
    }
    if (market.on_chain_market_id == null) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Market is not linked to on-chain market id' });
      return;
    }
    if (market.market_type === 'multi') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: '当前版本仲裁结算仅支持二元市场（YES/NO）' });
      return;
    }

    const proposalRes = await client.query(`
      SELECT * FROM resolution_proposals
      WHERE market_id = $1
        AND status IN ('proposed', 'challenged')
        AND ($2::text IS NULL OR id = $2)
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `, [marketId, proposalId ?? null]);
    const proposal = proposalRes.rows[0] as any | undefined;

    if (!proposal) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'No active proposal found. Use /propose before /finalize.' });
      return;
    }

    if (Number(proposal.challenge_window_ends_at) > now) {
      await client.query('ROLLBACK');
      res.status(409).json({
        error: 'Challenge window not closed yet',
        challengeWindowEndsAt: Number(proposal.challenge_window_ends_at),
      });
      return;
    }

    let resolvedWinningOptionId: string | null = null;
    let winningSide: string | null = null;
    if (market.market_type === 'multi') {
      const optionId = (typeof winningOptionId === 'string' && winningOptionId.trim())
        ? winningOptionId
        : proposal?.proposed_winning_option_id;
      if (!optionId) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'winningOptionId is required for multi-option markets' });
        return;
      }
      const winOpt = await client.query(
        'SELECT id, option_index, label FROM market_options WHERE id = $1 AND market_id = $2',
        [optionId, marketId],
      );
      if (winOpt.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Invalid winningOptionId for this market' });
        return;
      }
      resolvedWinningOptionId = String(winOpt.rows[0].id);
      winningSide = `option_${winOpt.rows[0].option_index}`;
      resolvedOutcome = String(winOpt.rows[0].label);
    } else {
      const normalizedOutcome = outcome === 'yes' || outcome === 'no'
        ? outcome
        : proposal?.proposed_outcome;
      if (normalizedOutcome !== 'yes' && normalizedOutcome !== 'no') {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'outcome must be "yes" or "no"' });
        return;
      }
      resolvedOutcome = normalizedOutcome;
      winningSide = normalizedOutcome;
    }

    // Verify resolveTxHash on-chain with decoded calldata and expected binary outcome
    resolveTxVerification = await verifyResolveTxHashOnChain(
      normalizedResolveTxHash,
      market.on_chain_market_id != null ? String(market.on_chain_market_id) : null,
      market.market_type === 'multi' ? null : resolvedOutcome,
    );
    if (!resolveTxVerification.ok) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: resolveTxVerification.error || 'resolveTxHash verification failed' });
      return;
    }
    if (resolveTxVerification.decodedMethod !== 'finalizeResolution') {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'finalize requires a finalizeResolution tx hash' });
      return;
    }

    await client.query("UPDATE markets SET status = 'resolved' WHERE id = $1", [marketId]);

    await client.query(`
      INSERT INTO market_resolution (
        market_id, resolution_type, outcome, resolved_at, resolved_by, winning_option_id,
        evidence_url, evidence_hash, resolve_tx_hash, proposer_address, proposed_outcome,
        proposed_winning_option_id, proposed_at, challenge_window_ends_at
      )
      VALUES ($1, 'manual', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (market_id) DO UPDATE SET
        outcome = EXCLUDED.outcome,
        resolved_at = EXCLUDED.resolved_at,
        resolved_by = EXCLUDED.resolved_by,
        winning_option_id = EXCLUDED.winning_option_id,
        evidence_url = COALESCE(EXCLUDED.evidence_url, market_resolution.evidence_url),
        evidence_hash = COALESCE(EXCLUDED.evidence_hash, market_resolution.evidence_hash),
        resolve_tx_hash = COALESCE(EXCLUDED.resolve_tx_hash, market_resolution.resolve_tx_hash),
        proposer_address = COALESCE(EXCLUDED.proposer_address, market_resolution.proposer_address),
        proposed_outcome = COALESCE(EXCLUDED.proposed_outcome, market_resolution.proposed_outcome),
        proposed_winning_option_id = COALESCE(EXCLUDED.proposed_winning_option_id, market_resolution.proposed_winning_option_id),
        proposed_at = COALESCE(EXCLUDED.proposed_at, market_resolution.proposed_at),
        challenge_window_ends_at = COALESCE(EXCLUDED.challenge_window_ends_at, market_resolution.challenge_window_ends_at)
    `, [
      marketId,
      resolvedOutcome,
      now,
      userAddress,
      resolvedWinningOptionId,
      normalizedEvidenceUrl ?? proposal?.evidence_url ?? null,
      normalizedEvidenceHash ?? proposal?.evidence_hash ?? null,
      normalizedResolveTxHash || proposal?.resolve_tx_hash || null,
      proposal?.proposed_by || null,
      proposal?.proposed_outcome || null,
      proposal?.proposed_winning_option_id || null,
      proposal?.created_at || null,
      proposal.challenge_window_ends_at || null,
    ]);

    await settleMarketPositions(client, marketId, winningSide!);

    await client.query(`
      UPDATE resolution_proposals
      SET status = 'finalized', finalized_at = $1, finalized_by = $2
      WHERE id = $3
    `, [now, userAddress, proposal.id]);

    await client.query(`
      INSERT INTO settlement_log (id, market_id, action, user_address, details, created_at)
      VALUES ($1, $2, 'manual_finalize', $3, $4, $5)
    `, [
      randomUUID(),
      marketId,
      userAddress,
      JSON.stringify({
        proposalId: proposal.id,
        outcome: resolvedOutcome,
        winningOptionId: resolvedWinningOptionId,
        resolveTxHash: normalizedResolveTxHash || proposal.resolve_tx_hash || null,
        resolveTxBlockNumber: resolveTxVerification?.blockNumber || null,
        evidenceUrl: normalizedEvidenceUrl ?? proposal.evidence_url ?? null,
        evidenceHash: normalizedEvidenceHash ?? proposal.evidence_hash ?? null,
        notes: normalizedNotes,
      }),
      now,
    ]);

    await client.query('COMMIT');
    committed = true;
    res.json({
      success: true,
      marketId,
      outcome: resolvedOutcome,
      proposalId: proposal.id,
      resolveTxHash: normalizedResolveTxHash,
      resolveTxBlockNumber: resolveTxVerification?.blockNumber || null,
    });
  } catch (err: any) {
    if (!committed) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error('Settlement finalize error:', err);
    if (!committed) {
      res.status(500).json({ error: 'Failed to finalize settlement' });
    }
  } finally {
    client.release();
  }

  if (committed && resolvedOutcome) {
    try { broadcastMarketResolved(marketId, resolvedOutcome); } catch {}
    try { await resolvePredictions(db, marketId, resolvedOutcome); } catch (err: any) {
      console.error(`Failed to resolve predictions for ${marketId}:`, err.message);
    }
  }
});

// GET /api/settlement/:marketId — get settlement info (no auth required)
router.get('/:marketId', async (req: Request, res: Response) => {
  try {
    const { marketId } = req.params;
    const db = getDb();

    const [resolutionResult, logsResult, proposalsResult, challengesResult] = await Promise.all([
      db.query('SELECT * FROM market_resolution WHERE market_id = $1', [marketId]),
      db.query('SELECT * FROM settlement_log WHERE market_id = $1 ORDER BY created_at DESC', [marketId]),
      db.query(`
        SELECT
          rp.*,
          COALESCE((
            SELECT COUNT(*)::int FROM resolution_challenges rc WHERE rc.proposal_id = rp.id
          ), 0) as challenge_count
        FROM resolution_proposals rp
        WHERE rp.market_id = $1
        ORDER BY rp.created_at DESC
        LIMIT 20
      `, [marketId]),
      db.query(`
        SELECT rc.*
        FROM resolution_challenges rc
        WHERE rc.market_id = $1
        ORDER BY rc.created_at DESC
        LIMIT 50
      `, [marketId]),
    ]);

    res.json({
      resolution: resolutionResult.rows[0] || null,
      logs: logsResult.rows,
      proposals: proposalsResult.rows,
      challenges: challengesResult.rows,
    });
  } catch (err: any) {
    console.error('Settlement info error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/settlement/:marketId/resolve — admin manual resolution (auth + admin required)
router.post('/:marketId/resolve', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  const allowLegacyResolve = process.env.ALLOW_LEGACY_RESOLVE === '1';
  if (!allowLegacyResolve) {
    res.status(410).json({
      error: 'Legacy /resolve is disabled. Use /propose then /finalize to preserve arbitration.',
    });
    return;
  }

  const marketId = req.params.marketId as string;
  const { outcome, winningOptionId, evidenceUrl, evidenceHash, resolveTxHash, notes } = req.body ?? {};
  const userAddress = req.userAddress!;
  const db = getDb();
  const normalizedEvidenceUrl = normalizeOptionalHttpUrl(evidenceUrl);
  const normalizedEvidenceHash = normalizeOptionalText(evidenceHash, 256);
  const normalizedNotes = normalizeOptionalText(notes, 5000);
  const normalizedResolveTxHash = typeof resolveTxHash === 'string' ? resolveTxHash.trim().toLowerCase() : '';

  if (isInvalidOptionalHttpUrl(evidenceUrl, normalizedEvidenceUrl)) {
    res.status(400).json({ error: 'evidenceUrl must be a valid http/https URL' });
    return;
  }
  if (!normalizedResolveTxHash || !isTxHash(normalizedResolveTxHash)) {
    res.status(400).json({ error: 'resolveTxHash is required and must be a valid transaction hash' });
    return;
  }

  // Check if this is a multi-option market
  const marketCheck = await db.query('SELECT market_type FROM markets WHERE id = $1', [marketId]);
  const isMulti = marketCheck.rows[0]?.market_type === 'multi';

  if (isMulti) {
    if (!winningOptionId) {
      res.status(400).json({ error: 'winningOptionId is required for multi-option markets' });
      return;
    }
  } else {
    if (!outcome || (outcome !== 'yes' && outcome !== 'no')) {
      res.status(400).json({ error: 'outcome must be "yes" or "no"' });
      return;
    }
  }

  const now = Date.now();

  const client = await db.connect();
  let committed = false;
  let resolveTxVerification: Awaited<ReturnType<typeof verifyResolveTxHashOnChain>> | null = null;
  try {
    await client.query('BEGIN');
    const marketResult = await client.query(
      'SELECT id, status, on_chain_market_id FROM markets WHERE id = $1 FOR UPDATE',
      [marketId]
    );
    const market = marketResult.rows[0] as any;
    if (!market) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    if (market.status !== 'pending_resolution') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: `Market status is "${market.status}", expected "pending_resolution"` });
      return;
    }
    if (market.on_chain_market_id == null) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Market is not linked to on-chain market id' });
      return;
    }

    // Verify resolveTxHash on-chain with decoded calldata (market context now available)
    resolveTxVerification = await verifyResolveTxHashOnChain(
      normalizedResolveTxHash,
      market.on_chain_market_id != null ? String(market.on_chain_market_id) : null,
      isMulti ? null : outcome, // pass expected outcome for binary markets
    );
    if (!resolveTxVerification.ok) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: resolveTxVerification.error || 'resolveTxHash verification failed' });
      return;
    }

    // Block /resolve if there is an active arbitration proposal
    const activeProposalRes = await client.query(
      "SELECT id FROM resolution_proposals WHERE market_id = $1 AND status IN ('proposed', 'challenged') LIMIT 1",
      [marketId],
    );
    if (activeProposalRes.rows.length > 0) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'Cannot bypass active arbitration proposal. Use /finalize instead.' });
      return;
    }

    await client.query("UPDATE markets SET status = 'resolved' WHERE id = $1", [marketId]);

    if (isMulti && winningOptionId) {
      // Multi-option market resolution
      // Look up the winning option first to get label and side string
      const winOpt = await client.query('SELECT option_index, label FROM market_options WHERE id = $1', [winningOptionId]);
      const winSide = winOpt.rows[0] ? `option_${winOpt.rows[0].option_index}` : winningOptionId;
      const outcomeLabel = winOpt.rows[0]?.label || winningOptionId;

      const existingResult = await client.query('SELECT * FROM market_resolution WHERE market_id = $1', [marketId]);
      if (existingResult.rows.length > 0) {
        await client.query(`
          UPDATE market_resolution
          SET outcome = $1, resolved_at = $2, resolved_by = $3, winning_option_id = $4,
              evidence_url = $5, evidence_hash = $6, resolve_tx_hash = $7
          WHERE market_id = $8
        `, [outcomeLabel, now, userAddress, winningOptionId, normalizedEvidenceUrl, normalizedEvidenceHash, normalizedResolveTxHash || null, marketId]);
      } else {
        await client.query(`
          INSERT INTO market_resolution (
            market_id, resolution_type, outcome, resolved_at, resolved_by, winning_option_id, evidence_url, evidence_hash, resolve_tx_hash
          )
          VALUES ($1, 'manual', $2, $3, $4, $5, $6, $7, $8)
        `, [marketId, outcomeLabel, now, userAddress, winningOptionId, normalizedEvidenceUrl, normalizedEvidenceHash, normalizedResolveTxHash || null]);
      }

      // Reuse settleMarketPositions to handle open_orders cancellation,
      // position settlement, reserves zeroing, and position cleanup.
      await settleMarketPositions(client, marketId, winSide);

      await client.query(`
        INSERT INTO settlement_log (id, market_id, action, user_address, details, created_at)
        VALUES ($1, $2, 'manual_resolve', $3, $4, $5)
      `, [randomUUID(), marketId, userAddress, JSON.stringify({
        winningOptionId,
        evidenceUrl: normalizedEvidenceUrl,
        evidenceHash: normalizedEvidenceHash,
        resolveTxHash: normalizedResolveTxHash || null,
        resolveTxBlockNumber: resolveTxVerification?.blockNumber || null,
        notes: normalizedNotes,
      }), now]);
    } else {
      // Binary market resolution (unchanged)
      const existingResult = await client.query('SELECT * FROM market_resolution WHERE market_id = $1', [marketId]);
      if (existingResult.rows.length > 0) {
        await client.query(`
          UPDATE market_resolution
          SET outcome = $1, resolved_at = $2, resolved_by = $3,
              evidence_url = $4, evidence_hash = $5, resolve_tx_hash = $6
          WHERE market_id = $7
        `, [outcome, now, userAddress, normalizedEvidenceUrl, normalizedEvidenceHash, normalizedResolveTxHash || null, marketId]);
      } else {
        await client.query(`
          INSERT INTO market_resolution (
            market_id, resolution_type, outcome, resolved_at, resolved_by, evidence_url, evidence_hash, resolve_tx_hash
          )
          VALUES ($1, 'manual', $2, $3, $4, $5, $6, $7)
        `, [marketId, outcome, now, userAddress, normalizedEvidenceUrl, normalizedEvidenceHash, normalizedResolveTxHash || null]);
      }

      await settleMarketPositions(client, marketId, outcome);

      await client.query(`
        INSERT INTO settlement_log (id, market_id, action, user_address, details, created_at)
        VALUES ($1, $2, 'manual_resolve', $3, $4, $5)
      `, [randomUUID(), marketId, userAddress, JSON.stringify({
        outcome,
        evidenceUrl: normalizedEvidenceUrl,
        evidenceHash: normalizedEvidenceHash,
        resolveTxHash: normalizedResolveTxHash || null,
        resolveTxBlockNumber: resolveTxVerification?.blockNumber || null,
        notes: normalizedNotes,
      }), now]);
    }

    await client.query(`
      UPDATE resolution_proposals
      SET status = 'finalized', finalized_at = $1, finalized_by = $2
      WHERE market_id = $3 AND status IN ('proposed', 'challenged')
    `, [now, userAddress, marketId]);

    await client.query('COMMIT');
    const resolvedOutcome = isMulti ? (winningOptionId || outcome) : outcome;
    committed = true;
    res.json({ success: true, outcome: resolvedOutcome, marketId });
  } catch (txErr) {
    if (!committed) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error('Settlement resolve error:', txErr);
    if (!committed) {
      res.status(500).json({ error: 'Failed to resolve market' });
    }
  } finally {
    client.release();
  }

  // Post-commit: broadcast WS event and resolve agent predictions (outside try-catch)
  if (committed) {
    const resolvedOutcome = isMulti ? (winningOptionId || outcome) : outcome;
    try { broadcastMarketResolved(marketId, resolvedOutcome); } catch {}
    try { await resolvePredictions(db, marketId, resolvedOutcome); } catch (err: any) {
      console.error(`Failed to resolve predictions for ${marketId}:`, err.message);
    }
  }
});

// POST /api/settlement/:marketId/claim — user claims reward (auth required)
// Bug C6 Fix: The keeper's settleMarketPositions() already pays all winners automatically.
// This claim endpoint primarily serves as confirmation / idempotent retrieval.
// It only pays out if the user was somehow missed during automatic settlement (edge case).
router.post('/:marketId/claim', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { marketId } = req.params;
  const userAddress = req.userAddress!;
  const db = getDb();

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const marketResult = await client.query(
      'SELECT id, status FROM markets WHERE id = $1 FOR SHARE',
      [marketId]
    );
    const market = marketResult.rows[0] as any;
    if (!market) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Market not found' });
      return;
    }
    if (market.status !== 'resolved') {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Market is not resolved yet' });
      return;
    }

    const resolutionResult = await client.query(
      'SELECT outcome FROM market_resolution WHERE market_id = $1 FOR SHARE',
      [marketId]
    );
    const resolution = resolutionResult.rows[0] as any;
    if (!resolution || !resolution.outcome) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'No resolution found' });
      return;
    }

    // Serialize claims per (market, user) to enforce idempotency under concurrency.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [marketId, userAddress.toLowerCase()]);

    // Use FOR UPDATE to prevent race conditions on concurrent claim requests
    const settleLogResult = await client.query(
      "SELECT * FROM settlement_log WHERE market_id = $1 AND user_address = $2 AND action = 'settle_winner' FOR UPDATE",
      [marketId, userAddress]
    );
    const settleLog = settleLogResult.rows[0] as any;

    if (settleLog) {
      // Already settled by keeper/admin during resolution — return the amount (no additional payout)
      await client.query('COMMIT');
      res.json({ success: true, amount: settleLog.amount, marketId, source: 'auto_settled' });
      return;
    }

    // Check if already claimed via this endpoint (with FOR UPDATE to prevent race)
    const alreadyClaimedResult = await client.query(
      "SELECT * FROM settlement_log WHERE market_id = $1 AND user_address = $2 AND action = 'claimed' FOR UPDATE",
      [marketId, userAddress]
    );
    if (alreadyClaimedResult.rows.length > 0) {
      await client.query('COMMIT');
      res.json({ success: true, amount: alreadyClaimedResult.rows[0].amount, marketId, source: 'already_claimed' });
      return;
    }

    // Edge case: User had a winning position but was not settled automatically.
    // For multi-option markets, outcome is a label (e.g., "BTC"), not side format.
    // Look up winning_option_id to find the correct side.
    let winningSideForClaim = resolution.outcome;
    const resolutionFull = await client.query(
      'SELECT winning_option_id FROM market_resolution WHERE market_id = $1',
      [marketId]
    );
    if (resolutionFull.rows[0]?.winning_option_id) {
      const winOpt = await client.query(
        'SELECT option_index FROM market_options WHERE id = $1',
        [resolutionFull.rows[0].winning_option_id]
      );
      if (winOpt.rows[0]) {
        winningSideForClaim = `option_${winOpt.rows[0].option_index}`;
      }
    }

    const positionResult = await client.query(
      'SELECT * FROM positions WHERE market_id = $1 AND user_address = $2 AND side = $3 FOR UPDATE',
      [marketId, userAddress, winningSideForClaim]
    );
    const position = positionResult.rows[0] as any;
    if (!position || Number(position.shares) <= 0) {
      await client.query('COMMIT');
      res.status(400).json({ error: 'No winning position found' });
      return;
    }

    // Bug D28 Fix: Check if ANY settlement has already happened for this market.
    // If keeper already settled some winners, calculating a new payout from remaining
    // positions would be incorrect (the loser pool was already distributed).
    const existingSettlements = await client.query(
      "SELECT COUNT(*) as cnt FROM settlement_log WHERE market_id = $1 AND action IN ('settle_winner', 'settle_loser')",
      [marketId]
    );
    if (parseInt(existingSettlements.rows[0].cnt, 10) > 0) {
      // Keeper already ran settlement -- check if this user was already paid
      const alreadyPaidResult = await client.query(
        "SELECT COALESCE(SUM(amount), 0) as paid FROM settlement_log WHERE market_id = $1 AND user_address = $2 AND action = 'settle_winner'",
        [marketId, userAddress]
      );
      const alreadyPaid = Number(alreadyPaidResult.rows[0].paid);
      if (alreadyPaid > 0) {
        // User was already settled by keeper
        await client.query('COMMIT');
        res.json({ success: true, amount: alreadyPaid, marketId, source: 'already_settled_by_keeper' });
        return;
      }
      // Keeper settled others but not this user -- pay principal as safe fallback
      // rather than risk incorrect proportional calculation from partially-remaining positions.
      const safePayout = Number(position.shares) * Number(position.avg_cost);
      await client.query(
        `INSERT INTO balances (user_address, available, locked) VALUES ($2, $1, 0)
         ON CONFLICT (user_address) DO UPDATE SET available = balances.available + $1`,
        [safePayout, userAddress]
      );
      await client.query(`
        INSERT INTO settlement_log (id, market_id, action, user_address, amount, details, created_at)
        VALUES ($1, $2, 'claimed', $3, $4, $5, $6)
      `, [randomUUID(), marketId, userAddress, safePayout, JSON.stringify({
        side: resolution.outcome, shares: Number(position.shares), principal: safePayout, bonus: 0, note: 'partial_settlement_fallback'
      }), Date.now()]);
      await client.query('DELETE FROM positions WHERE id = $1', [position.id]);
      await client.query('COMMIT');
      res.json({ success: true, amount: safePayout, marketId, source: 'claimed' });
      return;
    }

    // Bug SETTLE-1 Fix: Calculate net deposits from filled orders instead of
    // shares * avg_cost to prevent overpayment when users sold at profit.
    const winningSide = winningSideForClaim;
    const allPositions = await client.query('SELECT * FROM positions WHERE market_id = $1 FOR UPDATE', [marketId]);
    const winners = allPositions.rows.filter((p: any) => p.side === winningSide);

    const totalWinnerShares = winners.reduce((sum: number, p: any) => sum + Number(p.shares), 0);

    const netDepositRes = await client.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'buy' THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type = 'sell' THEN amount ELSE 0 END), 0) as net_deposits
      FROM orders
      WHERE market_id = $1 AND status = 'filled'
    `, [marketId]);
    const netDeposits = Math.max(0, Number(netDepositRes.rows[0].net_deposits));

    const claimAmount = totalWinnerShares > 0
      ? (Number(position.shares) / totalWinnerShares) * netDeposits
      : 0;

    const now = Date.now();

    // Credit user balance (use UPSERT for safety, matching Bug C7 fix)
    await client.query(
      `INSERT INTO balances (user_address, available, locked) VALUES ($2, $1, 0)
       ON CONFLICT (user_address) DO UPDATE SET available = balances.available + $1`,
      [claimAmount, userAddress]
    );

    await client.query(`
      INSERT INTO settlement_log (id, market_id, action, user_address, amount, details, created_at)
      VALUES ($1, $2, 'claimed', $3, $4, $5, $6)
    `, [randomUUID(), marketId, userAddress, claimAmount, JSON.stringify({
      side: resolution.outcome, shares: Number(position.shares), pool: netDeposits, reward: claimAmount
    }), now]);

    // Prevent stale winning positions from remaining visible in portfolio
    // for edge-case manual claims that bypassed keeper auto-settlement.
    await client.query('DELETE FROM positions WHERE id = $1', [position.id]);

    await client.query('COMMIT');
    res.json({ success: true, amount: claimAmount, marketId, source: 'claimed' });
  } catch (txErr) {
    await client.query('ROLLBACK');
    console.error('Settlement claim error:', txErr);
    res.status(500).json({ error: 'Failed to claim settlement' });
  } finally {
    client.release();
  }
});

export default router;
