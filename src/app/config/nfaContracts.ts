// BSC Testnet deployed address (fallback when env var not set, e.g. Cloudflare Pages)
const DEFAULT_NFA_ADDRESS = '0x0728fB29bF3cA2272d91280476f778230e202AbB'

export const NFA_CONTRACT_ADDRESS = (
  import.meta.env.VITE_NFA_CONTRACT_ADDRESS ||
  import.meta.env.VITE_NFA_ADDRESS ||
  DEFAULT_NFA_ADDRESS
)

// FLIP Token (ERC-20) for NFA mint payment
export const FLIP_TOKEN_ADDRESS = '0x713eF4574954988df53a2A051C7aC10a6c1E8586'
export const NFA_MINT_PRICE = 100_000n * 10n ** 18n // 100,000 FLIP

// Complete NFA ABI extracted from contracts/artifacts/contracts/NFA.sol/NFA.json
// Including all ERC-721, BAP-578, and custom functions
export const NFA_ABI = [
  // --- Constructor ---
  {
    inputs: [
      { internalType: 'address', name: '_usdtToken', type: 'address' },
      { internalType: 'address', name: '_flipToken', type: 'address' },
      { internalType: 'uint256', name: '_mintPrice', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },

  // --- Mint function ---
  {
    inputs: [
      {
        components: [
          { name: 'name', type: 'string' },
          { name: 'persona', type: 'string' },
          { name: 'voiceHash', type: 'bytes32' },
          { name: 'animationURI', type: 'string' },
          { name: 'vaultURI', type: 'string' },
          { name: 'vaultHash', type: 'bytes32' },
          { name: 'avatarId', type: 'uint8' },
        ],
        name: 'metadata',
        type: 'tuple',
      },
    ],
    name: 'mint',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // --- Agent lifecycle functions ---
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'pauseAgent',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'unpauseAgent',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'terminateAgent',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // --- Agent funding functions ---
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'fundAgent',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'withdrawFromAgent',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // --- Agent read functions ---
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'getAgentBalance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'getState',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'getAgentMetadata',
    outputs: [
      {
        components: [
          { name: 'name', type: 'string' },
          { name: 'persona', type: 'string' },
          { name: 'voiceHash', type: 'bytes32' },
          { name: 'animationURI', type: 'string' },
          { name: 'vaultURI', type: 'string' },
          { name: 'vaultHash', type: 'bytes32' },
          { name: 'avatarId', type: 'uint8' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },

  // --- Agent action execution ---
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    name: 'executeAction',
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // --- Logic & vault management ---
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'newLogic', type: 'address' },
    ],
    name: 'setLogicAddress',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      {
        components: [
          { name: 'name', type: 'string' },
          { name: 'persona', type: 'string' },
          { name: 'voiceHash', type: 'bytes32' },
          { name: 'animationURI', type: 'string' },
          { name: 'vaultURI', type: 'string' },
          { name: 'vaultHash', type: 'bytes32' },
          { name: 'avatarId', type: 'uint8' },
        ],
        name: 'newMetadata',
        type: 'tuple',
      },
    ],
    name: 'updateAgentMetadata',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'newVaultURI', type: 'string' },
      { name: 'newVaultHash', type: 'bytes32' },
    ],
    name: 'updateVault',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // --- Constants ---
  {
    inputs: [],
    name: 'MAX_AGENTS_PER_ADDRESS',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'usdtToken',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'flipToken',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'mintPrice',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },

  // --- Mint count tracking ---
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'getMintCount',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: '', type: 'address' }],
    name: 'mintCount',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },

  // --- ERC-721 Core ---
  {
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'getApproved',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'name',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'interfaceId', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'tokenURI',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    name: 'transferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // --- ERC-721 Enumerable ---
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    name: 'tokenOfOwnerByIndex',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'index', type: 'uint256' }],
    name: 'tokenByIndex',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },

  // --- Learning Module Functions ---
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'newRoot', type: 'bytes32' },
      { name: '', type: 'bytes' },
    ],
    name: 'updateLearning',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'getLearningMetrics',
    outputs: [
      {
        components: [
          { name: 'totalInteractions', type: 'uint256' },
          { name: 'successfulOutcomes', type: 'uint256' },
          { name: 'learningRoot', type: 'bytes32' },
          { name: 'lastUpdated', type: 'uint256' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'claim', type: 'bytes32' },
      { name: 'proof', type: 'bytes32[]' },
    ],
    name: 'verifyLearning',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },

  // --- Memory Module Functions ---
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'moduleAddress', type: 'address' },
      { name: 'metadata', type: 'string' },
    ],
    name: 'registerModule',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'moduleAddress', type: 'address' },
    ],
    name: 'deactivateModule',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'moduleAddress', type: 'address' },
    ],
    name: 'getModule',
    outputs: [
      {
        components: [
          { name: 'moduleAddress', type: 'address' },
          { name: 'metadata', type: 'string' },
          { name: 'metadataHash', type: 'bytes32' },
          { name: 'registrationTime', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'moduleAddress', type: 'address' },
      { name: 'expectedHash', type: 'bytes32' },
    ],
    name: 'verifyModule',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },

  // --- Vault Permission Functions ---
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'delegate', type: 'address' },
      { name: 'level', type: 'uint8' },
      { name: 'expiryTime', type: 'uint256' },
    ],
    name: 'delegateAccess',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'delegate', type: 'address' },
    ],
    name: 'revokeAccess',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'delegate', type: 'address' },
    ],
    name: 'getPermission',
    outputs: [
      {
        components: [
          { name: 'delegate', type: 'address' },
          { name: 'level', type: 'uint8' },
          { name: 'expiryTime', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'accessor', type: 'address' },
      { name: 'requiredLevel', type: 'uint8' },
    ],
    name: 'verifyAccess',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },

  // --- Prediction Market Integration ---
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'depositToPredictionMarket',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'marketId', type: 'uint256' },
      { name: 'isYes', type: 'bool' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'agentPredictionTakePosition',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // --- Auto Trade Authorization ---
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'caller', type: 'address' },
      { name: 'maxPerTrade', type: 'uint256' },
      { name: 'maxDaily', type: 'uint256' },
      { name: 'duration', type: 'uint256' },
    ],
    name: 'authorizeAutoTrade',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'revokeAutoTrade',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'getAutoTradeAuth',
    outputs: [
      {
        components: [
          { name: 'authorized', type: 'bool' },
          { name: 'authorizedCaller', type: 'address' },
          { name: 'maxAmountPerTrade', type: 'uint256' },
          { name: 'maxDailyAmount', type: 'uint256' },
          { name: 'dailyUsed', type: 'uint256' },
          { name: 'lastResetDay', type: 'uint256' },
          { name: 'expiresAt', type: 'uint256' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },

  // --- Prediction Market Bridge (additional) ---
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'marketId', type: 'uint256' },
    ],
    name: 'agentPredictionClaimWinnings',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'marketId', type: 'uint256' },
    ],
    name: 'agentPredictionClaimRefund',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'withdrawFromPredictionMarketToAgent',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'predictionMarketBalances',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'marketId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'agentPredictionSplitPosition',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // --- Events ---
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'owner', type: 'address' },
      { indexed: true, name: 'approved', type: 'address' },
      { indexed: true, name: 'tokenId', type: 'uint256' },
    ],
    name: 'Approval',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'owner', type: 'address' },
      { indexed: true, name: 'operator', type: 'address' },
      { indexed: false, name: 'approved', type: 'bool' },
    ],
    name: 'ApprovalForAll',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: true, name: 'tokenId', type: 'uint256' },
    ],
    name: 'Transfer',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: false, name: 'state', type: 'uint8' },
    ],
    name: 'AgentStateChanged',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: false, name: 'amount', type: 'uint256' },
    ],
    name: 'AgentFunded',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: false, name: 'amount', type: 'uint256' },
    ],
    name: 'AgentWithdrawn',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: false, name: 'target', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' },
      { indexed: false, name: 'data', type: 'bytes' },
    ],
    name: 'AgentActionExecuted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: false, name: 'newRoot', type: 'bytes32' },
    ],
    name: 'LearningUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: true, name: 'moduleAddress', type: 'address' },
    ],
    name: 'ModuleRegistered',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: true, name: 'moduleAddress', type: 'address' },
    ],
    name: 'ModuleDeactivated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: true, name: 'delegate', type: 'address' },
      { indexed: false, name: 'level', type: 'uint8' },
      { indexed: false, name: 'expiryTime', type: 'uint256' },
    ],
    name: 'AccessDelegated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: true, name: 'delegate', type: 'address' },
    ],
    name: 'AccessRevoked',
    type: 'event',
  },
] as const
