/**
 * On-chain execution module for agent trading via BAP-578 NFA contract.
 *
 * Flow:
 *   hot wallet (NFA token owner)
 *     → NFA.agentPredictionTakePosition(tokenId, marketId, isYes, amount)
 *       → PM.agentBuy(tokenId, marketId, buyYes, amount) [onlyNFA]
 *         → emit Trade(...)  (event-listener syncs to DB)
 *
 * Settlement:
 *   hot wallet
 *     → NFA.agentPredictionClaimWinnings(tokenId, marketId)
 *       → PM.agentClaimWinnings(tokenId, marketId) [onlyNFA]
 */
import { ethers } from 'ethers';
import { BSC_RPC_URL } from '../config/network';

const NFA_ADDRESS = process.env.NFA_CONTRACT_ADDRESS
  || process.env.VITE_NFA_CONTRACT_ADDRESS
  || process.env.VITE_NFA_ADDRESS
  || '';

const NFA_ABI = [
  'function agentPredictionTakePosition(uint256 tokenId, uint256 marketId, bool isYes, uint256 amount) external',
  'function agentPredictionClaimWinnings(uint256 tokenId, uint256 marketId) external',
  'function agentPredictionClaimRefund(uint256 tokenId, uint256 marketId) external',
  'function depositToPredictionMarket(uint256 tokenId, uint256 amount) external',
  'function withdrawFromPredictionMarketToAgent(uint256 tokenId, uint256 amount) external',
  'function predictionMarketBalances(uint256 tokenId) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getAgentBalance(uint256 tokenId) view returns (uint256)',
];

let wallet: ethers.Wallet | null = null;
let nfaContract: ethers.Contract | null = null;
let initialized = false;

export function initAgentChain(): boolean {
  const privateKey = process.env.AGENT_HOT_WALLET_KEY || '';
  if (!privateKey || !NFA_ADDRESS || !ethers.isAddress(NFA_ADDRESS)) {
    console.warn('[agent-chain] AGENT_HOT_WALLET_KEY or NFA_CONTRACT_ADDRESS not set, on-chain agent trading disabled');
    return false;
  }

  try {
    const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
    wallet = new ethers.Wallet(privateKey, provider);
    nfaContract = new ethers.Contract(NFA_ADDRESS, NFA_ABI, wallet);
    initialized = true;
    console.info(`[agent-chain] Initialized hot wallet: ${wallet.address}, NFA: ${NFA_ADDRESS}`);
    return true;
  } catch (err: any) {
    console.error('[agent-chain] Failed to initialize:', err.message);
    return false;
  }
}

export function isAgentChainEnabled(): boolean {
  return initialized && wallet !== null && nfaContract !== null;
}

export function getHotWalletAddress(): string | null {
  return wallet?.address || null;
}

/**
 * Check if the hot wallet owns the given NFA token and has sufficient PM balance.
 */
export async function checkAgentOnChainReady(tokenId: number): Promise<{
  ready: boolean;
  owner: string;
  pmBalance: bigint;
  reason?: string;
}> {
  if (!nfaContract || !wallet) {
    return { ready: false, owner: '', pmBalance: 0n, reason: 'Chain module not initialized' };
  }

  try {
    const [owner, pmBalance] = await Promise.all([
      nfaContract.ownerOf(tokenId) as Promise<string>,
      nfaContract.predictionMarketBalances(tokenId) as Promise<bigint>,
    ]);

    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      return { ready: false, owner, pmBalance, reason: `Token ${tokenId} owned by ${owner}, not hot wallet ${wallet.address}` };
    }

    return { ready: true, owner, pmBalance };
  } catch (err: any) {
    return { ready: false, owner: '', pmBalance: 0n, reason: err.message };
  }
}

/**
 * Execute agent buy on-chain via NFA contract.
 * Returns tx hash on success, null on failure.
 */
export async function executeAgentBuyOnChain(
  tokenId: number,
  onChainMarketId: number,
  isYes: boolean,
  amountUsdt: number,
): Promise<string | null> {
  if (!nfaContract) {
    console.error('[agent-chain] Not initialized');
    return null;
  }

  try {
    const amountWei = ethers.parseUnits(amountUsdt.toFixed(2), 18);

    const tx = await nfaContract.agentPredictionTakePosition(
      tokenId,
      onChainMarketId,
      isYes,
      amountWei,
    );

    console.info(`[agent-chain] Buy tx sent: ${tx.hash} (token=${tokenId}, market=${onChainMarketId}, ${isYes ? 'YES' : 'NO'}, $${amountUsdt})`);

    const receipt = await tx.wait();
    if (receipt?.status === 1) {
      console.info(`[agent-chain] Buy confirmed: ${tx.hash}`);
      return tx.hash;
    } else {
      console.error(`[agent-chain] Buy tx reverted: ${tx.hash}`);
      return null;
    }
  } catch (err: any) {
    console.error(`[agent-chain] Buy failed (token=${tokenId}, market=${onChainMarketId}):`, err.message);
    return null;
  }
}

/**
 * Claim agent winnings on-chain via NFA contract.
 * Returns tx hash on success, null on failure.
 */
export async function executeAgentClaimOnChain(
  tokenId: number,
  onChainMarketId: number,
): Promise<string | null> {
  if (!nfaContract) {
    console.error('[agent-chain] Not initialized');
    return null;
  }

  try {
    const tx = await nfaContract.agentPredictionClaimWinnings(tokenId, onChainMarketId);
    console.info(`[agent-chain] Claim tx sent: ${tx.hash} (token=${tokenId}, market=${onChainMarketId})`);

    const receipt = await tx.wait();
    if (receipt?.status === 1) {
      console.info(`[agent-chain] Claim confirmed: ${tx.hash}`);
      return tx.hash;
    } else {
      console.error(`[agent-chain] Claim tx reverted: ${tx.hash}`);
      return null;
    }
  } catch (err: any) {
    // NoWinningPosition is expected for losing trades, don't spam logs
    if (err.message?.includes('NoWinningPosition')) {
      return null;
    }
    console.error(`[agent-chain] Claim failed (token=${tokenId}, market=${onChainMarketId}):`, err.message);
    return null;
  }
}
