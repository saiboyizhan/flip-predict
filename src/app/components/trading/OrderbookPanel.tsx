"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { BookOpen, X, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAccount } from "wagmi";
import { subscribeOrderBook, unsubscribeOrderBook } from "@/app/services/ws";
import { useCancelLimitOrder, useTxNotifier } from "@/app/hooks/useContracts";

const API_BASE = import.meta.env.VITE_API_URL || "https://flip-backend-production.up.railway.app";

interface OrderbookLevel {
  price: number;
  totalAmount: number;
  numOrders: number;
}

interface UserOrder {
  id: string;
  side: string;
  orderSide: string;
  price: number;
  amount: number;
  filled: number;
  status: string;
  onChainOrderId: number | null;
}

interface OrderbookPanelProps {
  marketId: string;
  onPriceClick?: (price: string) => void;
}

export function OrderbookPanel({ marketId, onPriceClick }: OrderbookPanelProps) {
  const { t } = useTranslation();
  const { address } = useAccount();
  const [bids, setBids] = useState<OrderbookLevel[]>([]);
  const [asks, setAsks] = useState<OrderbookLevel[]>([]);
  const [userOrders, setUserOrders] = useState<UserOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const {
    cancelLimitOrder,
    txHash: cancelTxHash,
    isWriting: cancelWriting,
    isConfirming: cancelConfirming,
    isConfirmed: cancelConfirmed,
    error: cancelError,
  } = useCancelLimitOrder();

  useTxNotifier(cancelTxHash, cancelConfirming, cancelConfirmed, cancelError as Error | null, "Cancel Order");

  // Fetch initial orderbook
  const fetchOrderbook = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/markets/${marketId}/orderbook`);
      if (res.ok) {
        const data = await res.json();
        setBids(data.bids || []);
        setAsks(data.asks || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [marketId]);

  // Fetch user orders
  const fetchUserOrders = useCallback(async () => {
    if (!address) return;
    const token = localStorage.getItem("jwt_token");
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/markets/${marketId}/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUserOrders(data.orders || []);
      }
    } catch {
      // ignore
    }
  }, [marketId, address]);

  useEffect(() => {
    fetchOrderbook();
    fetchUserOrders();
  }, [fetchOrderbook, fetchUserOrders]);

  // Refetch after cancel confirms
  useEffect(() => {
    if (cancelConfirmed) {
      fetchOrderbook();
      fetchUserOrders();
    }
  }, [cancelConfirmed, fetchOrderbook, fetchUserOrders]);

  // Subscribe to WS orderbook updates
  useEffect(() => {
    const handler = () => {
      fetchOrderbook();
      fetchUserOrders();
    };
    subscribeOrderBook(marketId, "yes", handler);
    subscribeOrderBook(marketId, "no", handler);
    return () => {
      unsubscribeOrderBook(marketId, "yes", handler);
      unsubscribeOrderBook(marketId, "no", handler);
    };
  }, [marketId, fetchOrderbook, fetchUserOrders]);

  const handleCancel = useCallback((onChainOrderId: number) => {
    cancelLimitOrder(BigInt(onChainOrderId));
  }, [cancelLimitOrder]);

  const maxAmount = Math.max(
    ...bids.map((b) => b.totalAmount),
    ...asks.map((a) => a.totalAmount),
    1
  );

  const openUserOrders = userOrders.filter((o) => o.status === "open");

  if (loading) {
    return (
      <div className="bg-card/80 backdrop-blur-xl border border-white/[0.06] p-4">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="w-4 h-4 text-blue-400" />
          <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
            {t('trade.orderbook', { defaultValue: 'Order Book' })}
          </h3>
        </div>
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const hasData = bids.length > 0 || asks.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card/80 backdrop-blur-xl border border-white/[0.06] overflow-hidden"
    >
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-blue-400" />
          <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
            {t('trade.orderbook', { defaultValue: 'Order Book' })}
          </h3>
        </div>
      </div>

      {!hasData ? (
        <div className="p-4 text-center text-xs text-muted-foreground">
          {t('trade.noOrders', { defaultValue: 'No open orders' })}
        </div>
      ) : (
        <div className="p-2">
          {/* Header */}
          <div className="grid grid-cols-3 text-[10px] text-muted-foreground uppercase tracking-wider px-2 pb-1">
            <span>{t('trade.priceCol', { defaultValue: 'Price' })}</span>
            <span className="text-right">{t('trade.amountCol', { defaultValue: 'Amount' })}</span>
            <span className="text-right">{t('trade.ordersCol', { defaultValue: 'Orders' })}</span>
          </div>

          {/* Asks (sell orders) — red, sorted low to high */}
          {asks.slice(0, 8).reverse().map((level) => (
            <button
              key={`ask-${level.price}`}
              onClick={() => onPriceClick?.(level.price.toFixed(2))}
              className="grid grid-cols-3 w-full text-xs px-2 py-1 hover:bg-white/[0.04] transition-colors relative"
            >
              <div
                className="absolute inset-0 bg-red-500/10"
                style={{ width: `${(level.totalAmount / maxAmount) * 100}%`, right: 0, left: 'auto' }}
              />
              <span className="text-red-400 font-mono relative z-10">${level.price.toFixed(2)}</span>
              <span className="text-right font-mono text-foreground relative z-10">{level.totalAmount.toFixed(2)}</span>
              <span className="text-right text-muted-foreground relative z-10">{level.numOrders}</span>
            </button>
          ))}

          {/* Spread indicator */}
          {bids.length > 0 && asks.length > 0 && (
            <div className="text-center text-[10px] text-muted-foreground py-1 border-y border-border/50">
              Spread: ${(asks[0].price - bids[0].price).toFixed(2)}
            </div>
          )}

          {/* Bids (buy orders) — green, sorted high to low */}
          {bids.slice(0, 8).map((level) => (
            <button
              key={`bid-${level.price}`}
              onClick={() => onPriceClick?.(level.price.toFixed(2))}
              className="grid grid-cols-3 w-full text-xs px-2 py-1 hover:bg-white/[0.04] transition-colors relative"
            >
              <div
                className="absolute inset-0 bg-emerald-500/10"
                style={{ width: `${(level.totalAmount / maxAmount) * 100}%`, right: 0, left: 'auto' }}
              />
              <span className="text-emerald-400 font-mono relative z-10">${level.price.toFixed(2)}</span>
              <span className="text-right font-mono text-foreground relative z-10">{level.totalAmount.toFixed(2)}</span>
              <span className="text-right text-muted-foreground relative z-10">{level.numOrders}</span>
            </button>
          ))}
        </div>
      )}

      {/* User's open orders */}
      {openUserOrders.length > 0 && (
        <div className="border-t border-border p-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider px-2 pb-1">
            {t('trade.myOrders', { defaultValue: 'My Orders' })}
          </div>
          {openUserOrders.map((order) => (
            <div key={order.id} className="flex items-center justify-between px-2 py-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 text-[10px] font-bold ${
                  order.orderSide === "buy" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                }`}>
                  {order.orderSide.toUpperCase()}
                </span>
                <span className={`font-semibold ${order.side === "yes" ? "text-emerald-400" : "text-red-400"}`}>
                  {order.side.toUpperCase()}
                </span>
                <span className="text-muted-foreground font-mono">
                  ${order.price.toFixed(2)}
                </span>
                <span className="text-foreground font-mono">
                  {(order.amount - order.filled).toFixed(2)}
                </span>
              </div>
              {order.onChainOrderId != null && (
                <button
                  onClick={() => handleCancel(order.onChainOrderId!)}
                  disabled={cancelWriting || cancelConfirming}
                  className="text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-50"
                  title="Cancel order"
                >
                  {cancelWriting || cancelConfirming ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <X className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
