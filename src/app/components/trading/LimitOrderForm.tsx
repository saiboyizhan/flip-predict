"use client";

import { motion, AnimatePresence } from "motion/react";
import { useState, useEffect } from "react";
import { Zap, Clock, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { placeLimitOrder, placeMarketOrder } from "@/app/services/api";

interface LimitOrderFormProps {
  marketId: string;
  side: "yes" | "no";
  currentPrice?: number;
  prefilledPrice?: number;
}

const QUICK_AMOUNTS = [10, 50, 100, 500];

type OrderType = "limit" | "market";
type OrderSide = "buy" | "sell";

export function LimitOrderForm({
  marketId,
  side,
  currentPrice,
  prefilledPrice,
}: LimitOrderFormProps) {
  const { t } = useTranslation();
  const [orderType, setOrderType] = useState<OrderType>("limit");
  const [orderSide, setOrderSide] = useState<OrderSide>("buy");
  const [price, setPrice] = useState<string>(prefilledPrice?.toFixed(2) ?? "0.50");
  const [amount, setAmount] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (prefilledPrice !== undefined) {
      setPrice(prefilledPrice.toFixed(2));
      setOrderType("limit");
    }
  }, [prefilledPrice]);

  const numPrice = parseFloat(price) || 0;
  const numAmount = parseFloat(amount) || 0;
  const estimatedShares = numPrice > 0 ? numAmount / numPrice : 0;

  const handleSubmit = async () => {
    if (numAmount <= 0) {
      toast.error(t('limitOrder.enterAmount'));
      return;
    }

    if (orderType === "limit" && (numPrice < 0.01 || numPrice > 0.99)) {
      toast.error(t('limitOrder.priceRange'));
      return;
    }

    setLoading(true);
    try {
      if (orderType === "limit") {
        await placeLimitOrder({
          marketId,
          side,
          orderSide,
          price: numPrice,
          amount: numAmount,
        });
        toast.success(
          t('limitOrder.limitBuySuccess', { side: orderSide === "buy" ? t('limitOrder.buy') : t('limitOrder.sell'), amount: numAmount, price: numPrice }),
        );
      } else {
        await placeMarketOrder({
          marketId,
          side,
          orderSide,
          amount: numAmount,
        });
        toast.success(t('limitOrder.marketBuySuccess', { side: orderSide === "buy" ? t('limitOrder.buy') : t('limitOrder.sell'), amount: numAmount }));
      }
      setAmount("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('limitOrder.tradeFailed');
      if (msg.includes("余额不足") || msg.includes("insufficient")) {
        toast.error(t('limitOrder.insufficientBalance'));
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="bg-zinc-900 border border-zinc-800 overflow-hidden"
    >
      {/* Order type tabs */}
      <div className="grid grid-cols-2">
        <button
          onClick={() => setOrderType("limit")}
          className={`flex items-center justify-center gap-1.5 py-3 text-sm font-bold transition-all ${
            orderType === "limit"
              ? "bg-zinc-800 text-amber-400 border-b-2 border-amber-500"
              : "bg-zinc-950 text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          {t('limitOrder.limitOrder')}
        </button>
        <button
          onClick={() => setOrderType("market")}
          className={`flex items-center justify-center gap-1.5 py-3 text-sm font-bold transition-all ${
            orderType === "market"
              ? "bg-zinc-800 text-amber-400 border-b-2 border-amber-500"
              : "bg-zinc-950 text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          {t('limitOrder.marketOrder')}
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={orderType}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.15 }}
          className="p-4 space-y-4"
        >
          {/* Buy / Sell toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setOrderSide("buy")}
              className={`py-2.5 text-sm font-bold transition-all ${
                orderSide === "buy"
                  ? "bg-emerald-500 text-white"
                  : "bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t('limitOrder.buy')}
            </button>
            <button
              onClick={() => setOrderSide("sell")}
              className={`py-2.5 text-sm font-bold transition-all ${
                orderSide === "sell"
                  ? "bg-red-500 text-white"
                  : "bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t('limitOrder.sell')}
            </button>
          </div>

          {/* Price input (limit only) */}
          {orderType === "limit" && (
            <div>
              <label className="block text-zinc-500 text-xs tracking-wider uppercase mb-1.5">
                {t('limitOrder.price')}
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="0.99"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 text-white font-mono text-lg py-3 px-4 focus:outline-none focus:border-amber-500/50 transition-colors"
                placeholder="0.50"
              />
              {currentPrice !== undefined && (
                <p className="text-zinc-600 text-xs mt-1">
                  {t('limitOrder.currentPrice', { price: currentPrice.toFixed(2) })}
                </p>
              )}
            </div>
          )}

          {/* Amount input */}
          <div>
            <label className="block text-zinc-500 text-xs tracking-wider uppercase mb-1.5">
              {t('limitOrder.amount')}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 text-sm">
                $
              </span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 text-white font-mono text-lg py-3 pl-8 pr-4 focus:outline-none focus:border-amber-500/50 transition-colors"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Quick amounts */}
          <div className="grid grid-cols-4 gap-1.5">
            {QUICK_AMOUNTS.map((qa) => (
              <button
                key={qa}
                onClick={() => setAmount(qa.toString())}
                className={`py-1.5 text-xs font-mono border transition-all ${
                  amount === qa.toString()
                    ? "bg-amber-500/10 border-amber-500/50 text-amber-400"
                    : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
                }`}
              >
                ${qa}
              </button>
            ))}
          </div>

          {/* Info line */}
          {orderType === "limit" && numAmount > 0 && numPrice > 0 && (
            <div className="flex justify-between text-xs text-zinc-500 px-1">
              <span>{t('limitOrder.estShares')}</span>
              <span className="text-zinc-300 font-mono">
                {t('limitOrder.shares', { count: estimatedShares.toFixed(2) })}
              </span>
            </div>
          )}

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={loading || numAmount <= 0}
            className="w-full py-3.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm tracking-wide uppercase transition-all flex items-center justify-center gap-2 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="animate-pulse">{t('limitOrder.processing')}</span>
            ) : orderType === "limit" ? (
              <>
                {t('limitOrder.placeOrder')}
                <ArrowRight className="w-4 h-4" />
              </>
            ) : (
              <>
                {t('limitOrder.instantTrade')}
                <Zap className="w-4 h-4" />
              </>
            )}
          </button>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
