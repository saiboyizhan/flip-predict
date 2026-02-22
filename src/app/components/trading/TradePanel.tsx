"use client";

import { motion, AnimatePresence } from "motion/react";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { ArrowRight, TrendingUp, Coins, Target, Percent, AlertTriangle, Check, Loader2, Zap, ExternalLink, X, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAccount, useChainId } from "wagmi";
import { useTradeStore } from "@/app/stores/useTradeStore";
import { useBuy, useSell, useContractBalance, useUsdtAllowance, useUsdtApprove, useTxNotifier, getBscScanUrl, useContractPrice, usePlaceLimitOrder, useIsApprovedForAll, useErc1155Approval } from "@/app/hooks/useContracts";
import { PREDICTION_MARKET_ADDRESS } from "@/app/config/contracts";
import { parseUnits, formatUnits } from "viem";
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
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(options?.[0]?.id ?? null);
  const [showRiskWarning, setShowRiskWarning] = useState(false);
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState<string>("0.50");
  const pendingConfirmRef = useRef(false);

  const selectedOption = isMulti ? options.find(o => o.id === selectedOptionId) : null;


  // On-chain market ID
  const marketIdBigint = useMemo(() => {
    if (!onChainMarketId) return undefined;
    try { return BigInt(onChainMarketId); } catch { return undefined; }
  }, [onChainMarketId]);

  // Read on-chain price
  const { yesPrice: onChainYesPrice, noPrice: onChainNoPrice } = useContractPrice(marketIdBigint);
  const currentPrice = side === "yes" ? onChainYesPrice : onChainNoPrice;

  // On-chain buy/sell hooks
  const {
    buy,
    txHash: buyTxHash,
    isWriting: buyWriting,
    isConfirming: buyConfirming,
    isConfirmed: buyConfirmed,
    error: buyError,
    reset: buyReset,
  } = useBuy();

  const {
    sell,
    txHash: sellTxHash,
    isWriting: sellWriting,
    isConfirming: sellConfirming,
    isConfirmed: sellConfirmed,
    error: sellError,
    reset: sellReset,
  } = useSell();

  // Limit order hooks
  const {
    placeLimitOrder,
    txHash: limitTxHash,
    isWriting: limitWriting,
    isConfirming: limitConfirming,
    isConfirmed: limitConfirmed,
    error: limitError,
    reset: limitReset,
  } = usePlaceLimitOrder();

  const {
    isApproved: erc1155Approved,
    refetch: refetchErc1155Approval,
  } = useIsApprovedForAll(address as `0x${string}` | undefined, PREDICTION_MARKET_ADDRESS);

  const {
    setApprovalForAll: erc1155Approve,
    txHash: erc1155ApproveTxHash,
    isWriting: erc1155ApproveWriting,
    isConfirming: erc1155ApproveConfirming,
    isConfirmed: erc1155ApproveConfirmed,
    error: erc1155ApproveError,
    reset: erc1155ApproveReset,
  } = useErc1155Approval();

  const activeTxHash = orderType === "limit" ? limitTxHash : (tradeMode === "buy" ? buyTxHash : sellTxHash);
  const activeWriting = orderType === "limit" ? limitWriting : (tradeMode === "buy" ? buyWriting : sellWriting);
  const activeConfirming = orderType === "limit" ? limitConfirming : (tradeMode === "buy" ? buyConfirming : sellConfirming);
  const activeConfirmed = orderType === "limit" ? limitConfirmed : (tradeMode === "buy" ? buyConfirmed : sellConfirmed);
  const activeError = orderType === "limit" ? limitError : (tradeMode === "buy" ? buyError : sellError);
  const activeReset = orderType === "limit" ? limitReset : (tradeMode === "buy" ? buyReset : sellReset);

  // USDT wallet balance
  const {
    balanceUSDT: walletBalance,
    refetch: refetchBalance,
  } = useContractBalance(address as `0x${string}` | undefined);

  // USDT approval
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

  const tradeParamsRef = useRef({ marketId, side, amount, onChainMarketId: onChainMarketId ?? "", tradeMode });
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  // Tx lifecycle notifications
  useTxNotifier(activeTxHash, activeConfirming, activeConfirmed, activeError as Error | null, orderType === "limit" ? "Limit Order" : (tradeMode === "buy" ? "Buy" : "Sell"));
  useTxNotifier(approveTxHash, approveConfirming, approveConfirmed, approveError as Error | null, "USDT Approve");
  useTxNotifier(erc1155ApproveTxHash, erc1155ApproveConfirming, erc1155ApproveConfirmed, erc1155ApproveError as Error | null, "ERC1155 Approve");

  // After ERC1155 approval confirms, proceed with limit sell
  useEffect(() => {
    if (erc1155ApproveConfirmed && erc1155ApproveTxHash && isMountedRef.current) {
      refetchErc1155Approval();
      erc1155ApproveReset();
      const params = tradeParamsRef.current;
      if (!params.onChainMarketId) return;
      try {
        const mid = BigInt(params.onChainMarketId);
        // OrderSide: SELL_YES=2, SELL_NO=3
        const orderSideEnum = params.side === "yes" ? 2 : 3;
        const priceWei = parseUnits(limitPrice, 18);
        const amountWei = parseUnits(params.amount, 18);
        placeLimitOrder(mid, orderSideEnum, priceWei, amountWei);
      } catch {
        if (isMountedRef.current) toast.error(t('trade.invalidMarketId'));
      }
    }
  }, [erc1155ApproveConfirmed, erc1155ApproveTxHash, refetchErc1155Approval, erc1155ApproveReset, placeLimitOrder, limitPrice, t]);

  // After USDT approve confirms, proceed with buy
  useEffect(() => {
    if (approveConfirmed && approveTxHash && isMountedRef.current) {
      refetchAllowance();
      approveReset();
      const params = tradeParamsRef.current;
      if (!params.onChainMarketId) return;
      try {
        const mid = BigInt(params.onChainMarketId);
        if (params.tradeMode === "buy") {
          buy(mid, params.side === "yes", params.amount);
        }
      } catch {
        if (isMountedRef.current) toast.error(t('trade.invalidMarketId'));
      }
    }
  }, [approveConfirmed, approveTxHash, refetchAllowance, approveReset, buy, t]);

  // After on-chain trade confirms
  useEffect(() => {
    if (activeConfirmed && activeTxHash && isMountedRef.current) {
      refetchBalance();
      if (isMountedRef.current) setShowSuccess(true);
      const scanUrl = getBscScanUrl(chainId);
      const params = tradeParamsRef.current;
      toast.success(
        t('trade.onChainConfirmed', { side: params.side.toUpperCase() }),
        {
          action: {
            label: t('trade.viewOnBscScan'),
            onClick: () => window.open(`${scanUrl}/tx/${activeTxHash}`, "_blank"),
          },
        },
      );
      if (isMountedRef.current) setAmount("100");
      const timerId = setTimeout(() => {
        if (isMountedRef.current) {
          setShowSuccess(false);
          activeReset();
        }
      }, 2000);
      onTradeComplete?.();
      return () => clearTimeout(timerId);
    }
  }, [activeConfirmed, activeTxHash, chainId, t, refetchBalance, activeReset]);

  const numAmount = parseFloat(amount) || 0;

  // Simple preview calculation (on-chain CPMM, estimate locally)
  const calculation = useMemo(() => {
    if (numAmount < 0.01) {
      return { shares: 0, avgPrice: 0, priceImpact: 0, potentialProfit: 0, roi: 0 };
    }
    // Rough estimate: shares ~ amount / currentPrice for buy
    if (tradeMode === "buy") {
      const estShares = currentPrice > 0 ? numAmount / currentPrice : 0;
      const potentialProfit = estShares - numAmount;
      return {
        shares: estShares,
        avgPrice: currentPrice,
        priceImpact: 0, // Can't accurately estimate without reserves
        potentialProfit,
        roi: numAmount > 0 ? (potentialProfit / numAmount) * 100 : 0,
      };
    } else {
      const estPayout = numAmount * currentPrice;
      return {
        shares: numAmount,
        avgPrice: currentPrice,
        priceImpact: 0,
        potentialProfit: estPayout,
        roi: currentPrice * 100,
      };
    }
  }, [numAmount, currentPrice, tradeMode]);

  // On-chain trade handler
  const handleOnChainTrade = useCallback(() => {
    if (numAmount <= 0 || activeWriting || activeConfirming || approveWriting || approveConfirming || limitWriting || limitConfirming || erc1155ApproveWriting || erc1155ApproveConfirming) return;
    if (!onChainMarketId || !marketIdBigint) {
      toast.error(t('trade.invalidMarketId'));
      return;
    }

    tradeParamsRef.current = { marketId, side, amount, onChainMarketId, tradeMode };

    // --- LIMIT ORDER ---
    if (orderType === "limit") {
      const priceNum = parseFloat(limitPrice);
      if (priceNum < 0.01 || priceNum > 0.99) {
        toast.error("Price must be between 0.01 and 0.99");
        return;
      }

      if (tradeMode === "buy") {
        // BUY limit: lock USDT
        const usdtBal = parseFloat(walletBalance);
        if (numAmount > usdtBal) {
          toast.error(t('trade.insufficientContractBalance', { balance: usdtBal.toFixed(4) }));
          return;
        }
        const amountWei = parseUnits(amount, 18);
        if (usdtAllowanceRaw < amountWei) {
          const maxUint256 = 2n ** 256n - 1n;
          usdtApprove(PREDICTION_MARKET_ADDRESS, maxUint256);
          return;
        }
        // OrderSide: BUY_YES=0, BUY_NO=1
        const orderSideEnum = side === "yes" ? 0 : 1;
        const priceWei = parseUnits(limitPrice, 18);
        placeLimitOrder(marketIdBigint, orderSideEnum, priceWei, amountWei);
      } else {
        // SELL limit: lock ERC1155 shares — need setApprovalForAll
        if (!erc1155Approved) {
          erc1155Approve(PREDICTION_MARKET_ADDRESS, true);
          return;
        }
        // OrderSide: SELL_YES=2, SELL_NO=3
        const orderSideEnum = side === "yes" ? 2 : 3;
        const priceWei = parseUnits(limitPrice, 18);
        const amountWei = parseUnits(amount, 18);
        placeLimitOrder(marketIdBigint, orderSideEnum, priceWei, amountWei);
      }
      return;
    }

    // --- MARKET ORDER ---
    if (tradeMode === "buy") {
      const usdtBal = parseFloat(walletBalance);
      if (numAmount > usdtBal) {
        toast.error(t('trade.insufficientContractBalance', { balance: usdtBal.toFixed(4) }));
        return;
      }

      const amountWei = parseUnits(amount, 18);

      if (usdtAllowanceRaw < amountWei) {
        const maxUint256 = 2n ** 256n - 1n;
        usdtApprove(PREDICTION_MARKET_ADDRESS, maxUint256);
        return;
      }

      buy(marketIdBigint, side === "yes", amount);
    } else {
      const sharesWei = parseUnits(amount, 18);
      sell(marketIdBigint, side === "yes", sharesWei);
    }
  }, [numAmount, activeWriting, activeConfirming, approveWriting, approveConfirming, limitWriting, limitConfirming, erc1155ApproveWriting, erc1155ApproveConfirming, onChainMarketId, marketIdBigint, marketId, side, amount, tradeMode, orderType, limitPrice, walletBalance, usdtAllowanceRaw, usdtApprove, buy, sell, placeLimitOrder, erc1155Approved, erc1155Approve, t]);

  const executeTradeInternal = useCallback(async () => {
    if (numAmount <= 0 || isSubmitting) return;

    if (onChainMarketId && marketIdBigint) {
      handleOnChainTrade();
    } else {
      toast.error(t('trade.invalidMarketId'));
    }
  }, [numAmount, isSubmitting, onChainMarketId, marketIdBigint, handleOnChainTrade, t]);

  const handleConfirm = useCallback(() => {
    if (numAmount <= 0 || isSubmitting) return;
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

  const isOnChainBusy = activeWriting || activeConfirming || approveWriting || approveConfirming || limitWriting || limitConfirming || erc1155ApproveWriting || erc1155ApproveConfirming;
  const tradingDisabled = status !== "active" && status !== "expiring";
  const isDisabled = tradingDisabled || numAmount <= 0 || isSubmitting || (!isMulti && isOnChainBusy);
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
              style={{ borderLeftColor: selectedOptionId === opt.id ? opt.color : 'transparent' }}
            >
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: opt.color }} />
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

      {/* Market/Limit Tabs */}
      {!isMulti && (
        <div className="grid grid-cols-2 border-t border-border">
          <button
            onClick={() => setOrderType("market")}
            className={`py-1.5 text-[10px] font-bold tracking-wider uppercase transition-colors ${
              orderType === "market"
                ? "bg-blue-500/20 text-blue-400"
                : "bg-secondary/50 text-muted-foreground hover:text-foreground"
            }`}
          >
            {t('trade.market', { defaultValue: 'Market' })}
          </button>
          <button
            onClick={() => setOrderType("limit")}
            className={`py-1.5 text-[10px] font-bold tracking-wider uppercase transition-colors ${
              orderType === "limit"
                ? "bg-blue-500/20 text-blue-400"
                : "bg-secondary/50 text-muted-foreground hover:text-foreground"
            }`}
          >
            {t('trade.limit', { defaultValue: 'Limit' })}
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={`${side}-${tradeMode}-${orderType}`}
          initial={{ opacity: 0, x: side === "yes" ? -20 : 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: side === "yes" ? 20 : -20 }}
          transition={{ duration: 0.2 }}
          className="p-4 space-y-4"
        >
          {/* Wallet USDT balance */}
          {!isMulti && (
            <div className="text-xs text-muted-foreground px-1 flex items-center gap-1">
              <Zap className="w-3 h-3 text-blue-400" />
              <span>{t('trade.onChainTrade')}</span>
              <span className="ml-auto text-blue-400 font-mono">{parseFloat(walletBalance).toFixed(2)} USDT</span>
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

          {/* Limit Price Input (limit mode only) */}
          {orderType === "limit" && !isMulti && (
            <div>
              <label htmlFor="limit-price-input" className="block text-muted-foreground text-[10px] tracking-wider uppercase mb-1.5">
                {t('trade.limitPrice', { defaultValue: 'Limit Price' })}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-base">$</span>
                <input
                  id="limit-price-input"
                  type="number"
                  min="0.01"
                  max="0.99"
                  step="0.01"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  className="w-full bg-input-background border border-border text-foreground text-lg font-bold py-2.5 pl-7 pr-3 focus:outline-none focus:border-blue-500/50 transition-colors"
                  placeholder="0.50"
                />
              </div>
              <div className="flex gap-1 mt-1">
                {[0.1, 0.25, 0.5, 0.75, 0.9].map((p) => (
                  <button
                    key={p}
                    onClick={() => setLimitPrice(p.toFixed(2))}
                    className={`flex-1 py-1 text-[10px] border rounded-full transition-all ${
                      limitPrice === p.toFixed(2)
                        ? "bg-blue-500/10 border-blue-500/50 text-blue-400"
                        : "bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.08] text-muted-foreground"
                    }`}
                  >
                    ${p.toFixed(2)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Amount Input */}
          <div>
            <label htmlFor="trade-amount-input" className="block text-muted-foreground text-[10px] tracking-wider uppercase mb-1.5">
              {tradeMode === "buy" ? t('trade.tradeAmount') : t('trade.sellShares')}
            </label>
            <div className="relative">
              {tradeMode === "buy" && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-base">$</span>
              )}
              <input
                id="trade-amount-input"
                type="number"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`w-full bg-input-background border border-border text-foreground text-lg font-bold py-2.5 ${tradeMode === "buy" ? "pl-7" : "pl-3"} pr-3 focus:outline-none focus:border-blue-500/50 transition-colors`}
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Quick Amount Buttons */}
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
                {tradeMode === "buy" ? `$${quickAmount}` : quickAmount}
              </button>
            ))}
          </div>

          {/* Calculation Breakdown */}
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
                {tradeMode === "buy" ? `~${calculation.shares.toFixed(2)}` : `~$${calculation.potentialProfit.toFixed(2)}`}
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

          {/* Tx status */}
          {activeTxHash && (
            <div className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/30 text-sm">
              {activeConfirming ? (
                <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              ) : activeConfirmed ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : null}
              <a
                href={`${getBscScanUrl(chainId)}/tx/${activeTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 font-mono text-xs underline flex items-center gap-1"
              >
                {activeTxHash.slice(0, 12)}...{activeTxHash.slice(-8)}
                <ExternalLink className="w-3 h-3" />
              </a>
              <span className="text-muted-foreground text-xs ml-auto">
                {activeConfirming ? t('trade.txConfirming') : activeConfirmed ? t('trade.txConfirmed') : t('trade.txSubmitted')}
              </span>
            </div>
          )}

          {/* Error */}
          {activeError && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {(activeError as Error).message?.includes("User rejected")
                ? t('trade.txCancelledByUser')
                : (activeError as Error).message?.slice(0, 150) || t('trade.txFailed')}
            </div>
          )}

          {/* Confirm Button */}
          <div className="relative">
            <button
              onClick={handleConfirm}
              disabled={isDisabled}
              className={`w-full py-2.5 font-bold text-sm tracking-wide uppercase transition-all duration-300 flex items-center justify-center gap-2 group disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed hover:scale-[1.02] ${sideButtonClass}`}
            >
              {tradingDisabled ? (
                t('trade.marketSettled')
              ) : isSubmitting || (!isMulti && isOnChainBusy) ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {approveWriting || approveConfirming
                    ? 'Approving USDT...'
                    : erc1155ApproveWriting || erc1155ApproveConfirming
                      ? 'Approving ERC1155...'
                      : activeConfirming
                        ? t('trade.confirmingOnChain')
                        : activeWriting
                          ? t('trade.confirmInWallet')
                          : t('trade.processing')}
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  {orderType === "limit"
                    ? (tradeMode === "buy"
                      ? t('trade.placeLimitBuy', { side: side.toUpperCase(), defaultValue: `Limit Buy ${side.toUpperCase()}` })
                      : t('trade.placeLimitSell', { side: side.toUpperCase(), defaultValue: `Limit Sell ${side.toUpperCase()}` }))
                    : (tradeMode === "buy"
                      ? t('trade.confirmBuy', { side: side.toUpperCase() })
                      : t('trade.confirmSell', { side: side.toUpperCase() }))}
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>

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

          <p className="text-muted-foreground text-xs text-center leading-relaxed px-2">
            {t('trade.onChainDisclaimer')}
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
              <button onClick={handleRiskCancel} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-5 h-5" />
              </button>
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
                  <ShieldAlert className="w-8 h-8 text-amber-400" />
                </div>
              </div>
              <h3 className="text-lg font-bold text-foreground text-center mb-3">
                {t('trade.riskWarningTitle', { defaultValue: 'Risk Warning' })}
              </h3>
              <p className="text-muted-foreground text-sm text-center leading-relaxed mb-6">
                {t('trade.riskWarningMessage', {
                  defaultValue: 'Prediction markets involve risk, and you may lose all of your invested capital. Please confirm you understand the risks before proceeding.',
                })}
              </p>
              <div className="flex gap-3">
                <button onClick={handleRiskCancel} className="flex-1 py-3 border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 font-semibold text-sm transition-colors">
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </button>
                <button onClick={handleRiskAccept} className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm transition-colors">
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
