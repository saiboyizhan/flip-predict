export const NFA_CONTRACT_ADDRESS = (
  import.meta.env.VITE_NFA_CONTRACT_ADDRESS ||
  import.meta.env.VITE_NFA_ADDRESS ||
  '0x0000000000000000000000000000000000000000'
)

export const NFA_ABI = [
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
  {
    inputs: [],
    name: 'MAX_AGENTS_PER_ADDRESS',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
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
] as const
