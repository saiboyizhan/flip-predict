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
  'function getAutoTradeAuth(uint256 tokenId) view returns (tuple(bool authorized, address authorizedCaller, uint256 maxAmountPerTrade, uint256 maxDailyAmount, uint256 dailyUsed, uint256 lastResetDay, uint256 expiresAt))',
];

let wallet: ethers.Wallet | null = null;
let nfaContract: ethers.Contract | null = null;
let initialized = false;

export function initAgentChain(): boolean {
  if (!NFA_ADDRESS || !ethers.isAddress(NFA_ADDRESS)) {
    console.warn('[agent-chain] NFA_CONTRACT_ADDRESS not set, on-chain agent trading disabled');
    return false;
  }

  let privateKey = process.env.AGENT_HOT_WALLET_KEY || '';

  // Auto-generate a hot wallet if none is configured
  if (!privateKey) {
    const generated = ethers.Wallet.createRandom();
    privateKey = generated.privateKey;
    console.info(`[agent-chain] No AGENT_HOT_WALLET_KEY set, generated hot wallet: ${generated.address}`);
    console.info('[agent-chain] To persist this wallet, set AGENT_HOT_WALLET_KEY in your environment');
    console.info('[agent-chain] Users must call NFA.authorizeAutoTrade(tokenId, hotWalletAddress, ...) to grant trading permission');
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
 * Check if the hot wallet can trade for the given NFA token.
 * The hot wallet is ready if it either:
 *   1. Owns the token, OR
 *   2. Has been authorized via NFA.authorizeAutoTrade()
 */
export async function checkAgentOnChainReady(tokenId: number): Promise<{
  ready: boolean;
  owner: string;
  pmBalance: bigint;
  isAutoTrader: boolean;
  reason?: string;
}> {
  if (!nfaContract || !wallet) {
    return { ready: false, owner: '', pmBalance: 0n, isAutoTrader: false, reason: 'Chain module not initialized' };
  }

  try {
    const [owner, pmBalance] = await Promise.all([
      nfaContract.ownerOf(tokenId) as Promise<string>,
      nfaContract.predictionMarketBalances(tokenId) as Promise<bigint>,
    ]);

    // Case 1: hot wallet is the token owner
    if (owner.toLowerCase() === wallet.address.toLowerCase()) {
      return { ready: true, owner, pmBalance, isAutoTrader: false };
    }

    // Case 2: check on-chain auto-trade authorization
    try {
      const auth = await nfaContract.getAutoTradeAuth(tokenId);
      const authorized = auth.authorized;
      const caller = (auth.authorizedCaller as string).toLowerCase();
      const expiresAt = Number(auth.expiresAt);
      const now = Math.floor(Date.now() / 1000);

      if (authorized && caller === wallet.address.toLowerCase() && expiresAt > now) {
        return { ready: true, owner, pmBalance, isAutoTrader: true };
      }
    } catch {
      // getAutoTradeAuth may fail if token doesn't exist or contract mismatch
    }

    return {
      ready: false,
      owner,
      pmBalance,
      isAutoTrader: false,
      reason: `Token ${tokenId} owned by ${owner}, hot wallet ${wallet.address} is not owner and not authorized`,
    };
  } catch (err: any) {
    return { ready: false, owner: '', pmBalance: 0n, isAutoTrader: false, reason: err.message };
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
