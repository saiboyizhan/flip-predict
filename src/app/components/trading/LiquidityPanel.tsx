"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { Droplets, Plus, Minus, Loader2, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import { parseUnits, formatUnits } from "viem";
import {
  useAddLiquidity,
  useRemoveLiquidity,
  useContractLpInfo,
  useContractBalance,
  useUsdtAllowance,
  useUsdtApprove,
  useTxNotifier,
} from "@/app/hooks/useContracts";
import { PREDICTION_MARKET_ADDRESS } from "@/app/config/contracts";

interface LiquidityPanelProps {
  marketId: string;
  onChainMarketId?: string;
  status: string;
  onLiquidityChange?: () => void;
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function LiquidityPanel({ marketId, onChainMarketId, status, onLiquidityChange }: LiquidityPanelProps) {
  const { t } = useTranslation();
  const { address } = useAccount();
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [expanded, setExpanded] = useState(false);

  const marketIdBigint = useMemo(() => {
    if (!onChainMarketId) return undefined;
    try { return BigInt(onChainMarketId); } catch { return undefined; }
  }, [onChainMarketId]);

  // Read on-chain LP info
  const {
    totalShares,
    userLpShares,
    poolValue,
    userValue,
    yesReserve,
    noReserve,
    isLoading: lpLoading,
    refetch: refetchLp,
  } = useContractLpInfo(marketIdBigint, address as `0x${string}` | undefined);

  // USDT wallet balance
  const { balanceUSDT: walletBalance } = useContractBalance(address as `0x${string}` | undefined);

  // USDT approval
  const { allowanceRaw } = useUsdtAllowance(address as `0x${string}` | undefined, PREDICTION_MARKET_ADDRESS);
  const {
    approve: usdtApprove,
    txHash: approveTxHash,
    isWriting: approveWriting,
    isConfirming: approveConfirming,
    isConfirmed: approveConfirmed,
    error: approveError,
    reset: approveReset,
  } = useUsdtApprove();

  // Add liquidity hook
  const {
    addLiquidity,
    txHash: addTxHash,
    isWriting: addWriting,
    isConfirming: addConfirming,
    isConfirmed: addConfirmed,
    error: addError,
    reset: addReset,
  } = useAddLiquidity();

  // Remove liquidity hook
  const {
    removeLiquidity,
    txHash: removeTxHash,
    isWriting: removeWriting,
    isConfirming: removeConfirming,
    isConfirmed: removeConfirmed,
    error: removeError,
    reset: removeReset,
  } = useRemoveLiquidity();

  useTxNotifier(approveTxHash, approveConfirming, approveConfirmed, approveError as Error | null, "USDT Approve");
  useTxNotifier(addTxHash, addConfirming, addConfirmed, addError as Error | null, "Add Liquidity");
  useTxNotifier(removeTxHash, removeConfirming, removeConfirmed, removeError as Error | null, "Remove Liquidity");

  // After approve confirms, add liquidity
  const [pendingAdd, setPendingAdd] = useState(false);
  useEffect(() => {
    if (approveConfirmed && pendingAdd && marketIdBigint) {
      setPendingAdd(false);
      approveReset();
      addLiquidity(marketIdBigint, amount);
    }
  }, [approveConfirmed, pendingAdd, marketIdBigint, amount, approveReset, addLiquidity]);

  // Refresh after add confirms
  useEffect(() => {
    if (addConfirmed && addTxHash) {
      addReset();
      refetchLp();
      toast.success(t('lp.addSuccess', 'Liquidity added successfully'));
      onLiquidityChange?.();
    }
  }, [addConfirmed, addTxHash, addReset, refetchLp, t, onLiquidityChange]);

  // Refresh after remove confirms
  useEffect(() => {
    if (removeConfirmed && removeTxHash) {
      removeReset();
      refetchLp();
      toast.success(t('lp.removeSuccess', 'Liquidity removed successfully'));
      onLiquidityChange?.();
    }
  }, [removeConfirmed, removeTxHash, removeReset, refetchLp, t, onLiquidityChange]);

  const isActive = status === "active";
  const isBusy = addWriting || addConfirming || removeWriting || removeConfirming || approveWriting || approveConfirming;

  const poolValueNum = Number(formatUnits(poolValue, 18));
  const yesReserveNum = Number(formatUnits(yesReserve, 18));
  const noReserveNum = Number(formatUnits(noReserve, 18));
  const userSharesNum = Number(formatUnits(userLpShares, 18));
  const userValueNum = Number(formatUnits(userValue, 18));
  const totalSharesNum = Number(formatUnits(totalShares, 18));
  const shareOfPool = totalSharesNum > 0 ? userSharesNum / totalSharesNum : 0;

  const handleSubmit = () => {
    const val = Number(amount);
    if (!val || val <= 0 || !marketIdBigint) return;

    if (mode === "add") {
      const amountWei = parseUnits(amount, 18);
      // Check allowance
      if (allowanceRaw < amountWei) {
        setPendingAdd(true);
        const maxUint256 = 2n ** 256n - 1n;
        usdtApprove(PREDICTION_MARKET_ADDRESS, maxUint256);
        return;
      }
      addLiquidity(marketIdBigint, amount);
    } else {
      const sharesWei = parseUnits(amount, 18);
      removeLiquidity(marketIdBigint, sharesWei);
    }
  };

  if (!onChainMarketId) return null;

  return (
    <div className="bg-card border border-white/[0.08] rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Droplets className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold">{t('lp.title', 'Liquidity Pool')}</span>
          <Zap className="w-3 h-3 text-blue-400" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">{formatUsd(poolValueNum)}</span>
          <span className="text-muted-foreground text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {lpLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Pool Stats */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white/[0.03] rounded-lg px-3 py-2">
                  <div className="text-muted-foreground">{t('lp.poolValue', 'Pool Value')}</div>
                  <div className="font-mono font-semibold">{formatUsd(poolValueNum)}</div>
                </div>
                <div className="bg-white/[0.03] rounded-lg px-3 py-2">
                  <div className="text-muted-foreground">{t('lp.totalLpShares', 'Total LP Shares')}</div>
                  <div className="font-mono font-semibold">{totalSharesNum.toFixed(2)}</div>
                </div>
                <div className="bg-white/[0.03] rounded-lg px-3 py-2">
                  <div className="text-muted-foreground">YES Reserve</div>
                  <div className="font-mono font-semibold text-emerald-400">{formatUsd(yesReserveNum)}</div>
                </div>
                <div className="bg-white/[0.03] rounded-lg px-3 py-2">
                  <div className="text-muted-foreground">NO Reserve</div>
                  <div className="font-mono font-semibold text-red-400">{formatUsd(noReserveNum)}</div>
                </div>
              </div>

              {/* User LP Position */}
              {userSharesNum > 0 && (
                <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{t('lp.yourShares', 'Your LP Shares')}</span>
                    <span className="font-mono font-semibold">{userSharesNum.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs mt-1">
                    <span className="text-muted-foreground">{t('lp.yourValue', 'Your Value')}</span>
                    <span className="font-mono font-semibold text-blue-400">{formatUsd(userValueNum)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs mt-1">
                    <span className="text-muted-foreground">{t('lp.poolShare', 'Pool Share')}</span>
                    <span className="font-mono font-semibold">{(shareOfPool * 100).toFixed(1)}%</span>
                  </div>
                </div>
              )}

              {/* Fee Info */}
              <div className="text-xs text-muted-foreground bg-white/[0.02] rounded-lg px-3 py-2">
                {t('lp.feeInfo', 'LP providers earn 80% of trading fees proportional to their share.')}
              </div>

              {/* Add/Remove Form */}
              {isActive && address && (
                <div className="space-y-2">
                  <div className="flex gap-1">
                    <button
                      onClick={() => setMode("add")}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        mode === "add"
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.06]"
                      }`}
                    >
                      <Plus className="w-3 h-3" />
                      {t('lp.add', 'Add')}
                    </button>
                    <button
                      onClick={() => setMode("remove")}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        mode === "remove"
                          ? "bg-red-500/15 text-red-400 border border-red-500/30"
                          : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.06]"
                      }`}
                    >
                      <Minus className="w-3 h-3" />
                      {t('lp.remove', 'Remove')}
                    </button>
                  </div>

                  {mode === "add" && (
                    <div className="text-xs text-muted-foreground">
                      Wallet: <span className="text-blue-400 font-mono">{parseFloat(walletBalance).toFixed(2)} USDT</span>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={mode === "add" ? "USDT amount" : "LP shares to burn"}
                      className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-blue-500/40"
                    />
                    <button
                      onClick={handleSubmit}
                      disabled={isBusy || !amount || Number(amount) <= 0}
                      className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('common.confirm', 'Confirm')}
                    </button>
                  </div>

                  {mode === "remove" && userSharesNum > 0 && (
                    <button
                      onClick={() => setAmount(userSharesNum.toFixed(4))}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      {t('lp.removeAll', 'Remove all')} ({userSharesNum.toFixed(2)} shares)
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
