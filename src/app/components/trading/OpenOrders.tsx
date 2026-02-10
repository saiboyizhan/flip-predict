"use client";

import { motion, AnimatePresence } from "motion/react";
import { useEffect, useState, useCallback } from "react";
import { ListOrdered, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  getOpenOrders,
  cancelOrder,
  type OpenOrder,
} from "@/app/services/api";

interface OpenOrdersProps {
  marketId?: string;
}

export function OpenOrders({ marketId }: OpenOrdersProps) {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const all = await getOpenOrders();
      const filtered = marketId
        ? all.filter((o) => o.marketId === marketId)
        : all;
      setOrders(filtered);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [marketId]);

  useEffect(() => {
    fetchOrders();
    const timer = setInterval(fetchOrders, 5000);
    return () => clearInterval(timer);
  }, [fetchOrders]);

  const handleCancel = async (orderId: string) => {
    setCancellingId(orderId);
    try {
      await cancelOrder(orderId);
      toast.success(t('openOrders.cancelSuccess'));
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('openOrders.cancelFailed'));
    } finally {
      setCancellingId(null);
    }
  };

  const sideLabel = (s: string) => (s === "yes" ? "YES" : "NO");
  const sideColor = (s: string) =>
    s === "yes" ? "text-emerald-400" : "text-red-400";
  const orderSideLabel = (s: string) => (s === "buy" ? t('openOrders.buy') : t('openOrders.sell'));
  const orderSideColor = (s: string) =>
    s === "buy" ? "text-emerald-400" : "text-red-400";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="bg-zinc-900 border border-zinc-800 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
        <ListOrdered className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-bold text-white">{t('openOrders.title')}</span>
        {orders.length > 0 && (
          <span className="text-[10px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 font-mono">
            {orders.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="py-8 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-zinc-600 animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div className="py-8 text-center">
          <ListOrdered className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
          <p className="text-zinc-600 text-sm">{t('openOrders.noOrders')}</p>
          <p className="text-zinc-700 text-xs mt-1">
            {t('openOrders.noOrdersHint')}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/50">
          {/* Column header */}
          <div className="grid grid-cols-[1fr_40px_40px_60px_60px_40px] gap-1 px-3 py-2 text-[10px] text-zinc-600 uppercase tracking-wider">
            <span>{t('openOrders.direction')}</span>
            <span>{t('openOrders.buySell')}</span>
            <span>{t('openOrders.price')}</span>
            <span className="text-right">{t('openOrders.amount')}</span>
            <span className="text-right">{t('openOrders.filled')}</span>
            <span />
          </div>

          <AnimatePresence initial={false}>
            {orders.map((order) => (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="grid grid-cols-[1fr_40px_40px_60px_60px_40px] gap-1 px-3 py-2 items-center text-xs"
              >
                <span className={sideColor(order.side)}>
                  {sideLabel(order.side)}
                </span>
                <span className={orderSideColor(order.orderSide)}>
                  {orderSideLabel(order.orderSide)}
                </span>
                <span className="text-white font-mono">
                  {order.price.toFixed(2)}
                </span>
                <span className="text-zinc-300 font-mono text-right">
                  ${order.amount.toFixed(0)}
                </span>
                <span className="text-zinc-500 font-mono text-right">
                  ${order.filled.toFixed(0)}
                </span>
                <div className="flex justify-end">
                  <button
                    onClick={() => handleCancel(order.id)}
                    disabled={cancellingId === order.id}
                    className="p-1 text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-50"
                    title={t('openOrders.cancelOrder')}
                  >
                    {cancellingId === order.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <X className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
