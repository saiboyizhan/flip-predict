/**
 * On-chain event listener for PredictionMarket v2.
 * Monitors Trade, LiquidityAdded, LiquidityRemoved, MarketResolved events
 * and indexes them into the database + broadcasts via WebSocket.
 */
import { ethers } from 'ethers';
import { Pool } from 'pg';
import { BSC_RPC_URL } from '../config/network';
import {
  broadcastPriceUpdate,
  broadcastNewTrade,
  broadcastMarketResolved,
} from '../ws/index';
import { matchLimitOrders } from './limit-orders';

const PREDICTION_MARKET_ADDRESS =
  process.env.PREDICTION_MARKET_ADDRESS ||
  process.env.VITE_PREDICTION_MARKET_ADDRESS ||
  '';

// Minimal ABI for the events we care about
const EVENT_ABI = [
  'event Trade(uint256 indexed marketId, address indexed user, bool isBuy, bool side, uint256 amount, uint256 shares, uint256 fee)',
  'event LiquidityAdded(uint256 indexed marketId, address indexed user, uint256 amount, uint256 lpShares)',
  'event LiquidityRemoved(uint256 indexed marketId, address indexed user, uint256 shares, uint256 usdtOut)',
  'event MarketResolved(uint256 indexed marketId, bool outcome)',
  'function getPrice(uint256 marketId) view returns (uint256 yesPrice, uint256 noPrice)',
];

let provider: ethers.JsonRpcProvider | null = null;
let contract: ethers.Contract | null = null;

export function startEventListener(db: Pool): void {
  if (!PREDICTION_MARKET_ADDRESS || !ethers.isAddress(PREDICTION_MARKET_ADDRESS)) {
    console.warn('[event-listener] PREDICTION_MARKET_ADDRESS not set or invalid, skipping event listener.');
    return;
  }

  provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
  contract = new ethers.Contract(PREDICTION_MARKET_ADDRESS, EVENT_ABI, provider);

  console.info(`[event-listener] Listening to PredictionMarket at ${PREDICTION_MARKET_ADDRESS} on ${BSC_RPC_URL}`);

  // --- Trade event ---
  contract.on('Trade', async (marketId, user, isBuy, side, amount, shares, fee, event) => {
    try {
      const mId = marketId.toString();
      const userAddr = user.toLowerCase();
      const amountNum = Number(ethers.formatUnits(amount, 18));
      const sharesNum = Number(ethers.formatUnits(shares, 18));
      const feeNum = Number(ethers.formatUnits(fee, 18));
      const sideStr = side ? 'yes' : 'no';
      const typeStr = isBuy ? 'buy' : 'sell';
      const txHash = event?.log?.transactionHash || '';

      // Find internal market ID from on_chain_market_id
      const marketRes = await db.query(
        'SELECT id, yes_price, no_price, volume FROM markets WHERE on_chain_market_id = $1 LIMIT 1',
        [mId]
      );
      if (marketRes.rows.length === 0) {
        console.warn(`[event-listener] Trade event for unknown on-chain market ${mId}`);
        return;
      }
      const market = marketRes.rows[0];
      const internalId = market.id;

      // Fetch updated prices from contract
      let yesPrice = market.yes_price;
      let noPrice = market.no_price;
      try {
        if (contract) {
          const [yp, np] = await contract.getPrice(marketId);
          yesPrice = Number(ethers.formatUnits(yp, 18));
          noPrice = Number(ethers.formatUnits(np, 18));
        }
      } catch { /* use existing prices */ }

      // Ensure user exists (foreign key constraint)
      await db.query(
        `INSERT INTO users (address, created_at) VALUES ($1, $2) ON CONFLICT (address) DO NOTHING`,
        [userAddr, Date.now()]
      );

      // Insert order record
      await db.query(
        `INSERT INTO orders (id, market_id, user_address, type, side, amount, shares, price, fee, status, tx_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'filled', $10, $11)`,
        [
          `evt-${txHash.slice(0, 16)}-${Date.now()}`,
          internalId,
          userAddr,
          typeStr,
          sideStr,
          amountNum,
          sharesNum,
          sharesNum > 0 ? amountNum / sharesNum : 0,
          feeNum,
          txHash,
          Date.now(),
        ]
      );

      // Update market prices and volume
      await db.query(
        'UPDATE markets SET yes_price = $1, no_price = $2, volume = volume + $3 WHERE id = $4',
        [yesPrice, noPrice, amountNum, internalId]
      );

      // Insert price history
      await db.query(
        'INSERT INTO price_history (market_id, yes_price, no_price, timestamp) VALUES ($1, $2, $3, NOW())',
        [internalId, yesPrice, noPrice]
      );

      // Broadcast via WebSocket
      broadcastPriceUpdate(internalId, yesPrice, noPrice);
      broadcastNewTrade({
        orderId: `evt-${txHash.slice(0, 16)}-${Date.now()}`,
        marketId: internalId,
        userAddress: userAddr,
        side: sideStr,
        type: typeStr,
        amount: amountNum,
        shares: sharesNum,
        price: sharesNum > 0 ? amountNum / sharesNum : 0,
        timestamp: Date.now(),
      });

      console.info(`[event-listener] Trade: ${typeStr} ${sideStr} ${amountNum.toFixed(2)} USDT → ${sharesNum.toFixed(2)} shares on market ${mId}`);

      // After price change, try to match limit orders
      try {
        const filled = await matchLimitOrders(db, internalId);
        if (filled > 0) console.info(`[event-listener] Matched ${filled} limit order(s) on market ${internalId}`);
      } catch (matchErr) {
        console.error('[event-listener] Limit order matching error:', matchErr);
      }
    } catch (err) {
      console.error('[event-listener] Error processing Trade event:', err);
    }
  });

  // --- LiquidityAdded event ---
  contract.on('LiquidityAdded', async (marketId, user, amount, lpShares) => {
    try {
      const mId = marketId.toString();
      const amountNum = Number(ethers.formatUnits(amount, 18));
      console.info(`[event-listener] LiquidityAdded: ${user} added ${amountNum.toFixed(2)} USDT to market ${mId}`);

      // Update market volume
      const marketRes = await db.query(
        'SELECT id FROM markets WHERE on_chain_market_id = $1 LIMIT 1',
        [mId]
      );
      if (marketRes.rows.length > 0) {
        await db.query(
          'UPDATE markets SET volume = volume + $1 WHERE id = $2',
          [amountNum, marketRes.rows[0].id]
        );
      }
    } catch (err) {
      console.error('[event-listener] Error processing LiquidityAdded event:', err);
    }
  });

  // --- LiquidityRemoved event ---
  contract.on('LiquidityRemoved', async (marketId, user, shares, usdtOut) => {
    try {
      const mId = marketId.toString();
      const outNum = Number(ethers.formatUnits(usdtOut, 18));
      console.info(`[event-listener] LiquidityRemoved: ${user} removed ${outNum.toFixed(2)} USDT from market ${mId}`);
    } catch (err) {
      console.error('[event-listener] Error processing LiquidityRemoved event:', err);
    }
  });

  // --- MarketResolved event ---
  contract.on('MarketResolved', async (marketId, outcome) => {
    try {
      const mId = marketId.toString();
      const outcomeStr = outcome ? 'yes' : 'no';

      const marketRes = await db.query(
        'SELECT id FROM markets WHERE on_chain_market_id = $1 LIMIT 1',
        [mId]
      );
      if (marketRes.rows.length > 0) {
        const internalId = marketRes.rows[0].id;
        await db.query(
          "UPDATE markets SET status = 'resolved', outcome = $1, resolved_at = NOW() WHERE id = $2",
          [outcomeStr, internalId]
        );
        broadcastMarketResolved(internalId, outcomeStr);
      }

      console.info(`[event-listener] MarketResolved: market ${mId} → ${outcomeStr}`);
    } catch (err) {
      console.error('[event-listener] Error processing MarketResolved event:', err);
    }
  });

  // Handle provider errors / reconnection
  provider.on('error', (err) => {
    console.error('[event-listener] Provider error:', err);
  });
}

export function stopEventListener(): void {
  if (contract) {
    contract.removeAllListeners();
    contract = null;
  }
  if (provider) {
    provider.removeAllListeners();
    provider = null;
  }
}
