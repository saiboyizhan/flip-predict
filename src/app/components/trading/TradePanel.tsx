"use client";

import { motion, AnimatePresence } from "motion/react";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { ArrowRight, TrendingUp, Coins, Target, Percent, AlertTriangle, Check, Loader2, Zap, ExternalLink, X, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAccount, useChainId } from "wagmi";
import { useTradeStore, calculateBuy, calculateSell, getEstimatedReturn, getPrice } from "@/app/stores/useTradeStore";
// Agent minting is now optional - users can trade without an agent
import { useTakePosition, useContractBalance, useUsdtAllowance, useUsdtApprove, useTxNotifier, getBscScanUrl } from "@/app/hooks/useContracts";
import { PREDICTION_MARKET_ADDRESS } from "@/app/config/contracts";
import { parseUnits } from "viem";
import type { MarketOption } from "@/app/types/market.types";

interface TradePanelProps {
  marketId: string;
  onChainMarketId?: string;
  marketTitle: string;
  status: "active" | "expiring" | "settled" | "pending_resolution" | "resolved" | "pending" | "closed" | "disputed";
  marketType?: "binary" | "multi";
  options?: MarketOption[];
  onTradeComplete?: () => void;
}

const QUICK_AMOUNTS = [10, 50, 100, 500];
const RISK_ACCEPTED_KEY = "prediction_risk_accepted";

export function TradePanel({ marketId, onChainMarketId, marketTitle, status, marketType, options, onTradeComplete }: TradePanelProps) {
  const { t } = useTranslation();
  const { address } = useAccount();
  const chainId = useChainId();
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [tradeMode, setTradeMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState<string>("100");
  const [showSuccess, setShowSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isMulti = marketType === "multi" && options && options.length >= 2;
  const [useOnChain, setUseOnChain] = useState(Boolean(onChainMarketId) && !isMulti);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(options?.[0]?.id ?? null);
  const [showRiskWarning, setShowRiskWarning] = useState(false);
  const pendingConfirmRef = useRef(false);

  useEffect(() => {
    if ((!onChainMarketId || isMulti) && useOnChain) {
      setUseOnChain(false);
    }
  }, [onChainMarketId, useOnChain, isMulti]);

  const selectedOption = isMulti ? options.find(o => o.id === selectedOptionId) : null;

  const { getOrCreatePool, executeAPIBuy, executeAPISell, executeAPIBuyMulti, executeAPISellMulti, getLMSRPreview } = useTradeStore();
  const pool = getOrCreatePool(marketId);

  // On-chain hooks
  const {
    takePosition,
    txHash: positionTxHash,
    isWriting: positionWriting,
    isConfirming: positionConfirming,
    isConfirmed: positionConfirmed,
    error: positionError,
    reset: positionReset,
  } = useTakePosition();

  const {
    balanceUSDT: contractBalance,
    refetch: refetchBalance,
  } = useContractBalance(address as `0x${string}` | undefined);

  // USDT approval hooks
  const {
    allowanceRaw: usdtAllowanceRaw,
    refetch: refetchAllowance,
  } = useUsdtAllowance(address as `0x${string}` | undefined, PREDICTION_MARKET_ADDRESS);

  const {
    approve: usdtApprove,
    txHash: approveTxHash,
    isWriting: approveWriting,
    isConfirming: approveConfirming,
    isConfirmed: approveConfirmed,
    error: approveError,
    reset: approveReset,
  } = useUsdtApprove();

  // Capture trade params at submission time via refs to avoid stale closures
  const tradeParamsRef = useRef({ marketId, side, amount, onChainMarketId: onChainMarketId ?? "" });
  const isMountedRef = useRef(true);

  // Cleanup on unmount to prevent state updates after unmount (P0-1 fix)
  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  // Tx lifecycle notifications
  useTxNotifier(
    positionTxHash,
    positionConfirming,
    positionConfirmed,
    positionError as Error | null,
    "Trade",
  );

  useTxNotifier(
    approveTxHash,
    approveConfirming,
    approveConfirmed,
    approveError as Error | null,
    "USDT Approve",
  );

  // After USDT approve confirms, proceed with takePosition
  useEffect(() => {
    if (approveConfirmed && approveTxHash && isMountedRef.current) {
      refetchAllowance();
      approveReset();
      // Now actually fire the takePosition call
      const params = tradeParamsRef.current;
      if (!params.onChainMarketId) return;
      try {
        const marketIdBigint = BigInt(params.onChainMarketId);
        takePosition(marketIdBigint, params.side === "yes", params.amount);
      } catch {
        if (isMountedRef.current) {
          toast.error(t('trade.invalidMarketId'));
        }
      }
    }
  }, [approveConfirmed, approveTxHash, refetchAllowance, approveReset, takePosition, t]);

  // After on-chain trade confirms
  useEffect(() => {
    if (positionConfirmed && positionTxHash && isMountedRef.current) {
      const params = tradeParamsRef.current;

      refetchBalance();
      if (isMountedRef.current) {
        setShowSuccess(true);
      }
      const scanUrl = getBscScanUrl(chainId);
      toast.success(
        t('trade.onChainConfirmed', { side: params.side.toUpperCase() }),
        {
          action: {
            label: t('trade.viewOnBscScan'),
            onClick: () => window.open(`${scanUrl}/tx/${positionTxHash}`, "_blank"),
          },
        },
      );
      if (isMountedRef.current) {
        setAmount("100");
      }
      const timerId = setTimeout(() => {
        if (isMountedRef.current) {
          setShowSuccess(false);
          positionReset();
        }
      }, 2000);
      return () => clearTimeout(timerId);
    }
  }, [positionConfirmed, positionTxHash, chainId, t, refetchBalance, positionReset]);

  const numAmount = parseFloat(amount) || 0;
  const currentPrice = getPrice(pool, side);

  const calculation = useMemo(() => {
    if (numAmount < 0.01) {
      return { shares: 0, avgPrice: 0, priceImpact: 0, potentialProfit: 0, roi: 0 };
    }

    try {
      if (tradeMode === "sell") {
        const sellResult = calculateSell(pool, side, numAmount);
        return {
          shares: numAmount,
          avgPrice: sellResult.avgPrice,
          priceImpact: sellResult.priceImpact,
          potentialProfit: sellResult.payout,
          roi: sellResult.avgPrice * 100,
        };
      }

      const buyResult = calculateBuy(pool, side, numAmount);
      const estimated = getEstimatedReturn(pool, side, numAmount);

      return {
        shares: buyResult.shares,
        avgPrice: buyResult.avgPrice,
        priceImpact: buyResult.priceImpact,
        potentialProfit: estimated.potentialProfit,
        roi: numAmount > 0 ? (estimated.potentialProfit / numAmount) * 100 : 0,
      };
    } catch {
      return { shares: 0, avgPrice: 0, priceImpact: 0, potentialProfit: 0, roi: 0 };
    }
  }, [pool, side, numAmount, tradeMode]);

  // On-chain trade handler (USDT: check allowance -> approve if needed -> takePosition)
  const handleOnChainTrade = useCallback(() => {
    if (numAmount <= 0 || positionWriting || positionConfirming || approveWriting || approveConfirming) return;
    if (isMulti) {
      toast.error("On-chain mode currently supports binary YES/NO markets only");
      return;
    }
    if (!onChainMarketId) {
      toast.error(t('trade.invalidMarketId'));
      return;
    }

    // Parse on-chain market ID for the contract
    let marketIdBigint: bigint;
    try {
      marketIdBigint = BigInt(onChainMarketId);
    } catch {
      toast.error(t('trade.invalidMarketId'));
      return;
    }

    const usdtBalance = parseFloat(contractBalance);
    if (numAmount > usdtBalance) {
      toast.error(t('trade.insufficientContractBalance', { balance: usdtBalance.toFixed(4) }));
      return;
    }

    // Capture current params before submitting
    tradeParamsRef.current = { marketId, side, amount, onChainMarketId };

    const amountWei = parseUnits(amount, 18);

    // Check USDT allowance: if not enough, approve first
    if (usdtAllowanceRaw < amountWei) {
      // Approve max uint256 to avoid repeated approvals
      const maxUint256 = 2n ** 256n - 1n;
      usdtApprove(PREDICTION_MARKET_ADDRESS, maxUint256);
      return;
    }

    // Allowance sufficient, proceed directly
    takePosition(marketIdBigint, side === "yes", amount);
  }, [numAmount, isMulti, onChainMarketId, marketId, side, amount, contractBalance, takePosition, t, usdtAllowanceRaw, usdtApprove, approveWriting, approveConfirming, positionWriting, positionConfirming]);

  const executeTradeInternal = useCallback(async () => {
    if (numAmount <= 0 || isSubmitting) return;

    // If on-chain mode is enabled and we're buying, use the contract
    if (useOnChain && tradeMode === "buy") {
      handleOnChainTrade();
      return;
    }
    // Prevent accidental fallback to API sell when user selected on-chain mode
    if (useOnChain && tradeMode === "sell") {
      toast.error(t('trade.onChainSellNotSupported'));
      return;
    }

    setIsSubmitting(true);
    try {
      let result: any;

      if (isMulti && selectedOptionId) {
        result = tradeMode === "buy"
          ? await executeAPIBuyMulti(marketId, selectedOptionId, numAmount)
          : await executeAPISellMulti(marketId, selectedOptionId, numAmount);
      } else {
        result = tradeMode === "buy"
          ? await executeAPIBuy(marketId, side, numAmount)
          : await executeAPISell(marketId, side, numAmount);
      }

      if (result.success) {
        setShowSuccess(true);
        const label = isMulti && selectedOption ? selectedOption.label : side.toUpperCase();
        if (tradeMode === "buy") {
          toast.success(
            t('trade.buySuccess', { shares: result.shares.toFixed(2), side: label, price: result.price.toFixed(4) }),
          );
          setAmount("100");
        } else {
          toast.success(
            t('trade.sellSuccess', {
              shares: numAmount.toFixed(2),
              side: label,
              price: result.price.toFixed(4),
            }),
          );
          setAmount("10");
        }
        setTimeout(() => setShowSuccess(false), 1500);
        // Notify parent to refresh market data (price, volume, chart)
        onTradeComplete?.();
      } else {
        const message = result.error === 'API_UNAVAILABLE'
          ? 'Backend unavailable. Trade execution is disabled until API reconnects.'
          : (result.error || t('trade.tradeFailed'));
        toast.error(message);
      }
    } catch {
      toast.error(t('trade.tradeFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [numAmount, isSubmitting, executeAPIBuy, executeAPISell, executeAPIBuyMulti, executeAPISellMulti, marketId, selectedOptionId, side, t, tradeMode, useOnChain, handleOnChainTrade, isMulti, selectedOption]);

  const handleConfirm = useCallback(() => {
    if (numAmount <= 0 || isSubmitting) return;

    // Check if user already accepted risk warning
    const accepted = localStorage.getItem(RISK_ACCEPTED_KEY);
    if (!accepted) {
      pendingConfirmRef.current = true;
      setShowRiskWarning(true);
      return;
    }

    executeTradeInternal();
  }, [numAmount, isSubmitting, executeTradeInternal]);

  const handleRiskAccept = useCallback(() => {
    localStorage.setItem(RISK_ACCEPTED_KEY, "1");
    setShowRiskWarning(false);
    if (pendingConfirmRef.current) {
      pendingConfirmRef.current = false;
      executeTradeInternal();
    }
  }, [executeTradeInternal]);

  const handleRiskCancel = useCallback(() => {
    setShowRiskWarning(false);
    pendingConfirmRef.current = false;
  }, []);

  const isOnChainBusy = positionWriting || positionConfirming || approveWriting || approveConfirming;
  const tradingDisabled = status !== "active" && status !== "expiring";
  const isDisabled = tradingDisabled || numAmount <= 0 || isSubmitting || (useOnChain && tradeMode === "buy" && isOnChainBusy);
  const sideTextClass = side === "yes" ? "text-emerald-400" : "text-red-400";
  const sideButtonClass = side === "yes" ? "bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-500/20" : "bg-red-500 hover:bg-red-400 text-white shadow-lg shadow-red-500/20";

  const priceImpactColor =
    calculation.priceImpact > 10
      ? "text-red-400"
      : calculation.priceImpact > 5
        ? "text-yellow-400"
        : "text-muted-foreground";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card/80 backdrop-blur-xl border border-white/[0.06] overflow-hidden relative"
    >
      {/* Decorative blur */}
      <div className="absolute top-0 right-0 w-48 h-48 bg-blue-500/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl pointer-events-none" />

      {/* Option Selection */}
      {isMulti ? (
        <div className="flex flex-col gap-1 p-2 bg-secondary/30">
          <div className="text-xs text-muted-foreground px-2 py-1 uppercase tracking-wider">
            {t('market.selectOption')}
          </div>
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setSelectedOptionId(opt.id)}
              className={`flex items-center justify-between px-4 py-3 transition-all ${
                selectedOptionId === opt.id
                  ? "border-l-4 bg-card"
                  : "border-l-4 border-transparent hover:bg-card/50"
              }`}
              style={{
                borderLeftColor: selectedOptionId === opt.id ? opt.color : 'transparent',
              }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: opt.color }}
                />
                <span className={`font-semibold text-sm ${selectedOptionId === opt.id ? "text-foreground" : "text-muted-foreground"}`}>
                  {opt.label}
                </span>
              </div>
              <span className="font-mono text-sm" style={{ color: opt.color }}>
                {(opt.price * 100).toFixed(1)}%
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2">
          <button
            onClick={() => setSide("yes")}
            aria-label="Select YES side"
            aria-pressed={side === "yes"}
            className={`py-2.5 text-center font-bold text-sm tracking-wide uppercase transition-all ${
              side === "yes"
                ? "bg-emerald-500 text-white"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {t('market.yes')}
          </button>
          <button
            onClick={() => setSide("no")}
            aria-label="Select NO side"
            aria-pressed={side === "no"}
            className={`py-2.5 text-center font-bold text-sm tracking-wide uppercase transition-all ${
              side === "no"
                ? "bg-red-500 text-white"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {t('market.no')}
          </button>
        </div>
      )}

      {/* Buy/Sell Tabs */}
      <div className="grid grid-cols-2 border-t border-border">
        <button
          onClick={() => setTradeMode("buy")}
          className={`py-2 text-xs font-bold transition-colors ${
            tradeMode === "buy"
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-secondary text-muted-foreground hover:text-foreground"
          }`}
        >
          {t('trade.buy')}
        </button>
        <button
          onClick={() => setTradeMode("sell")}
          className={`py-2 text-xs font-bold transition-colors ${
            tradeMode === "sell"
              ? "bg-red-500/20 text-red-400"
              : "bg-secondary text-muted-foreground hover:text-foreground"
          }`}
        >
          {t('trade.sell')}
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${side}-${tradeMode}`}
          initial={{ opacity: 0, x: side === "yes" ? -20 : 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: side === "yes" ? 20 : -20 }}
          transition={{ duration: 0.2 }}
          className="p-4 space-y-4"
        >
          {/* On-Chain Toggle (only when market is deployed on-chain) */}
          {tradeMode === "buy" && onChainMarketId && !isMulti && (
            <div className="flex items-center justify-between p-2 bg-secondary/50 border border-border/50">
              <div className="flex items-center gap-1.5">
                <Zap className={`w-3 h-3 ${useOnChain ? "text-blue-400" : "text-muted-foreground"}`} />
                <span className={`text-xs font-semibold ${useOnChain ? "text-blue-400" : "text-muted-foreground"}`}>
                  {t('trade.onChainTrade')}
                </span>
              </div>
              <button
                onClick={() => onChainMarketId && !isMulti && setUseOnChain(!useOnChain)}
                role="switch"
                aria-checked={useOnChain}
                aria-label={t('trade.onChainTrade')}
                disabled={!onChainMarketId || isMulti}
                className={`relative w-9 h-5 rounded-full transition-colors ${
                  useOnChain ? "bg-blue-500" : "bg-muted"
                }`}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                    useOnChain ? "left-0.5" : "left-0.5"
                  }`}
                  style={{ transform: useOnChain ? "translateX(17px)" : "translateX(0)" }}
                />
              </button>
            </div>
          )}

          {/* On-chain balance info */}
          {useOnChain && tradeMode === "buy" && (
            <div className="text-xs text-muted-foreground px-1">
              {t('trade.contractBalance')}: <span className="text-blue-400 font-mono">{parseFloat(contractBalance).toFixed(4)} USDT</span>
            </div>
          )}

          {/* Current Price */}
          <div className="text-center py-2 bg-gradient-to-b from-white/[0.03] to-transparent border border-white/[0.06] rounded-lg">
            <div className="text-[10px] text-muted-foreground tracking-wider uppercase mb-0.5">
              {t('trade.currentPrice', { side: side === "yes" ? "YES" : "NO" })}
            </div>
            <div className={`text-2xl font-bold font-mono ${sideTextClass}`}>
              ${currentPrice.toFixed(2)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {t('trade.probability', { pct: Math.round(currentPrice * 100) })}
            </div>
          </div>

          {/* Amount Input */}
          <div>
            <label className="block text-muted-foreground text-[10px] tracking-wider uppercase mb-1.5">
              {tradeMode === "buy"
                ? (useOnChain ? t('trade.amountBnb') : t('trade.tradeAmount'))
                : t('trade.sellShares')}
            </label>
            <div className="relative">
              {tradeMode === "buy" && !useOnChain && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-base">
                  $
                </span>
              )}
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`w-full bg-input-background border border-border text-foreground text-lg font-bold py-2.5 ${tradeMode === "buy" && !useOnChain ? "pl-7" : "pl-3"} pr-3 focus:outline-none focus:border-blue-500/50 transition-colors`}
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Quick Amount Buttons */}
          {!useOnChain && (
            <div className="grid grid-cols-4 gap-1.5">
              {QUICK_AMOUNTS.map((quickAmount) => (
                <button
                  key={quickAmount}
                  onClick={() => setAmount(quickAmount.toString())}
                  className={`py-1.5 border text-xs rounded-full transition-all hover:scale-105 ${
                    amount === quickAmount.toString()
                      ? "bg-blue-500/10 border-blue-500/50 text-blue-400"
                      : "bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground"
                  }`}
                >
                  ${quickAmount}
                </button>
              ))}
            </div>
          )}

          {/* On-chain quick USDT amounts */}
          {useOnChain && tradeMode === "buy" && (
            <div className="grid grid-cols-4 gap-1.5">
              {[1, 5, 10, 50].map((usdtAmt) => (
                <button
                  key={usdtAmt}
                  onClick={() => setAmount(usdtAmt.toString())}
                  className={`py-1.5 border text-xs rounded-full transition-all hover:scale-105 ${
                    amount === usdtAmt.toString()
                      ? "bg-blue-500/10 border-blue-500/50 text-blue-400"
                      : "bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {usdtAmt} USDT
                </button>
              ))}
            </div>
          )}

          {/* Calculation Breakdown */}
          {!useOnChain && (
            <div className="space-y-2 pt-3 border-t border-border">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  <Coins className="w-3 h-3" />
                  <span>{tradeMode === "buy" ? t('trade.estCost') : t('trade.shares')}</span>
                </div>
                <span className="text-foreground font-mono text-xs">
                  {tradeMode === "buy" ? `$${numAmount.toFixed(2)}` : numAmount.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  <Target className="w-3 h-3" />
                  <span>{tradeMode === "buy" ? t('trade.estShares') : t('trade.estPayout')}</span>
                </div>
                <span className="text-foreground font-mono text-xs">
                  {tradeMode === "buy" ? calculation.shares.toFixed(2) : `$${calculation.potentialProfit.toFixed(2)}`}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  <Coins className="w-3 h-3" />
                  <span>{t('trade.avgPrice')}</span>
                </div>
                <span className="text-foreground font-mono text-xs">
                  ${calculation.avgPrice.toFixed(4)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  <AlertTriangle className={`w-3 h-3 ${priceImpactColor}`} />
                  <span className={priceImpactColor}>{t('trade.priceImpact')}</span>
                </div>
                <span className={`font-mono text-xs ${priceImpactColor}`}>
                  {calculation.priceImpact.toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-border">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Percent className={`w-3 h-3 ${sideTextClass}`} />
                  <span className={sideTextClass}>
                    {tradeMode === "buy" ? t('trade.returnRate') : t('trade.avgExitPrice')}
                  </span>
                </div>
                <span className={`${sideTextClass} font-mono text-sm font-bold`}>
                  {tradeMode === "buy" ? `+${calculation.roi.toFixed(1)}%` : `$${calculation.avgPrice.toFixed(4)}`}
                </span>
              </div>
            </div>
          )}

          {/* On-chain trade info */}
          {useOnChain && tradeMode === "buy" && (
            <div className="space-y-3 pt-4 border-t border-border">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-sm">{t('trade.amountBnb')}</span>
                <span className="text-foreground font-mono">{numAmount} USDT</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-sm">{side.toUpperCase()}</span>
                <span className={`font-mono font-bold ${sideTextClass}`}>{side.toUpperCase()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-sm">Market ID</span>
                <span className="text-foreground font-mono text-xs">{onChainMarketId ?? "N/A"}</span>
              </div>
              <div className="p-2 bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400">
                {t('trade.onChainInfo')}
              </div>
            </div>
          )}

          {/* On-chain tx status */}
          {useOnChain && positionTxHash && (
            <div className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/30 text-sm">
              {positionConfirming ? (
                <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              ) : positionConfirmed ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : null}
              <a
                href={`${getBscScanUrl(chainId)}/tx/${positionTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 font-mono text-xs underline flex items-center gap-1"
              >
                {positionTxHash.slice(0, 12)}...{positionTxHash.slice(-8)}
                <ExternalLink className="w-3 h-3" />
              </a>
              <span className="text-muted-foreground text-xs ml-auto">
                {positionConfirming ? t('trade.txConfirming') : positionConfirmed ? t('trade.txConfirmed') : t('trade.txSubmitted')}
              </span>
            </div>
          )}

          {/* On-chain error */}
          {useOnChain && positionError && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {(positionError as Error).message?.includes("User rejected")
                ? t('trade.txCancelledByUser')
                : (positionError as Error).message?.slice(0, 150) || t('trade.txFailed')}
            </div>
          )}

          {/* Price Impact Warning */}
          {!useOnChain && calculation.priceImpact > 5 && (
            <div
              className={`flex items-center gap-2 px-4 py-3 text-sm ${
                calculation.priceImpact > 10
                  ? "bg-red-500/10 border border-red-500/30 text-red-400"
                  : "bg-yellow-500/10 border border-yellow-500/30 text-yellow-400"
              }`}
            >
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>
                {calculation.priceImpact > 10
                  ? t('trade.highImpactWarning')
                  : t('trade.moderateImpactWarning')}
              </span>
            </div>
          )}

          {/* Confirm Button */}
          <div className="relative">
            <button
              onClick={handleConfirm}
              disabled={isDisabled}
              className={`w-full py-2.5 font-bold text-sm tracking-wide uppercase transition-all duration-300 flex items-center justify-center gap-2 group disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed hover:scale-[1.02] ${
                useOnChain && tradeMode === "buy" ? "bg-blue-500 hover:bg-blue-400 text-white" : sideButtonClass
              }`}
            >
              {tradingDisabled ? (
                t('trade.marketSettled')
              ) : isSubmitting || (useOnChain && tradeMode === "buy" && isOnChainBusy) ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {approveWriting || approveConfirming
                    ? 'Approving USDT...'
                    : positionConfirming
                      ? t('trade.confirmingOnChain')
                      : positionWriting
                        ? t('trade.confirmInWallet')
                        : t('trade.processing')}
                </>
              ) : (
                <>
                  {useOnChain && tradeMode === "buy" && <Zap className="w-5 h-5" />}
                  {tradeMode === "buy"
                    ? (useOnChain
                        ? t('trade.onChainBuy', { side: side.toUpperCase() })
                        : t('trade.confirmBuy', { side: side.toUpperCase() }))
                    : t('trade.confirmSell', { side: side.toUpperCase() })}
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>

            {/* Success Checkmark Overlay */}
            <AnimatePresence>
              {showSuccess && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex items-center justify-center bg-emerald-500"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", bounce: 0.5 }}
                  >
                    <Check className="w-8 h-8 text-white" strokeWidth={3} />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Disclaimer */}
          <p className="text-muted-foreground text-xs text-center leading-relaxed px-2">
            {useOnChain && tradeMode === "buy"
              ? t('trade.onChainDisclaimer')
              : t('trade.disclaimer')}
          </p>
        </motion.div>
      </AnimatePresence>

      {/* Risk Warning Modal */}
      <AnimatePresence>
        {showRiskWarning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={handleRiskCancel}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: "spring", duration: 0.4 }}
              className="relative bg-card border border-amber-500/30 shadow-2xl shadow-amber-500/10 max-w-md w-full mx-4 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                onClick={handleRiskCancel}
                className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Warning icon */}
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
                  <ShieldAlert className="w-8 h-8 text-amber-400" />
                </div>
              </div>

              {/* Title */}
              <h3 className="text-lg font-bold text-foreground text-center mb-3">
                {t('trade.riskWarningTitle', { defaultValue: 'Risk Warning' })}
              </h3>

              {/* Content */}
              <p className="text-muted-foreground text-sm text-center leading-relaxed mb-6">
                {t('trade.riskWarningMessage', {
                  defaultValue: 'Prediction markets involve risk, and you may lose all of your invested capital. Please confirm you understand the risks before proceeding.',
                })}
              </p>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleRiskCancel}
                  className="flex-1 py-3 border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 font-semibold text-sm transition-colors"
                >
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </button>
                <button
                  onClick={handleRiskAccept}
                  className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm transition-colors"
                >
                  {t('trade.riskAccept', { defaultValue: 'I Understand, Continue' })}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
