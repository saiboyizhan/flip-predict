/**
 * PredictionMarket Smart Contract Configuration
 *
 * ABI subset covering deposit, withdraw, takePosition, claimWinnings,
 * balances, getMarket, getPosition, and key events.
 */

// BSC Testnet deployed address (fallback when env var not set, e.g. Cloudflare Pages)
const DEFAULT_PM_ADDRESS = '0xbf7eC4e574f27c93f24BFDE9623380804ebaBca5'

export const PREDICTION_MARKET_ADDRESS = (
  import.meta.env.VITE_PREDICTION_MARKET_ADDRESS ||
  DEFAULT_PM_ADDRESS
) as `0x${string}`;

if (PREDICTION_MARKET_ADDRESS === '0x0000000000000000000000000000000000000000') {
  console.warn('[contracts] VITE_PREDICTION_MARKET_ADDRESS not set — on-chain features will not work.');
}

// -----------------------------------------------------------------
// BSC USDT (BEP-20) — 18 decimals
// -----------------------------------------------------------------
// BSC Testnet MockUSDT address
const DEFAULT_USDT_ADDRESS = '0x21fC50C7D2d174EF6d4c9B07Ba36Bfc4cD45233F'

export const USDT_ADDRESS = (
  import.meta.env.VITE_USDT_ADDRESS ||
  DEFAULT_USDT_ADDRESS
) as `0x${string}`;

export const MOCK_USDT_MINT_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

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

export const PREDICTION_MARKET_ABI = [
  // --- Write functions ---
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'takePosition',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'isYes', type: 'bool' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'claimWinnings',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [],
  },

  // --- User market creation ---
  {
    name: 'createUserMarket',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'title', type: 'string' },
      { name: 'endTime', type: 'uint256' },
      { name: 'initialLiquidity', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },

  // --- Read functions ---
  {
    name: 'balances',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
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

  // --- Public state variables ---
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

  // --- Cancel / Refund (round 4) ---
  {
    name: 'cancelMarket',
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
  {
    name: 'isMarketCancelled',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },

  // --- Agent positions (round 4) ---
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

  // --- Accumulated fees view ---
  {
    name: 'accumulatedFees',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },

  // --- Events ---
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
    name: 'Deposit',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Withdraw',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'PositionTaken',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'isYes', type: 'bool', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
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

  // --- CTF ERC1155 write functions ---
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

  // --- CTF ERC1155 read functions ---
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

  // --- ERC1155 standard functions ---
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

  // --- ERC1155Supply ---
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },

  // --- Arbitration functions ---
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
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: '_outcome', type: 'bool' },
    ],
    outputs: [],
  },

  // --- Arbitration read ---
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

  // --- CTF events ---
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

  // --- Arbitration events ---
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

  // --- Refund & Agent events ---
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

/**
 * Wagmi contract config object for use with useReadContract / useWriteContract.
 */
export const predictionMarketConfig = {
  address: PREDICTION_MARKET_ADDRESS,
  abi: PREDICTION_MARKET_ABI,
} as const;
