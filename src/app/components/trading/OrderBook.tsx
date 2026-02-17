"use client";

import { motion } from "motion/react";
import { useEffect, useState, useCallback, useRef } from "react";
import { BookOpen } from "lucide-react";
import {
  getOrderBook,
  type OrderBookData,
  type OrderBookLevel,
} from "@/app/services/api";
import { subscribeOrderBook, unsubscribeOrderBook } from "@/app/services/ws";
import { useTranslation } from "react-i18next";

interface OrderBookProps {
  marketId: string;
  side: "yes" | "no";
  onPriceClick?: (price: number) => void;
}

function Row({
  level,
  maxCumulative,
  type,
  cumulative,
  onClick,
}: {
  level: OrderBookLevel;
  maxCumulative: number;
  type: "bid" | "ask";
  cumulative: number;
  onClick?: () => void;
}) {
  const pct = maxCumulative > 0 ? (cumulative / maxCumulative) * 100 : 0;
  const bgColor =
    type === "bid"
      ? "bg-emerald-500/10"
      : "bg-red-500/10";
  const textColor =
    type === "bid" ? "text-emerald-400" : "text-red-400";

  return (
    <button
      onClick={onClick}
      className="relative w-full grid grid-cols-3 text-xs font-mono py-1 px-3 hover:bg-accent/50 transition-all duration-200 text-left"
    >
      <div
        className={`absolute inset-y-0 right-0 ${bgColor}`}
        style={{ width: `${pct}%` }}
      />
      <span className={`relative z-10 ${textColor}`}>
        {level.price.toFixed(2)}
      </span>
      <span className="relative z-10 text-muted-foreground text-right">
        {level.amount.toFixed(2)}
      </span>
      <span className="relative z-10 text-muted-foreground text-right">
        {cumulative.toFixed(2)}
      </span>
    </button>
  );
}

export function OrderBook({ marketId, side, onPriceClick }: OrderBookProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<OrderBookData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsConnected = useRef(false);

  const fetchData = useCallback(async () => {
    try {
      const result = await getOrderBook(marketId, side);
      setData(result);
      setError(null);
    } catch {
      setError('Failed to load orderbook');
    }
  }, [marketId, side]);

  // WebSocket update handler (stable reference via useCallback)
  const handleWsUpdate = useCallback((msg: unknown) => {
    const d = msg as OrderBookData & { type: string };
    wsConnected.current = true;
    setData({
      bids: d.bids,
      asks: d.asks,
      spread: d.spread,
      midPrice: d.midPrice,
    });
  }, []);

  useEffect(() => {
    fetchData();

    subscribeOrderBook(marketId, side, handleWsUpdate);

    // Fallback polling every 5s if WS not working
    pollRef.current = setInterval(() => {
      if (!wsConnected.current) {
        fetchData();
      }
    }, 5000);

    return () => {
      unsubscribeOrderBook(marketId, side, handleWsUpdate);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      wsConnected.current = false;
    };
  }, [marketId, side, fetchData, handleWsUpdate]);

  // Calculate cumulative amounts
  const asks = data?.asks ?? [];
  const bids = data?.bids ?? [];

  // Asks: reversed (high to low display), cumulative from bottom
  const asksReversed = [...asks].reverse();
  const asksCumulative: number[] = [];
  let cum = 0;
  for (let i = asksReversed.length - 1; i >= 0; i--) {
    cum += asksReversed[i].amount;
    asksCumulative[i] = cum;
  }

  // Bids: high to low, cumulative from top
  const bidsCumulative: number[] = [];
  cum = 0;
  for (let i = 0; i < bids.length; i++) {
    cum += bids[i].amount;
    bidsCumulative[i] = cum;
  }

  const maxCum = Math.max(
    asksCumulative[0] ?? 0,
    bidsCumulative[bidsCumulative.length - 1] ?? 0,
    1,
  );

  const sideLabel = side === "yes" ? t('market.yes') : t('market.no');
  const sideColor = side === "yes" ? "text-emerald-400" : "text-red-400";
  const isEmpty = asks.length === 0 && bids.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="bg-card border border-border overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <BookOpen className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-bold text-foreground">{t('orderbook.title')}</span>
        <span
          className={`text-xs font-mono px-2 py-0.5 ${
            side === "yes"
              ? "bg-emerald-500/10 text-emerald-400"
              : "bg-red-500/10 text-red-400"
          }`}
        >
          {sideLabel}
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-3 text-[10px] text-muted-foreground uppercase tracking-wider px-3 py-2 border-b border-border">
        <span>{t('orderbook.price')}</span>
        <span className="text-right">{t('orderbook.amount')}</span>
        <span className="text-right">{t('orderbook.cumulative')}</span>
      </div>

      {error ? (
        <div className="py-10 text-center">
          <BookOpen className="w-8 h-8 text-red-500/50 mx-auto mb-2" />
          <p className="text-red-400 text-sm">{error}</p>

          <button
            onClick={fetchData}
            className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            {t('common.retry', 'Retry')}
          </button>
        </div>
      ) : isEmpty ? (
        <div className="py-10 text-center">
          <BookOpen className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">{t('orderbook.noOrders')}</p>
        </div>
      ) : (
        <>
          {/* Asks (sells) - reversed, red */}
          <div className="max-h-[160px] overflow-y-auto">
            {asksReversed.map((level, i) => (
              <Row
                key={`ask-${level.price}`}
                level={level}
                maxCumulative={maxCum}
                type="ask"
                cumulative={asksCumulative[i]}
                onClick={() => onPriceClick?.(level.price)}
              />
            ))}
          </div>

          {/* Spread */}
          <div className="flex items-center justify-between px-3 py-2 bg-secondary/30 border-y border-border">
            <span className="text-[10px] text-muted-foreground uppercase">{t('orderbook.spread')}</span>
            <span className={`text-sm font-mono font-bold ${sideColor}`}>
              {data?.spread?.toFixed(2) ?? "—"}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {t('orderbook.midPrice', { price: data?.midPrice?.toFixed(2) ?? "—" })}
            </span>
          </div>

          {/* Bids (buys) - green */}
          <div className="max-h-[160px] overflow-y-auto">
            {bids.map((level, i) => (
              <Row
                key={`bid-${level.price}`}
                level={level}
                maxCumulative={maxCum}
                type="bid"
                cumulative={bidsCumulative[i]}
                onClick={() => onPriceClick?.(level.price)}
              />
            ))}
          </div>
        </>
      )}
    </motion.div>
  );
}
