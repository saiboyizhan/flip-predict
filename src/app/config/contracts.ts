/**
 * PredictionMarket v3 + LimitOrderBook Smart Contract Configuration
 *
 * PM: CPMM + Agent + Oracle + Arbitration (ERC1155, UUPS)
 * LOB: Independent limit order book (UUPS), interacts with PM
 */

// ============================================================
//  ADDRESSES
// ============================================================

const DEFAULT_PM_ADDRESS = '0x82340f104eeabf5bD072081E28EB335fe90FdBAa'

export const PREDICTION_MARKET_ADDRESS = (
  import.meta.env.VITE_PREDICTION_MARKET_ADDRESS ||
  DEFAULT_PM_ADDRESS
) as `0x${string}`;

const DEFAULT_LOB_ADDRESS = '0x249647B942A49714ea7403B6E9f07c05846ee046'

export const LIMIT_ORDER_BOOK_ADDRESS = (
  import.meta.env.VITE_LIMIT_ORDER_BOOK_ADDRESS ||
  DEFAULT_LOB_ADDRESS
) as `0x${string}`;

if (PREDICTION_MARKET_ADDRESS === '0x0000000000000000000000000000000000000000') {
  console.warn('[contracts] VITE_PREDICTION_MARKET_ADDRESS not set -- on-chain features will not work.');
}

// BSC USDT (BEP-20) -- 18 decimals
const DEFAULT_USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955'

export const USDT_ADDRESS = (
  import.meta.env.VITE_USDT_ADDRESS ||
  DEFAULT_USDT_ADDRESS
) as `0x${string}`;

// ============================================================
//  USDT ABI
// ============================================================

export const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'transferFrom',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

// ============================================================
//  PREDICTION MARKET ABI (CPMM + Agent + Oracle + Arbitration)
// ============================================================

export const PREDICTION_MARKET_ABI = [
  // CPMM Trading
  {
    name: 'buy',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'buyYes', type: 'bool' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'sharesOut', type: 'uint256' }],
  },
  {
    name: 'sell',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'sellYes', type: 'bool' },
      { name: 'shares', type: 'uint256' },
    ],
    outputs: [{ name: 'usdtOut', type: 'uint256' }],
  },
  // Liquidity
  {
    name: 'addLiquidity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'newShares', type: 'uint256' }],
  },
  {
    name: 'removeLiquidity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'sharesToBurn', type: 'uint256' },
    ],
    outputs: [{ name: 'usdtOut', type: 'uint256' }],
  },
  // Price & Reserves
  {
    name: 'getPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [
      { name: 'yesPrice', type: 'uint256' },
      { name: 'noPrice', type: 'uint256' },
    ],
  },
  {
    name: 'getReserves',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [
      { name: 'yesReserve', type: 'uint256' },
      { name: 'noReserve', type: 'uint256' },
    ],
  },
  {
    name: 'getMarketAmm',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [
      { name: 'yesReserve', type: 'uint256' },
      { name: 'noReserve', type: 'uint256' },
      { name: 'totalLpShares_', type: 'uint256' },
      { name: 'initialLiquidity', type: 'uint256' },
      { name: 'totalCollateral', type: 'uint256' },
    ],
  },
  {
    name: 'getLpInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'user', type: 'address' },
    ],
    outputs: [
      { name: 'totalShares', type: 'uint256' },
      { name: 'userLpShares', type: 'uint256' },
      { name: 'poolValue', type: 'uint256' },
      { name: 'userValue', type: 'uint256' },
      { name: 'yesReserve', type: 'uint256' },
      { name: 'noReserve', type: 'uint256' },
    ],
  },
  {
    name: 'lpShares',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'user', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // Claim Winnings / Refund
  {
    name: 'claimWinnings',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'claimRefund',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [],
  },
  // User Market Creation
  {
    name: 'createUserMarket',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'title', type: 'string' },
      { name: 'endTime', type: 'uint256' },
      { name: 'initialLiq', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // CTF: Split / Merge
  {
    name: 'splitPosition',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'mergePositions',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  // Market & Position Views
  {
    name: 'getMarket',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [
      { name: 'title', type: 'string' },
      { name: 'endTime', type: 'uint256' },
      { name: 'totalYes', type: 'uint256' },
      { name: 'totalNo', type: 'uint256' },
      { name: 'resolved', type: 'bool' },
      { name: 'outcome', type: 'bool' },
      { name: 'cancelled', type: 'bool' },
      { name: 'oracleEnabled', type: 'bool' },
      { name: 'priceFeed', type: 'address' },
      { name: 'targetPrice', type: 'int256' },
      { name: 'resolutionType', type: 'uint8' },
      { name: 'resolvedPrice', type: 'int256' },
    ],
  },
  {
    name: 'getPosition',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'user', type: 'address' },
    ],
    outputs: [
      { name: 'yesAmount', type: 'uint256' },
      { name: 'noAmount', type: 'uint256' },
      { name: 'claimed', type: 'bool' },
    ],
  },
  {
    name: 'isMarketCancelled',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'isMarketActive',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  // Public State Variables
  {
    name: 'marketCreationFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'nextMarketId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'accumulatedFees',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // Token ID Helpers & ERC1155
  {
    name: 'getYesTokenId',
    type: 'function',
    stateMutability: 'pure',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getNoTokenId',
    type: 'function',
    stateMutability: 'pure',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'safeTransferFrom',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'id', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'setApprovalForAll',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
  },
  {
    name: 'isApprovedForAll',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  // Arbitration
  {
    name: 'proposeResolution',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: '_outcome', type: 'bool' },
    ],
    outputs: [],
  },
  {
    name: 'challengeResolution',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'finalizeResolution',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'adminFinalizeResolution',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: '_outcome', type: 'bool' },
    ],
    outputs: [],
  },
  {
    name: 'lpClaimAfterResolution',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'lpRefundAfterCancel',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'MAX_CHALLENGES',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'hasChallenged',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'challenger', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  // Agent
  {
    name: 'getAgentPosition',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'agentTokenId', type: 'uint256' },
    ],
    outputs: [
      { name: 'yesAmount', type: 'uint256' },
      { name: 'noAmount', type: 'uint256' },
      { name: 'claimed', type: 'bool' },
    ],
  },
  // Events
  {
    name: 'Trade',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'isBuy', type: 'bool', indexed: false },
      { name: 'side', type: 'bool', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'shares', type: 'uint256', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'LiquidityAdded',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'lpSharesMinted', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'LiquidityRemoved',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'sharesBurned', type: 'uint256', indexed: false },
      { name: 'usdtOut', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'MarketCreated',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'title', type: 'string', indexed: false },
      { name: 'endTime', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'MarketResolved',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'outcome', type: 'bool', indexed: false },
    ],
  },
  {
    name: 'WinningsClaimed',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'MarketCancelled',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
    ],
  },
  {
    name: 'UserMarketCreated',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'title', type: 'string', indexed: false },
      { name: 'creationFee', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'PositionSplit',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'PositionsMerged',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'ResolutionProposed',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'proposer', type: 'address', indexed: true },
      { name: 'proposedOutcome', type: 'bool', indexed: false },
      { name: 'challengeWindowEnd', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'ResolutionChallenged',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'challenger', type: 'address', indexed: true },
      { name: 'challengeCount', type: 'uint256', indexed: false },
      { name: 'newWindowEnd', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'ResolutionFinalized',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'outcome', type: 'bool', indexed: false },
    ],
  },
  {
    name: 'RefundClaimed',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'AgentPositionTaken',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'agentTokenId', type: 'uint256', indexed: true },
      { name: 'isYes', type: 'bool', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'AgentRefundClaimed',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'agentTokenId', type: 'uint256', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;

// ============================================================
//  LIMIT ORDER BOOK ABI (independent contract)
// ============================================================

export const LIMIT_ORDER_BOOK_ABI = [
  {
    name: 'placeLimitOrder',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'orderSide', type: 'uint8' },
      { name: 'price', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'orderId', type: 'uint256' }],
  },
  {
    name: 'fillLimitOrder',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'orderId', type: 'uint256' },
      { name: 'fillAmount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'cancelLimitOrder',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'orderId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getLimitOrder',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'orderId', type: 'uint256' }],
    outputs: [
      { name: 'id', type: 'uint256' },
      { name: 'marketId', type: 'uint256' },
      { name: 'maker', type: 'address' },
      { name: 'orderSide', type: 'uint8' },
      { name: 'price', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'filled', type: 'uint256' },
      { name: 'createdAt', type: 'uint256' },
      { name: 'cancelled', type: 'bool' },
    ],
  },
  {
    name: 'getMarketOrderIds',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    name: 'getUserOrderIds',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    name: 'accumulatedFees',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // Events
  {
    name: 'LimitOrderPlaced',
    type: 'event',
    inputs: [
      { name: 'orderId', type: 'uint256', indexed: true },
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'maker', type: 'address', indexed: true },
      { name: 'orderSide', type: 'uint8', indexed: false },
      { name: 'price', type: 'uint256', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'LimitOrderFilled',
    type: 'event',
    inputs: [
      { name: 'orderId', type: 'uint256', indexed: true },
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'taker', type: 'address', indexed: true },
      { name: 'fillAmount', type: 'uint256', indexed: false },
      { name: 'fillPrice', type: 'uint256', indexed: false },
      { name: 'takerFee', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'LimitOrderCancelled',
    type: 'event',
    inputs: [
      { name: 'orderId', type: 'uint256', indexed: true },
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'maker', type: 'address', indexed: true },
    ],
  },
  {
    name: 'Trade',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'isBuy', type: 'bool', indexed: false },
      { name: 'side', type: 'bool', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'shares', type: 'uint256', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
    ],
  },
] as const;

/**
 * Wagmi contract config objects.
 */
export const predictionMarketConfig = {
  address: PREDICTION_MARKET_ADDRESS,
  abi: PREDICTION_MARKET_ABI,
} as const;

export const limitOrderBookConfig = {
  address: LIMIT_ORDER_BOOK_ADDRESS,
  abi: LIMIT_ORDER_BOOK_ABI,
} as const;
