"use client";

import React from "react";
import { CheckCircle2, Bot, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ShareButton } from "./ShareButton";

interface MarketOptionDisplay {
  id: string;
  label: string;
  color: string;
  price: number;
}

interface Market {
  id: string;
  title: string;
  category: string;
  categoryEmoji?: string;
  yesPrice: number;
  noPrice: number;
  volume: number;
  participants: number;
  endTime: string;
  status: "active" | "expiring" | "settled" | "pending_resolution" | "resolved";
  description?: string;
  resolution?: string;
  resolvedOutcome?: string;
  marketType?: "binary" | "multi";
  options?: MarketOptionDisplay[];
  totalLiquidity?: number;
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

/** Compute the effective display status of a market, factoring in time-to-expiry */
function getEffectiveStatus(market: Market): {
  status: string;
  labelKey: string;
  className: string;
  isExpiringSoon: boolean;
} {
  const isResolved = market.status === "resolved" || market.status === "settled";
  const isPending = market.status === "pending_resolution";

  if (isResolved) {
    return {
      status: "resolved",
      labelKey: "market.status.resolved",
      className: "bg-zinc-500/20 text-zinc-400 border border-zinc-500/30",
      isExpiringSoon: false,
    };
  }

  if (isPending) {
    return {
      status: "pending_resolution",
      labelKey: "market.status.pending",
      className: "bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse",
      isExpiringSoon: false,
    };
  }

  // Active -- check if expiring soon (<24h)
  const now = Date.now();
  const end = new Date(market.endTime).getTime();
  const diff = end - now;

  if (diff <= 0) {
    return {
      status: "expired",
      labelKey: "market.status.expired",
      className: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
      isExpiringSoon: false,
    };
  }

  if (diff < 24 * 60 * 60 * 1000) {
    return {
      status: "expiring",
      labelKey: "market.status.expiring",
      className: "bg-orange-500/20 text-orange-400 border border-orange-500/30 animate-pulse",
      isExpiringSoon: true,
    };
  }

  return {
    status: "active",
    labelKey: "market.status.active",
    className: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    isExpiringSoon: false,
  };
}

const MarketCardComponent = ({ market, size = "medium", onClick }: MarketCardProps) => {
  const { t } = useTranslation();

  const effectiveStatus = getEffectiveStatus(market);
  const isLowLiquidity = market.volume < 1000 || (market.totalLiquidity != null && market.totalLiquidity < 5000);

  function getTimeRemaining(endTime: string): { text: string; urgent: boolean; countdown?: string } {
    const now = new Date();
    const end = new Date(endTime);
    const diff = end.getTime() - now.getTime();
    if (diff <= 0) return { text: t("market.ended"), urgent: false };
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours >= 24) return { text: t("market.days", { count: Math.floor(hours / 24) }), urgent: false };
    if (hours > 0) return { text: t("market.hoursMinutes", { hours, minutes }), urgent: hours < 2, countdown: `${hours}h ${minutes}m` };
    return { text: t("market.minutes", { count: minutes }), urgent: true, countdown: `${minutes}m` };
  }

  const yesPercent = Math.round(market.yesPrice * 100);
  const noPercent = 100 - yesPercent;
  const isCompact = size === "compact";
  const isLarge = size === "large";

  const isResolved = market.status === "resolved" || market.status === "settled";
  const isPending = market.status === "pending_resolution";
  const { text: timeText, urgent, countdown } = getTimeRemaining(market.endTime);

  return (
    <div
      onClick={onClick}
      className={`relative flex flex-col h-full bg-card border border-gray-200 dark:border-white/[0.12] rounded-xl hover:border-blue-500/40 dark:hover:border-blue-500/30 transition-colors duration-150 cursor-pointer ${
        isCompact ? "p-3 sm:p-4" : isLarge ? "p-4 sm:p-6 md:p-8" : "p-3 sm:p-4 md:p-6"
      }`}
    >
      {/* Resolved outcome corner badge */}
      {isResolved && market.resolvedOutcome && (
        <div
          className={`absolute top-0 right-0 px-3 py-1 text-xs font-bold rounded-tr-xl ${
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
        <div className="absolute top-0 right-0 px-3 py-1 text-xs font-bold bg-amber-500/90 text-black rounded-tr-xl">
          <Bot className="w-3 h-3 inline mr-1" />
          {t('market.pendingBadge')}
        </div>
      )}

      {/* Top Row: Category + Status + Expiry Countdown */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 bg-muted text-muted-foreground text-xs font-medium rounded-lg">
            {t(`category.${market.category}`, market.category)}
          </span>
          {isLowLiquidity && !isResolved && (
            <span className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/25">
              <AlertTriangle className="w-3 h-3" />
              {t('market.lowLiquidity')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {effectiveStatus.isExpiringSoon && countdown && (
            <span className="px-2 py-1 text-xs font-bold font-mono rounded-lg bg-orange-500/15 text-orange-400 border border-orange-500/25">
              {countdown}
            </span>
          )}
          <span className={`flex items-center gap-1.5 px-2 py-1 text-xs font-semibold rounded-lg ${effectiveStatus.className}`}>
            {effectiveStatus.status === "active" && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
            {t(effectiveStatus.labelKey)}
          </span>
        </div>
      </div>

      {/* Title -- flex-1 so cards in same row align their bottom sections */}
      <h3
        className={`font-bold text-foreground mb-4 leading-tight flex-1 ${
          isLarge ? "text-lg sm:text-xl md:text-2xl" : isCompact ? "text-sm sm:text-base" : "text-sm sm:text-base md:text-lg"
        }`}
      >
        {market.title}
      </h3>

      {/* Option Buttons */}
      {market.marketType === "multi" && market.options && market.options.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {market.options.slice(0, 3).map((opt) => (
            <div
              key={opt.id}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border"
              style={{
                backgroundColor: `${opt.color}15`,
                borderColor: `${opt.color}30`,
                color: opt.color,
              }}
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: opt.color }} />
              {opt.label} {Math.round(opt.price * 100)}%
            </div>
          ))}
          {market.options.length > 3 && (
            <span className="text-xs text-muted-foreground px-2">
              {t('market.moreOptions', { count: market.options.length - 3 })}
            </span>
          )}
        </div>
      ) : (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
            <span className="text-emerald-400 font-mono tabular-nums">{t('market.yes')} {yesPercent}%</span>
            <span className="text-red-400 font-mono tabular-nums">{t('market.no')} {noPercent}%</span>
          </div>
          <div className="flex h-2 rounded-full overflow-hidden bg-white/[0.04]">
            <div
              className="bg-emerald-500/70 transition-all duration-500"
              style={{ width: `${yesPercent}%` }}
            />
            <div
              className="bg-red-500/70 transition-all duration-500"
              style={{ width: `${noPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats Row */}
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground ${isCompact ? "text-xs" : "text-xs"}`}>
        <span className="font-mono tabular-nums">${formatVolume(market.volume)}</span>
        <span className="text-white/10">|</span>
        <span className="whitespace-nowrap">{market.participants} {t('market.participants').toLowerCase()}</span>
        <span className="text-white/10">|</span>
        <span className={`whitespace-nowrap ${urgent ? "text-red-400" : ""}`}>{timeText}</span>
        <span className="ml-auto">
          <ShareButton
            marketTitle={market.title}
            marketId={market.id}
            yesPrice={market.yesPrice}
            compact
          />
        </span>
      </div>
    </div>
  );
};

export const MarketCard = React.memo(MarketCardComponent);

export type { Market };
