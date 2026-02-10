"use client";

import { motion, AnimatePresence } from "motion/react";
import { useState, useMemo, useCallback } from "react";
import { ArrowRight, TrendingUp, Coins, Target, Percent, AlertTriangle, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useTradeStore, calculateBuy, calculateSell, getEstimatedReturn, getPrice } from "@/app/stores/useTradeStore";

interface TradePanelProps {
  marketId: string;
  marketTitle: string;
  status: "active" | "expiring" | "settled";
}

const QUICK_AMOUNTS = [10, 50, 100, 500];

export function TradePanel({ marketId, marketTitle, status }: TradePanelProps) {
  const { t } = useTranslation();
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [tradeMode, setTradeMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState<string>("100");
  const [showSuccess, setShowSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { getOrCreatePool, executeAPIBuy, executeAPISell } = useTradeStore();
  const pool = getOrCreatePool(marketId);

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

  const handleConfirm = useCallback(async () => {
    if (numAmount <= 0 || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const result = tradeMode === "buy"
        ? await executeAPIBuy(marketId, side, numAmount)
        : await executeAPISell(marketId, side, numAmount);
      if (result.success) {
        setShowSuccess(true);
        if (tradeMode === "buy") {
          toast.success(
            t('trade.buySuccess', { shares: result.shares.toFixed(2), side: side.toUpperCase(), price: result.price.toFixed(4) }),
          );
          setAmount("100");
        } else {
          toast.success(
            t('trade.sellSuccess', {
              defaultValue: `Sold ${numAmount.toFixed(2)} ${side.toUpperCase()} shares at $${result.price.toFixed(4)}`,
            }),
          );
          setAmount("10");
        }
        setTimeout(() => setShowSuccess(false), 1500);
      } else {
        toast.error(result.error || t('trade.tradeFailed'));
      }
    } catch {
      toast.error(t('trade.tradeFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [numAmount, isSubmitting, executeAPIBuy, executeAPISell, marketId, side, t, tradeMode]);

  const isDisabled = status === "settled" || numAmount <= 0 || isSubmitting;
  const sideTextClass = side === "yes" ? "text-emerald-400" : "text-red-400";
  const sideButtonClass = side === "yes" ? "bg-emerald-500 hover:bg-emerald-400 text-white" : "bg-red-500 hover:bg-red-400 text-white";

  const priceImpactColor =
    calculation.priceImpact > 10
      ? "text-red-400"
      : calculation.priceImpact > 5
        ? "text-yellow-400"
        : "text-zinc-400";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900 border border-zinc-800 overflow-hidden"
    >
      {/* YES/NO Tabs */}
      <div className="grid grid-cols-2">
        <button
          onClick={() => setSide("yes")}
          className={`py-4 text-center font-bold text-lg tracking-wide uppercase transition-all ${
            side === "yes"
              ? "bg-emerald-500 text-white"
              : "bg-zinc-950 text-zinc-500 hover:text-zinc-300"
          }`}
        >
          YES
        </button>
        <button
          onClick={() => setSide("no")}
          className={`py-4 text-center font-bold text-lg tracking-wide uppercase transition-all ${
            side === "no"
              ? "bg-red-500 text-white"
              : "bg-zinc-950 text-zinc-500 hover:text-zinc-300"
          }`}
        >
          NO
        </button>
      </div>

      {/* Buy/Sell Tabs */}
      <div className="grid grid-cols-2 border-t border-zinc-800">
        <button
          onClick={() => setTradeMode("buy")}
          className={`py-2.5 text-sm font-bold transition-colors ${
            tradeMode === "buy"
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-zinc-950 text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {t('trade.buy', { defaultValue: 'Buy' })}
        </button>
        <button
          onClick={() => setTradeMode("sell")}
          className={`py-2.5 text-sm font-bold transition-colors ${
            tradeMode === "sell"
              ? "bg-red-500/20 text-red-400"
              : "bg-zinc-950 text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {t('trade.sell', { defaultValue: 'Sell' })}
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${side}-${tradeMode}`}
          initial={{ opacity: 0, x: side === "yes" ? -20 : 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: side === "yes" ? 20 : -20 }}
          transition={{ duration: 0.2 }}
          className="p-6 space-y-6"
        >
          {/* Current Price */}
          <div className="text-center py-4 bg-zinc-950/50 border border-zinc-800/50">
            <div className="text-xs text-zinc-500 tracking-wider uppercase mb-1">
              {t('trade.currentPrice', { side: side === "yes" ? "YES" : "NO" })}
            </div>
            <div className={`text-4xl font-bold font-mono ${sideTextClass}`}>
              ${currentPrice.toFixed(2)}
            </div>
            <div className="text-xs text-zinc-600 mt-1">
              {t('trade.probability', { pct: Math.round(currentPrice * 100) })}
            </div>
          </div>

          {/* Amount Input */}
          <div>
            <label className="block text-zinc-400 text-sm tracking-wider uppercase mb-3">
              {tradeMode === "buy"
                ? t('trade.tradeAmount')
                : t('trade.sellShares', { defaultValue: 'Shares to sell' })}
            </label>
            <div className="relative">
              {tradeMode === "buy" && (
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 text-xl">
                  $
                </span>
              )}
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`w-full bg-zinc-950 border border-zinc-800 text-white text-2xl font-bold py-4 ${tradeMode === "buy" ? "pl-10" : "pl-4"} pr-4 focus:outline-none focus:border-amber-500/50 transition-colors`}
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Quick Amount Buttons */}
          <div className="grid grid-cols-4 gap-2">
            {QUICK_AMOUNTS.map((quickAmount) => (
              <button
                key={quickAmount}
                onClick={() => setAmount(quickAmount.toString())}
                className={`py-2 border text-sm transition-all hover:scale-[1.02] ${
                  amount === quickAmount.toString()
                    ? "bg-amber-500/10 border-amber-500/50 text-amber-400"
                    : "bg-zinc-950 border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-white"
                }`}
              >
                ${quickAmount}
              </button>
            ))}
          </div>

          {/* Calculation Breakdown */}
          <div className="space-y-3 pt-4 border-t border-zinc-800">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-zinc-500 text-sm">
                <Coins className="w-3.5 h-3.5" />
                <span>{tradeMode === "buy" ? t('trade.estCost') : t('trade.shares', { defaultValue: 'Shares' })}</span>
              </div>
              <span className="text-white font-mono">
                {tradeMode === "buy" ? `$${numAmount.toFixed(2)}` : numAmount.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-zinc-500 text-sm">
                <Target className="w-3.5 h-3.5" />
                <span>{tradeMode === "buy" ? t('trade.estShares') : t('trade.estPayout', { defaultValue: 'Est. payout' })}</span>
              </div>
              <span className="text-white font-mono">
                {tradeMode === "buy" ? calculation.shares.toFixed(2) : `$${calculation.potentialProfit.toFixed(2)}`}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-zinc-500 text-sm">
                <Coins className="w-3.5 h-3.5" />
                <span>{t('trade.avgPrice')}</span>
              </div>
              <span className="text-white font-mono">
                ${calculation.avgPrice.toFixed(4)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-zinc-500 text-sm">
                <AlertTriangle className={`w-3.5 h-3.5 ${priceImpactColor}`} />
                <span className={priceImpactColor}>{t('trade.priceImpact')}</span>
              </div>
              <span className={`font-mono ${priceImpactColor}`}>
                {calculation.priceImpact.toFixed(2)}%
              </span>
            </div>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-zinc-500 text-sm">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>{tradeMode === "buy" ? t('trade.potentialReturn') : t('trade.payout', { defaultValue: 'Payout' })}</span>
              </div>
              <span className={`${sideTextClass} font-mono`}>
                {tradeMode === "buy"
                  ? `$${(numAmount + calculation.potentialProfit).toFixed(2)}`
                  : `$${calculation.potentialProfit.toFixed(2)}`}
              </span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-zinc-800">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Percent className={`w-3.5 h-3.5 ${sideTextClass}`} />
                <span className={sideTextClass}>
                  {tradeMode === "buy" ? t('trade.returnRate') : t('trade.avgExitPrice', { defaultValue: 'Avg. exit price' })}
                </span>
              </div>
              <span className={`${sideTextClass} font-mono text-lg font-bold`}>
                {tradeMode === "buy" ? `+${calculation.roi.toFixed(1)}%` : `$${calculation.avgPrice.toFixed(4)}`}
              </span>
            </div>
          </div>

          {/* Price Impact Warning */}
          {calculation.priceImpact > 5 && (
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
              className={`w-full py-4 font-bold text-lg tracking-wide uppercase transition-all duration-300 flex items-center justify-center gap-2 group disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed hover:scale-[1.02] ${sideButtonClass}`}
            >
              {status === "settled" ? (
                t('trade.marketSettled')
              ) : isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {t('trade.processing', { defaultValue: 'Processing...' })}
                </>
              ) : (
                <>
                  {tradeMode === "buy"
                    ? t('trade.confirmBuy', { side: side.toUpperCase() })
                    : t('trade.confirmSell', { side: side.toUpperCase(), defaultValue: `Confirm Sell ${side.toUpperCase()}` })}
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
          <p className="text-zinc-600 text-xs text-center leading-relaxed">
            {t('trade.disclaimer')}
          </p>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
