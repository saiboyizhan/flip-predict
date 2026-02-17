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
      className="bg-card border border-border overflow-hidden"
    >
      {/* Order type tabs */}
      <div className="grid grid-cols-2">
        <button
          onClick={() => setOrderType("limit")}
          className={`flex items-center justify-center gap-1.5 py-3 text-sm font-bold transition-all ${
            orderType === "limit"
              ? "bg-muted text-blue-400 border-b-2 border-blue-500"
              : "bg-secondary text-muted-foreground hover:text-foreground"
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          {t('limitOrder.limitOrder')}
        </button>
        <button
          onClick={() => setOrderType("market")}
          className={`flex items-center justify-center gap-1.5 py-3 text-sm font-bold transition-all ${
            orderType === "market"
              ? "bg-muted text-blue-400 border-b-2 border-blue-500"
              : "bg-secondary text-muted-foreground hover:text-foreground"
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
                  : "bg-secondary border border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t('limitOrder.buy')}
            </button>
            <button
              onClick={() => setOrderSide("sell")}
              className={`py-2.5 text-sm font-bold transition-all ${
                orderSide === "sell"
                  ? "bg-red-500 text-white"
                  : "bg-secondary border border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t('limitOrder.sell')}
            </button>
          </div>

          {/* Price input (limit only) */}
          {orderType === "limit" && (
            <div>
              <label className="block text-muted-foreground text-xs tracking-wider uppercase mb-1.5">
                {t('limitOrder.price')}
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="0.99"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={`w-full bg-input-background border text-foreground font-mono text-lg py-3 px-4 focus:outline-none transition-colors ${
                  price !== "" && (numPrice < 0.01 || numPrice > 0.99)
                    ? "border-red-500 focus:border-red-500"
                    : "border-border focus:border-blue-500/50"
                }`}
                placeholder="0.50"
              />
              {price !== "" && (numPrice < 0.01 || numPrice > 0.99) && (
                <p className="text-red-400 text-xs mt-1">{t('limitOrder.priceRange')}</p>
              )}
              {currentPrice !== undefined && (
                <p className="text-muted-foreground text-xs mt-1">
                  {t('limitOrder.currentPrice', { price: currentPrice.toFixed(2) })}
                </p>
              )}
            </div>
          )}

          {/* Amount input */}
          <div>
            <label className="block text-muted-foreground text-xs tracking-wider uppercase mb-1.5">
              {t('limitOrder.amount')}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                $
              </span>
              <input
                type="number"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`w-full bg-input-background border text-foreground font-mono text-lg py-3 pl-8 pr-4 focus:outline-none transition-colors ${
                  amount !== "" && numAmount <= 0
                    ? "border-red-500 focus:border-red-500"
                    : "border-border focus:border-blue-500/50"
                }`}
                placeholder="0.00"
              />
            </div>
            {amount !== "" && numAmount <= 0 && (
              <p className="text-red-400 text-xs mt-1">{t('limitOrder.enterAmount')}</p>
            )}
          </div>

          {/* Quick amounts */}
          <div className="grid grid-cols-4 gap-1.5">
            {QUICK_AMOUNTS.map((qa) => (
              <button
                key={qa}
                onClick={() => setAmount(qa.toString())}
                className={`py-1.5 text-xs font-mono border transition-all ${
                  amount === qa.toString()
                    ? "bg-blue-500/10 border-blue-500/50 text-blue-400"
                    : "bg-secondary border-border text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                ${qa}
              </button>
            ))}
          </div>

          {/* Info line */}
          {orderType === "limit" && numAmount > 0 && numPrice > 0 && (
            <div className="flex justify-between text-xs text-muted-foreground px-1">
              <span>{t('limitOrder.estShares')}</span>
              <span className="text-muted-foreground font-mono">
                {t('limitOrder.shares', { count: estimatedShares.toFixed(2) })}
              </span>
            </div>
          )}

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={loading || numAmount <= 0}
            className="w-full py-3.5 bg-blue-500 hover:bg-blue-400 text-black font-bold text-sm tracking-wide uppercase transition-all flex items-center justify-center gap-2 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
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
