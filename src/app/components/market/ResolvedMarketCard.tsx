"use client";

import { motion } from "motion/react";
import { CheckCircle2, Bot, User, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ResolvedMarketCardProps {
  market: {
    id: string;
    title: string;
    category?: string;
    categoryEmoji?: string;
    volume?: number;
  };
  resolution?: {
    outcome?: string;
    resolution_type?: string;
    oracle_pair?: string;
    resolved_price?: number;
    resolved_at?: string;
  };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function formatPrice(price: number): string {
  return price.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }) + " BNB";
}

export function ResolvedMarketCard({
  market,
  resolution,
}: ResolvedMarketCardProps) {
  const { t } = useTranslation();
  const isYes = resolution?.outcome?.toLowerCase() === "yes";
  const isOracle =
    resolution?.resolution_type === "price_above" ||
    resolution?.resolution_type === "price_below";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className="bg-card border border-border hover:border-border p-4 transition-colors cursor-pointer"
    >
      {/* Top row */}
      <div className="flex items-center justify-between mb-2">
        {market.categoryEmoji && (
          <span className="text-xs text-muted-foreground">
            {market.categoryEmoji} {t(`category.${market.category}`, market.category)}
          </span>
        )}
        <span
          className={`px-2 py-0.5 text-xs font-bold ${
            isYes
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-red-500/20 text-red-400 border border-red-500/30"
          }`}
        >
          {t('resolved.won', { side: isYes ? "YES" : "NO" })}
        </span>
      </div>

      {/* Title */}
      <h4 className="text-sm font-bold text-foreground mb-3 leading-tight line-clamp-2">
        {market.title}
      </h4>

      {/* Resolution info */}
      <div className="space-y-1.5 text-xs text-muted-foreground">
        {/* Resolution type */}
        <div className="flex items-center gap-1.5">
          {isOracle ? (
            <Bot className="w-3 h-3 text-blue-400" />
          ) : resolution?.resolution_type === "manual" ? (
            <User className="w-3 h-3 text-muted-foreground" />
          ) : (
            <Bot className="w-3 h-3 text-emerald-400" />
          )}
          <span>
            {isOracle
              ? t('resolved.oracle', { pair: resolution?.oracle_pair ?? "" })
              : resolution?.resolution_type === "manual"
                ? t('resolved.manualSettlement')
                : t('resolved.autoSettlement')}
          </span>
        </div>

        {/* Oracle price */}
        {isOracle && resolution?.resolved_price != null && (
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span>
              {resolution.oracle_pair} = {formatPrice(resolution.resolved_price)}
            </span>
          </div>
        )}

        {/* Resolved time */}
        {resolution?.resolved_at && (
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            <span>{formatDate(resolution.resolved_at)}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
