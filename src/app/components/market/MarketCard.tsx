"use client";

import { motion } from "motion/react";
import { Users, TrendingUp, Clock, CheckCircle2, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ShareButton } from "./ShareButton";

interface Market {
  id: string;
  title: string;
  category: string;
  categoryEmoji: string;
  yesPrice: number;
  noPrice: number;
  volume: number;
  participants: number;
  endTime: string;
  status: "active" | "expiring" | "settled" | "pending_resolution" | "resolved";
  description?: string;
  resolution?: string;
  resolvedOutcome?: string;
}

interface MarketCardProps {
  market: Market;
  size?: "large" | "medium" | "compact";
  onClick?: () => void;
}

function formatVolume(volume: number): string {
  if (volume >= 1000000) return `${(volume / 1000000).toFixed(1)}M`;
  if (volume >= 1000) return `${(volume / 1000).toFixed(1)}K`;
  return volume.toString();
}

export function MarketCard({ market, size = "medium", onClick }: MarketCardProps) {
  const { t } = useTranslation();

  const STATUS_CONFIG: Record<
    string,
    { label: string; className: string }
  > = {
    active: {
      label: t("market.status.active"),
      className: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    },
    expiring: {
      label: t("market.status.expiring"),
      className: "bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse",
    },
    settled: {
      label: t("market.status.settled"),
      className: "bg-zinc-700/50 text-zinc-400 border border-zinc-600",
    },
    pending_resolution: {
      label: t("market.status.pending"),
      className: "bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse",
    },
    resolved: {
      label: t("market.status.resolved"),
      className: "bg-zinc-700/50 text-zinc-400 border border-zinc-600",
    },
  };

  function getTimeRemaining(endTime: string): { text: string; urgent: boolean } {
    const now = new Date();
    const end = new Date(endTime);
    const diff = end.getTime() - now.getTime();
    if (diff <= 0) return { text: t("market.ended"), urgent: false };
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours >= 24) return { text: t("market.days", { count: Math.floor(hours / 24) }), urgent: false };
    if (hours > 0) return { text: t("market.hoursMinutes", { hours, minutes }), urgent: hours < 2 };
    return { text: t("market.minutes", { count: minutes }), urgent: true };
  }

  const statusConfig = STATUS_CONFIG[market.status] ?? STATUS_CONFIG.active;
  const yesPercent = Math.round(market.yesPrice * 100);
  const noPercent = Math.round(market.noPrice * 100);
  const isCompact = size === "compact";
  const isLarge = size === "large";

  const isResolved = market.status === "resolved" || market.status === "settled";
  const isPending = market.status === "pending_resolution";
  const { text: timeText, urgent } = getTimeRemaining(market.endTime);

  return (
    <motion.div
      whileHover={{ y: -4 }}
      onClick={onClick}
      className={`group relative bg-zinc-900 border border-zinc-800 hover:border-amber-500/50 transition-all duration-300 cursor-pointer overflow-hidden ${
        isCompact ? "p-3 sm:p-4" : isLarge ? "p-4 sm:p-8" : "p-4 sm:p-6"
      }`}
    >
      {/* Resolved outcome corner badge */}
      {isResolved && market.resolvedOutcome && (
        <div
          className={`absolute top-0 right-0 px-3 py-1 text-xs font-bold ${
            market.resolvedOutcome.toLowerCase() === "yes"
              ? "bg-emerald-500 text-black"
              : "bg-red-500 text-white"
          }`}
        >
          <CheckCircle2 className="w-3 h-3 inline mr-1" />
          {market.resolvedOutcome}
        </div>
      )}

      {/* Pending badge */}
      {isPending && (
        <div className="absolute top-0 right-0 px-3 py-1 text-xs font-bold bg-amber-500/90 text-black">
          <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />
          {t("market.status.settling")}
        </div>
      )}

      {/* Top Row: Category + Status */}
      <div className="flex items-center justify-between mb-3">
        <span className="px-2 py-1 bg-zinc-800 text-zinc-400 text-xs font-medium">
          {market.category}
        </span>
        <span className={`px-2 py-1 text-xs font-semibold ${statusConfig.className}`}>
          {statusConfig.label}
        </span>
      </div>

      {/* Title */}
      <h3
        className={`font-bold text-white mb-4 leading-tight ${
          isLarge ? "text-xl sm:text-2xl" : isCompact ? "text-sm" : "text-base sm:text-lg"
        }`}
      >
        {market.title}
      </h3>

      {/* YES/NO Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full" />
            <span className="text-emerald-400 text-xs sm:text-sm font-semibold">{t("market.yes")} {yesPercent}%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-red-400 text-xs sm:text-sm font-semibold">{t("market.no")} {noPercent}%</span>
            <div className="w-2 h-2 bg-red-500 rounded-full" />
          </div>
        </div>
        <div className="relative h-2 bg-zinc-800 overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${yesPercent}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="absolute left-0 top-0 h-full bg-emerald-500"
          />
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${noPercent}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="absolute right-0 top-0 h-full bg-red-500"
          />
        </div>
      </div>

      {/* Stats Row */}
      <div className={`flex items-center gap-3 sm:gap-4 text-zinc-500 ${isCompact ? "text-xs" : "text-xs sm:text-sm"}`}>
        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5" />
          <span className="font-mono">${formatVolume(market.volume)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          <span>{market.participants}</span>
        </div>
        <div className={`flex items-center gap-1.5 ml-auto ${urgent ? "text-red-400" : ""}`}>
          <Clock className="w-3.5 h-3.5" />
          <span>{timeText}</span>
        </div>
        <ShareButton
          marketTitle={market.title}
          marketId={market.id}
          yesPrice={market.yesPrice}
          compact
        />
      </div>

      {/* Hover Glow */}
      <div className="absolute -inset-1 bg-gradient-to-r from-amber-500/10 to-amber-400/10 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10" />
    </motion.div>
  );
}

export type { Market };
