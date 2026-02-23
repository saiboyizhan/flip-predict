/**
 * On-chain event listener for PredictionMarketV3 + LimitOrderBook.
 * PM events: Trade, LiquidityAdded, LiquidityRemoved, MarketResolved
 * LOB events: LimitOrderPlaced, LimitOrderFilled, LimitOrderCancelled, Trade
 */
import { ethers } from 'ethers';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { BSC_RPC_URL } from '../config/network';
import {
  broadcastPriceUpdate,
  broadcastNewTrade,
  broadcastMarketResolved,
  broadcastOrderBookUpdate,
} from '../ws/index';
import { resolvePredictions } from './agent-prediction';
import { settleAgentTrades } from './agent-settlement';

const PREDICTION_MARKET_ADDRESS =
  process.env.PREDICTION_MARKET_ADDRESS ||
  process.env.VITE_PREDICTION_MARKET_ADDRESS ||
  '';

const LIMIT_ORDER_BOOK_ADDRESS =
  process.env.LIMIT_ORDER_BOOK_ADDRESS ||
  process.env.VITE_LIMIT_ORDER_BOOK_ADDRESS ||
  '';

// PM event ABI (CPMM trading + liquidity + resolution)
const PM_EVENT_ABI = [
  'event Trade(uint256 indexed marketId, address indexed user, bool isBuy, bool side, uint256 amount, uint256 shares, uint256 fee)',
  'event LiquidityAdded(uint256 indexed marketId, address indexed user, uint256 amount, uint256 lpShares)',
  'event LiquidityRemoved(uint256 indexed marketId, address indexed user, uint256 shares, uint256 usdtOut)',
  'event MarketResolved(uint256 indexed marketId, bool outcome)',
  'function getPrice(uint256 marketId) view returns (uint256 yesPrice, uint256 noPrice)',
  'function getLpInfo(uint256 marketId, address user) view returns (uint256 totalShares, uint256 userLpShares, uint256 poolValue, uint256 userValue, uint256 yesReserve, uint256 noReserve)',
];

// LOB event ABI (limit orders + trade for K-line)
const LOB_EVENT_ABI = [
  'event LimitOrderPlaced(uint256 indexed orderId, uint256 indexed marketId, address indexed maker, uint8 orderSide, uint256 price, uint256 amount)',
  'event LimitOrderFilled(uint256 indexed orderId, uint256 indexed marketId, address indexed taker, uint256 fillAmount, uint256 fillPrice, uint256 takerFee)',
  'event LimitOrderCancelled(uint256 indexed orderId, uint256 indexed marketId, address indexed maker)',
  'event Trade(uint256 indexed marketId, address indexed user, bool isBuy, bool side, uint256 amount, uint256 shares, uint256 fee)',
];

let provider: ethers.JsonRpcProvider | null = null;
let pmContract: ethers.Contract | null = null;
let lobContract: ethers.Contract | null = null;

/**
 * Shared Trade event handler (used for both PM and LOB Trade events).
 * Fetches CPMM price from PM contract for K-line data.
 */
function createTradeHandler(db: Pool, source: string) {
  return async (marketId: any, user: any, isBuy: any, side: any, amount: any, shares: any, fee: any, event: any) => {
    try {
      const mId = marketId.toString();
      const userAddr = user.toLowerCase();
      const amountNum = Number(ethers.formatUnits(amount, 18));
      const sharesNum = Number(ethers.formatUnits(shares, 18));
      const feeNum = Number(ethers.formatUnits(fee, 18));
      const sideStr = side ? 'yes' : 'no';
      const typeStr = isBuy ? 'buy' : 'sell';
      const txHash = event?.log?.transactionHash || '';
      const eventTimestamp = Date.now();
      const orderId = randomUUID();

      const marketRes = await db.query(
        'SELECT id, yes_price, no_price, volume FROM markets WHERE on_chain_market_id = $1 LIMIT 1',
        [mId]
      );
      if (marketRes.rows.length === 0) {
        console.warn(`[event-listener] ${source} Trade for unknown on-chain market ${mId}`);
        return;
      }
      const market = marketRes.rows[0];
      const internalId = market.id;

      // Always fetch CPMM price from PM contract (even for LOB trades)
      let yesPrice = market.yes_price;
      let noPrice = market.no_price;
      try {
        if (pmContract) {
          const [yp, np] = await pmContract.getPrice(marketId);
          yesPrice = Number(ethers.formatUnits(yp, 18));
          noPrice = Number(ethers.formatUnits(np, 18));
        }
      } catch { /* use existing prices */ }

      await db.query(
        `INSERT INTO users (address, created_at) VALUES ($1, $2) ON CONFLICT (address) DO NOTHING`,
        [userAddr, Date.now()]
      );

      await db.query(
        `INSERT INTO orders (id, market_id, user_address, type, side, amount, shares, price, fee, status, tx_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'filled', $10, $11)`,
        [
          orderId, internalId, userAddr, typeStr, sideStr, amountNum, sharesNum,
          sharesNum > 0 ? amountNum / sharesNum : 0, feeNum, txHash, eventTimestamp,
        ]
      );

      await db.query(
        'UPDATE markets SET yes_price = $1, no_price = $2, volume = volume + $3 WHERE id = $4',
        [yesPrice, noPrice, amountNum, internalId]
      );

      await db.query(
        'INSERT INTO price_history (market_id, yes_price, no_price, timestamp) VALUES ($1, $2, $3, NOW())',
        [internalId, yesPrice, noPrice]
      );

      broadcastPriceUpdate(internalId, yesPrice, noPrice);
      broadcastNewTrade({
        orderId,
        marketId: internalId,
        userAddress: userAddr,
        side: sideStr,
        type: typeStr,
        amount: amountNum,
        shares: sharesNum,
        price: sharesNum > 0 ? amountNum / sharesNum : 0,
        timestamp: eventTimestamp,
      });

      console.info(`[event-listener] ${source} Trade: ${typeStr} ${sideStr} ${amountNum.toFixed(2)} USDT on market ${mId}`);
    } catch (err) {
      console.error(`[event-listener] Error processing ${source} Trade event:`, err);
    }
  };
}

export function startEventListener(db: Pool): void {
  if (!PREDICTION_MARKET_ADDRESS || !ethers.isAddress(PREDICTION_MARKET_ADDRESS)) {
    console.warn('[event-listener] PREDICTION_MARKET_ADDRESS not set or invalid, skipping event listener.');
    return;
  }

  provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
  pmContract = new ethers.Contract(PREDICTION_MARKET_ADDRESS, PM_EVENT_ABI, provider);

  console.info(`[event-listener] Listening to PM at ${PREDICTION_MARKET_ADDRESS}`);

  // --- PM Trade event ---
  pmContract.on('Trade', createTradeHandler(db, 'PM'));

  // --- LiquidityAdded event ---
  pmContract.on('LiquidityAdded', async (marketId, user, amount, lpShares, event) => {
    try {
      const mId = marketId.toString();
      const userAddr = user.toLowerCase();
      const amountNum = Number(ethers.formatUnits(amount, 18));
      const lpSharesNum = Number(ethers.formatUnits(lpShares, 18));
      const txHash = event?.log?.transactionHash || '';

      const marketRes = await db.query(
        'SELECT id, yes_reserve, no_reserve, total_lp_shares FROM markets WHERE on_chain_market_id = $1 LIMIT 1',
        [mId]
      );
      if (marketRes.rows.length === 0) {
        console.warn(`[event-listener] LiquidityAdded for unknown on-chain market ${mId}`);
        return;
      }
      const internalId = marketRes.rows[0].id;

      let yesReserve = Number(marketRes.rows[0].yes_reserve);
      let noReserve = Number(marketRes.rows[0].no_reserve);
      let totalLpShares = Number(marketRes.rows[0].total_lp_shares);
      try {
        if (pmContract) {
          const info = await pmContract.getLpInfo(marketId, user);
          yesReserve = Number(ethers.formatUnits(info[4], 18));
          noReserve = Number(ethers.formatUnits(info[5], 18));
          totalLpShares = Number(ethers.formatUnits(info[0], 18));
        }
      } catch { /* use existing values */ }

      await db.query(
        `INSERT INTO users (address, created_at) VALUES ($1, $2) ON CONFLICT (address) DO NOTHING`,
        [userAddr, Date.now()]
      );

      const totalLiq = yesReserve + noReserve;
      const yesPrice = noReserve / totalLiq;
      const noPrice = yesReserve / totalLiq;
      await db.query(
        `UPDATE markets SET yes_reserve = $1, no_reserve = $2, total_lp_shares = $3,
         total_liquidity = $4, yes_price = $5, no_price = $6 WHERE id = $7`,
        [yesReserve, noReserve, totalLpShares, totalLiq, yesPrice, noPrice, internalId]
      );

      await db.query(`
        INSERT INTO lp_positions (id, user_address, market_id, lp_shares, deposit_amount, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_address, market_id)
        DO UPDATE SET lp_shares = lp_positions.lp_shares + EXCLUDED.lp_shares,
                      deposit_amount = lp_positions.deposit_amount + EXCLUDED.deposit_amount
      `, [`lp-${txHash.slice(0, 16)}-${Date.now()}`, userAddr, internalId, lpSharesNum, amountNum, Date.now()]);

      broadcastPriceUpdate(internalId, yesPrice, noPrice);

      console.info(`[event-listener] LiquidityAdded: ${userAddr} added ${amountNum.toFixed(2)} USDT to market ${mId}`);
    } catch (err) {
      console.error('[event-listener] Error processing LiquidityAdded event:', err);
    }
  });

  // --- LiquidityRemoved event ---
  pmContract.on('LiquidityRemoved', async (marketId, user, shares, usdtOut, event) => {
    try {
      const mId = marketId.toString();
      const userAddr = user.toLowerCase();
      const sharesNum = Number(ethers.formatUnits(shares, 18));
      const outNum = Number(ethers.formatUnits(usdtOut, 18));

      const marketRes = await db.query(
        'SELECT id, yes_reserve, no_reserve, total_lp_shares FROM markets WHERE on_chain_market_id = $1 LIMIT 1',
        [mId]
      );
      if (marketRes.rows.length === 0) {
        console.warn(`[event-listener] LiquidityRemoved for unknown on-chain market ${mId}`);
        return;
      }
      const internalId = marketRes.rows[0].id;

      let yesReserve = Number(marketRes.rows[0].yes_reserve);
      let noReserve = Number(marketRes.rows[0].no_reserve);
      let totalLpShares = Number(marketRes.rows[0].total_lp_shares);
      try {
        if (pmContract) {
          const info = await pmContract.getLpInfo(marketId, user);
          yesReserve = Number(ethers.formatUnits(info[4], 18));
          noReserve = Number(ethers.formatUnits(info[5], 18));
          totalLpShares = Number(ethers.formatUnits(info[0], 18));
        }
      } catch { /* use existing values */ }

      const totalLiq = yesReserve + noReserve;
      const yesPrice = totalLiq > 0 ? noReserve / totalLiq : 0.5;
      const noPrice = totalLiq > 0 ? yesReserve / totalLiq : 0.5;
      await db.query(
        `UPDATE markets SET yes_reserve = $1, no_reserve = $2, total_lp_shares = $3,
         total_liquidity = $4, yes_price = $5, no_price = $6 WHERE id = $7`,
        [yesReserve, noReserve, totalLpShares, totalLiq, yesPrice, noPrice, internalId]
      );

      await db.query(`
        UPDATE lp_positions SET lp_shares = GREATEST(lp_shares - $1, 0)
        WHERE user_address = $2 AND market_id = $3
      `, [sharesNum, userAddr, internalId]);

      await db.query(
        `DELETE FROM lp_positions WHERE user_address = $1 AND market_id = $2 AND lp_shares <= 0`,
        [userAddr, internalId]
      );

      broadcastPriceUpdate(internalId, yesPrice, noPrice);

      console.info(`[event-listener] LiquidityRemoved: ${userAddr} removed ${sharesNum.toFixed(2)} LP shares from market ${mId}`);
    } catch (err) {
      console.error('[event-listener] Error processing LiquidityRemoved event:', err);
    }
  });

  // --- MarketResolved event ---
  pmContract.on('MarketResolved', async (marketId, outcome) => {
    try {
      const mId = marketId.toString();
      const outcomeStr = outcome ? 'yes' : 'no';

      const marketRes = await db.query(
        'SELECT id FROM markets WHERE on_chain_market_id = $1 LIMIT 1',
        [mId]
      );
      if (marketRes.rows.length > 0) {
        const internalId = marketRes.rows[0].id;

        const finalYesPrice = outcomeStr === 'yes' ? 1 : 0;
        const finalNoPrice = outcomeStr === 'yes' ? 0 : 1;

        await db.query(
          `UPDATE markets SET status = 'resolved', outcome = $1, resolved_at = NOW(),
           yes_price = $2, no_price = $3 WHERE id = $4`,
          [outcomeStr, finalYesPrice, finalNoPrice, internalId]
        );
        await db.query(
          'INSERT INTO price_history (market_id, yes_price, no_price, timestamp) VALUES ($1, $2, $3, NOW())',
          [internalId, finalYesPrice, finalNoPrice]
        );

        broadcastPriceUpdate(internalId, finalYesPrice, finalNoPrice);
        broadcastMarketResolved(internalId, outcomeStr);

        try {
          await resolvePredictions(db, internalId, outcomeStr);
        } catch (err: any) {
          console.error(`[event-listener] Failed to resolve predictions for ${internalId}:`, err.message);
        }
        try {
          await settleAgentTrades(db, internalId, outcomeStr);
        } catch (err: any) {
          console.error(`[event-listener] Failed to settle agent trades for ${internalId}:`, err.message);
        }
      }

      console.info(`[event-listener] MarketResolved: market ${mId} -> ${outcomeStr}`);
    } catch (err) {
      console.error('[event-listener] Error processing MarketResolved event:', err);
    }
  });

  // ============================================================
  //  LOB events
  // ============================================================

  if (LIMIT_ORDER_BOOK_ADDRESS && ethers.isAddress(LIMIT_ORDER_BOOK_ADDRESS)) {
    lobContract = new ethers.Contract(LIMIT_ORDER_BOOK_ADDRESS, LOB_EVENT_ABI, provider);
    console.info(`[event-listener] Listening to LOB at ${LIMIT_ORDER_BOOK_ADDRESS}`);

    // --- LOB Trade event (for K-line, uses PM getPrice) ---
    lobContract.on('Trade', createTradeHandler(db, 'LOB'));

    // --- LimitOrderPlaced event ---
    lobContract.on('LimitOrderPlaced', async (orderId, marketId, maker, orderSide, price, amount) => {
      try {
        const mId = marketId.toString();
        const oId = orderId.toString();
        const makerAddr = maker.toLowerCase();
        const priceNum = Number(ethers.formatUnits(price, 18));
        const amountNum = Number(ethers.formatUnits(amount, 18));
        const orderSideNum = Number(orderSide);
        const sideStr = orderSideNum < 2 ? (orderSideNum === 0 ? 'yes' : 'no') : (orderSideNum === 2 ? 'yes' : 'no');
        const orderSideStr = orderSideNum < 2 ? 'buy' : 'sell';

        const marketRes = await db.query(
          'SELECT id FROM markets WHERE on_chain_market_id = $1 LIMIT 1',
          [mId]
        );
        if (marketRes.rows.length === 0) {
          console.warn(`[event-listener] LimitOrderPlaced for unknown on-chain market ${mId}`);
          return;
        }
        const internalId = marketRes.rows[0].id;

        await db.query(
          `INSERT INTO users (address, created_at) VALUES ($1, $2) ON CONFLICT (address) DO NOTHING`,
          [makerAddr, Date.now()]
        );

        await db.query(
          `INSERT INTO open_orders (id, user_address, market_id, side, order_side, price, amount, filled, status, created_at, on_chain_order_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'open', $8, $9)
           ON CONFLICT (id) DO NOTHING`,
          [
            `lo-${oId}`, makerAddr, internalId, sideStr, orderSideStr,
            priceNum, amountNum, Date.now(), parseInt(oId),
          ]
        );

        broadcastOrderBookUpdate(internalId, sideStr, { action: 'placed', orderId: oId, price: priceNum, amount: amountNum });

        console.info(`[event-listener] LimitOrderPlaced: order ${oId} on market ${mId}, ${orderSideStr} ${sideStr} @ ${priceNum.toFixed(4)}`);
      } catch (err) {
        console.error('[event-listener] Error processing LimitOrderPlaced event:', err);
      }
    });

    // --- LimitOrderFilled event ---
    lobContract.on('LimitOrderFilled', async (orderId, marketId, taker, fillAmount, fillPrice, takerFee) => {
      try {
        const oId = orderId.toString();
        const mId = marketId.toString();
        const fillAmountNum = Number(ethers.formatUnits(fillAmount, 18));
        const fillPriceNum = Number(ethers.formatUnits(fillPrice, 18));

        const marketRes = await db.query(
          'SELECT id FROM markets WHERE on_chain_market_id = $1 LIMIT 1',
          [mId]
        );
        if (marketRes.rows.length === 0) return;
        const internalId = marketRes.rows[0].id;

        await db.query(
          `UPDATE open_orders SET filled = filled + $1,
           status = CASE WHEN filled + $1 >= amount THEN 'filled' ELSE status END
           WHERE on_chain_order_id = $2 AND market_id = $3`,
          [fillAmountNum, parseInt(oId), internalId]
        );

        const orderRes = await db.query(
          'SELECT side FROM open_orders WHERE on_chain_order_id = $1 AND market_id = $2 LIMIT 1',
          [parseInt(oId), internalId]
        );
        const orderSide = orderRes.rows[0]?.side || 'yes';

        broadcastOrderBookUpdate(internalId, orderSide, { action: 'filled', orderId: oId, fillAmount: fillAmountNum, fillPrice: fillPriceNum });

        console.info(`[event-listener] LimitOrderFilled: order ${oId} filled ${fillAmountNum.toFixed(2)} @ ${fillPriceNum.toFixed(4)}`);
      } catch (err) {
        console.error('[event-listener] Error processing LimitOrderFilled event:', err);
      }
    });

    // --- LimitOrderCancelled event ---
    lobContract.on('LimitOrderCancelled', async (orderId, marketId, maker) => {
      try {
        const oId = orderId.toString();
        const mId = marketId.toString();

        const marketRes = await db.query(
          'SELECT id FROM markets WHERE on_chain_market_id = $1 LIMIT 1',
          [mId]
        );
        if (marketRes.rows.length === 0) return;
        const internalId = marketRes.rows[0].id;

        const orderRes = await db.query(
          'SELECT side FROM open_orders WHERE on_chain_order_id = $1 AND market_id = $2 LIMIT 1',
          [parseInt(oId), internalId]
        );
        const orderSide = orderRes.rows[0]?.side || 'yes';

        await db.query(
          `UPDATE open_orders SET status = 'cancelled' WHERE on_chain_order_id = $1 AND market_id = $2`,
          [parseInt(oId), internalId]
        );

        broadcastOrderBookUpdate(internalId, orderSide, { action: 'cancelled', orderId: oId });

        console.info(`[event-listener] LimitOrderCancelled: order ${oId} on market ${mId}`);
      } catch (err) {
        console.error('[event-listener] Error processing LimitOrderCancelled event:', err);
      }
    });
  } else {
    console.warn('[event-listener] LIMIT_ORDER_BOOK_ADDRESS not set or invalid, LOB events will not be monitored.');
  }

  // Handle provider errors / reconnection with exponential backoff
  let reconnectAttempts = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let healthCheckTimer: NodeJS.Timeout | null = null;

  const reconnect = () => {
    if (reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 60000);
    reconnectAttempts++;
    console.info(`[event-listener] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      stopEventListener();
      startEventListener(db);
    }, delay);
  };

  provider.on('error', (err) => {
    console.error('[event-listener] Provider error:', err);
    reconnect();
  });

  healthCheckTimer = setInterval(async () => {
    try {
      if (provider) {
        await provider.getBlockNumber();
        reconnectAttempts = 0;
      }
    } catch (err) {
      console.error('[event-listener] Health check failed:', err);
      reconnect();
    }
  }, 5 * 60 * 1000);

  (provider as any)._healthCheckTimer = healthCheckTimer;
}

export function stopEventListener(): void {
  if (pmContract) {
    pmContract.removeAllListeners();
    pmContract = null;
  }
  if (lobContract) {
    lobContract.removeAllListeners();
    lobContract = null;
  }
  if (provider) {
    provider.removeAllListeners();
    const hcTimer = (provider as any)._healthCheckTimer;
    if (hcTimer) clearInterval(hcTimer);
    provider = null;
  }
}
