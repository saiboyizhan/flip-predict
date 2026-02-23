/**
 * On-chain read-only module for agent NFA queries.
 *
 * Hot wallet and on-chain execution have been removed.
 * Agent trades are now executed directly by the user's wallet on the frontend.
 */
import { ethers } from 'ethers';
import { BSC_RPC_URL } from '../config/network';

const NFA_ADDRESS = process.env.NFA_CONTRACT_ADDRESS
  || process.env.VITE_NFA_CONTRACT_ADDRESS
  || process.env.VITE_NFA_ADDRESS
  || '';

const NFA_ABI = [
  'function predictionMarketBalances(uint256 tokenId) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getAgentBalance(uint256 tokenId) view returns (uint256)',
];

let provider: ethers.JsonRpcProvider | null = null;
let nfaContract: ethers.Contract | null = null;
let initialized = false;

export function initAgentChain(): boolean {
  if (!NFA_ADDRESS || !ethers.isAddress(NFA_ADDRESS)) {
    console.warn('[agent-chain] NFA_CONTRACT_ADDRESS not set, on-chain agent queries disabled');
    return false;
  }

  try {
    provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
    nfaContract = new ethers.Contract(NFA_ADDRESS, NFA_ABI, provider);
    initialized = true;
    console.info(`[agent-chain] Initialized read-only provider, NFA: ${NFA_ADDRESS}`);
    return true;
  } catch (err: any) {
    console.error('[agent-chain] Failed to initialize:', err.message);
    return false;
  }
}

export function isAgentChainEnabled(): boolean {
  return initialized && nfaContract !== null;
}

/**
 * Check on-chain status of an NFA token (read-only).
 */
export async function checkAgentOnChainReady(tokenId: number): Promise<{
  ready: boolean;
  owner: string;
  pmBalance: bigint;
  reason?: string;
}> {
  if (!nfaContract) {
    return { ready: false, owner: '', pmBalance: 0n, reason: 'Chain module not initialized' };
  }

  try {
    const [owner, pmBalance] = await Promise.all([
      nfaContract.ownerOf(tokenId) as Promise<string>,
      nfaContract.predictionMarketBalances(tokenId) as Promise<bigint>,
    ]);

    return { ready: true, owner, pmBalance };
  } catch (err: any) {
    return { ready: false, owner: '', pmBalance: 0n, reason: err.message };
  }
}
