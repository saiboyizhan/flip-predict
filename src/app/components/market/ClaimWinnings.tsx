"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Trophy, CheckCircle2, Frown, Loader2, Zap, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAccount, useChainId } from "wagmi";
import { claimWinnings } from "@/app/services/api";
import { useClaimWinnings as useContractClaim, useTxNotifier, getBscScanUrl, useTokenBalance } from "@/app/hooks/useContracts";

interface ClaimWinningsProps {
  marketId: string;
  onChainMarketId?: string;
  outcome: string;
  userPosition?: {
    side: string;
    shares: number;
    avgCost: number;
  };
}

export function ClaimWinnings({
  marketId,
  onChainMarketId,
  outcome,
  userPosition,
}: ClaimWinningsProps) {
  const { t } = useTranslation();
  const { address } = useAccount();
  const chainId = useChainId();
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [claimedAmount, setClaimedAmount] = useState<number | null>(null);
  const normalizedOutcome = outcome.toLowerCase();
  const isBinaryOutcome = normalizedOutcome === "yes" || normalizedOutcome === "no";
  const [useOnChain, setUseOnChain] = useState(Boolean(onChainMarketId) && isBinaryOutcome);

  // Refs to capture values at submission time
  const claimParamsRef = useRef({ marketId, estimatedWinnings: 0 });

  useEffect(() => {
    if ((!onChainMarketId || !isBinaryOutcome) && useOnChain) {
      setUseOnChain(false);
    }
  }, [onChainMarketId, isBinaryOutcome, useOnChain]);

  // On-chain claim hook
  const {
    claimWinnings: contractClaim,
    txHash: claimTxHash,
    isWriting: claimWriting,
    isConfirming: claimConfirming,
    isConfirmed: claimConfirmed,
    error: claimError,
    reset: claimReset,
  } = useContractClaim();

  // Tx lifecycle notifications
  useTxNotifier(
    claimTxHash,
    claimConfirming,
    claimConfirmed,
    claimError as Error | null,
    "Claim",
  );

  // CTF: compute winning token ID and check on-chain balance
  const winningTokenId = (() => {
    if (!onChainMarketId || !outcome || !isBinaryOutcome) return undefined;
    try {
      const mid = BigInt(onChainMarketId);
      return normalizedOutcome === "yes" ? mid * 2n : mid * 2n + 1n;
    } catch {
      return undefined;
    }
  })();

  const { balanceRaw: onChainWinningBalance } = useTokenBalance(
    address as `0x${string}` | undefined,
    winningTokenId,
  );

  const hasOnChainPosition = onChainWinningBalance != null && onChainWinningBalance > 0n;

  // After on-chain claim confirms
  useEffect(() => {
    if (claimConfirmed && claimTxHash) {
      const params = claimParamsRef.current;
      setClaimed(true);
      setClaimedAmount(params.estimatedWinnings);
      const scanUrl = getBscScanUrl(chainId);
      toast.success(t('claim.claimedOnChain'), {
        action: {
          label: t('trade.viewOnBscScan'),
          onClick: () => window.open(`${scanUrl}/tx/${claimTxHash}`, "_blank"),
        },
      });
      claimWinnings(params.marketId).catch(() => {
        toast.error(t('claim.syncFailed'));
      });
      claimReset();
    }
  }, [claimConfirmed, claimTxHash, chainId, t, claimReset]);

  if (!outcome) return null;

  // No position at all (neither backend nor on-chain)
  if (!userPosition && !hasOnChainPosition) return null;

  const winningSide = outcome.toLowerCase();
  const userWon = hasOnChainPosition || (userPosition ? userPosition.side.toLowerCase() === winningSide : false);

  // User lost (only show when user has a non-winning backend position)
  if (!userWon && userPosition) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card border border-border p-6"
      >
        <div className="flex items-center gap-3 mb-3">
          <Frown className="w-6 h-6 text-muted-foreground" />
          <h3 className="text-lg font-bold text-muted-foreground">{t('claim.missedTitle')}</h3>
        </div>
        <p className="text-muted-foreground text-sm">
          {t('claim.missedDesc')}
        </p>
        <div className="mt-3 text-xs text-muted-foreground">
          {t('claim.yourPosition')}: {userPosition.shares} shares @ $
          {userPosition.avgCost.toFixed(2)}
        </div>
      </motion.div>
    );
  }
  if (!userWon) return null;

  // Use on-chain balance if available, fallback to userPosition
  const onChainShares = hasOnChainPosition ? Number(onChainWinningBalance) / 1e18 : 0;
  const shares = userPosition ? userPosition.shares : onChainShares;
  const avgCost = userPosition ? userPosition.avgCost : 1.0;
  const estimatedWinnings = shares * 1.0;
  const profit = estimatedWinnings - shares * avgCost;

  async function handleClaim() {
    if (useOnChain) {
      if (!isBinaryOutcome) {
        toast.error(t("claim.binaryOnly", "链上领取目前仅支持二元 (YES/NO) 市场"));
        return;
      }
      if (!onChainMarketId) {
        toast.error(t('trade.invalidMarketId'));
        return;
      }
      // On-chain claim
      let marketIdBigint: bigint;
      try {
        marketIdBigint = BigInt(onChainMarketId);
      } catch {
        toast.error(t('trade.invalidMarketId'));
        return;
      }
      // Capture current values before submitting
      claimParamsRef.current = { marketId, estimatedWinnings };
      contractClaim(marketIdBigint);
      return;
    }

    // API claim (existing flow)
    setClaiming(true);
    try {
      const result = await claimWinnings(marketId);
      if (result.success) {
        setClaimed(true);
        setClaimedAmount(result.amount ?? estimatedWinnings);
        toast.success(t('claim.claimSuccess'));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('claim.claimFailed');
      toast.error(message);
    } finally {
      setClaiming(false);
    }
  }

  const isClaimBusy = claiming || claimWriting || claimConfirming;

  // Already claimed
  if (claimed) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-card border border-border p-6"
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-6 h-6 text-muted-foreground" />
          <span className="text-muted-foreground font-bold">
            {t('claim.claimed', { amount: (claimedAmount ?? estimatedWinnings).toFixed(2) })}
          </span>
        </div>
        {claimTxHash && (
          <a
            href={`${getBscScanUrl(chainId)}/tx/${claimTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 text-blue-400 hover:text-blue-300 text-xs font-mono inline-flex items-center gap-1"
          >
            {claimTxHash.slice(0, 16)}...{claimTxHash.slice(-8)}
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </motion.div>
    );
  }

  // Can claim
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative bg-card border-2 border-emerald-500/50 p-6 overflow-hidden"
      >
        {/* Glow effect */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent pointer-events-none" />

        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <Trophy className="w-6 h-6 text-emerald-400" />
            <h3 className="text-lg font-bold text-emerald-400">
              {t('claim.congratulations')}
            </h3>
          </div>

          <div className="space-y-2 mb-4 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>{t('claim.yourPosition')}</span>
              <span className="font-mono text-foreground">
                {shares} shares @ ${avgCost.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>{t('claim.estWinnings')}</span>
              <span className="font-mono text-emerald-400 font-bold">
                ${estimatedWinnings.toFixed(2)}
              </span>
            </div>
            {profit > 0 && (
              <div className="flex justify-between text-muted-foreground text-xs">
                <span>{t('claim.profit')}</span>
                <span className="font-mono text-emerald-400">
                  +${profit.toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* On-chain toggle */}
          <div className="flex items-center justify-between p-3 mb-4 bg-secondary/50 border border-border/50">
            <div className="flex items-center gap-2">
              <Zap className={`w-4 h-4 ${useOnChain ? "text-blue-400" : "text-muted-foreground"}`} />
              <span className={`text-sm ${useOnChain ? "text-blue-400" : "text-muted-foreground"}`}>
                {onChainMarketId && isBinaryOutcome ? t('claim.claimOnChain') : `${t('claim.claimOnChain')} (N/A)`}
              </span>
            </div>
            <button
              onClick={() => onChainMarketId && isBinaryOutcome && setUseOnChain(!useOnChain)}
              disabled={!onChainMarketId || !isBinaryOutcome}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                useOnChain ? "bg-blue-500" : "bg-switch-background"
              }`}
            >
              <div
                className="absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform left-0.5"
                style={{ transform: useOnChain ? "translateX(22px)" : "translateX(0)" }}
              />
            </button>
          </div>

          {/* On-chain tx status */}
          {claimTxHash && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-blue-500/10 border border-blue-500/30 text-sm">
              {claimConfirming ? (
                <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              ) : claimConfirmed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : null}
              <a
                href={`${getBscScanUrl(chainId)}/tx/${claimTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 font-mono text-xs underline flex items-center gap-1"
              >
                {claimTxHash.slice(0, 12)}...{claimTxHash.slice(-8)}
                <ExternalLink className="w-3 h-3" />
              </a>
              <span className="text-muted-foreground text-xs ml-auto">
                {claimConfirming ? t('trade.txConfirming') : claimConfirmed ? t('trade.txConfirmed') : t('trade.txSubmitted')}
              </span>
            </div>
          )}

          {/* On-chain error */}
          {claimError && (
            <div className="p-3 mb-4 bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {(claimError as Error).message?.includes("User rejected")
                ? t('trade.txCancelledByUser')
                : (claimError as Error).message?.slice(0, 150) || t('claim.claimFailed')}
            </div>
          )}

          <button
            onClick={handleClaim}
            disabled={isClaimBusy}
            className={`w-full py-3 font-bold text-sm tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
              useOnChain
                ? "bg-blue-500 hover:bg-blue-600 text-white"
                : "bg-emerald-500 hover:bg-emerald-600 text-black"
            }`}
          >
            {isClaimBusy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {claimConfirming ? t('trade.confirmingOnChain') : claimWriting ? t('trade.confirmInWallet') : t('claim.claiming')}
              </>
            ) : (
              <>
                {useOnChain && <Zap className="w-4 h-4" />}
                {useOnChain ? t('claim.claimOnChain') : t('claim.claimWinnings')}
              </>
            )}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
