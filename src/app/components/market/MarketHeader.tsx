"use client";

import { motion } from "motion/react";
import { Clock, Users, TrendingUp, BarChart3 } from "lucide-react";
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
  categoryEmoji: string;
  yesPrice: number;
  noPrice: number;
  volume: number;
  participants: number;
  endTime: string;
  status: "active" | "expiring" | "settled" | "pending_resolution" | "resolved";
  description?: string;
  resolution?: string;
  marketType?: "binary" | "multi";
  options?: MarketOptionDisplay[];
}

interface MarketHeaderProps {
  market: Market;
}

const STATUS_CONFIG = {
  active: {
    labelKey: "market.status.active",
    className: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
  },
  expiring: {
    labelKey: "market.status.expiring",
    className: "bg-blue-500/20 text-blue-400 border border-blue-500/30 animate-pulse",
  },
  settled: {
    labelKey: "market.status.settled",
    className: "bg-muted/50 text-muted-foreground border border-border",
  },
  pending_resolution: {
    labelKey: "market.status.pending",
    className: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
  },
  resolved: {
    labelKey: "market.status.resolved",
    className: "bg-muted/50 text-muted-foreground border border-border",
  },
};

function getTimeRemainingParts(endTime: string): { key: string; params?: Record<string, unknown> } {
  const now = new Date();
  const end = new Date(endTime);
  const diff = end.getTime() - now.getTime();
  if (diff <= 0) return { key: "market.ended" };
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) return { key: "market.daysHours", params: { days, hours } };
  if (hours > 0) return { key: "market.hoursMin", params: { hours, minutes } };
  return { key: "market.minutes", params: { count: minutes } };
}

function formatVolume(volume: number): string {
  if (volume >= 1000000) return `$${(volume / 1000000).toFixed(1)}M`;
  if (volume >= 1000) return `$${(volume / 1000).toFixed(1)}K`;
  return `$${volume}`;
}

export function MarketHeader({ market }: MarketHeaderProps) {
  const { t } = useTranslation();
  const statusConfig = STATUS_CONFIG[market.status] ?? STATUS_CONFIG.active;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border p-8 relative overflow-hidden"
    >
      {/* Decorative blur */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl pointer-events-none" />

      {/* Top Labels */}
      <div className="flex items-center gap-3 mb-4">
        <span className="px-3 py-1 bg-muted text-muted-foreground text-xs font-medium">
          {market.categoryEmoji} {t(`category.${market.category}`, market.category)}
        </span>
        <span className={`px-3 py-1 text-xs font-semibold ${statusConfig.className}`}>
          {t(statusConfig.labelKey)}
        </span>
      </div>

      {/* Title */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <h1 className="text-3xl font-bold text-foreground leading-tight">
          {market.title}
        </h1>
        <ShareButton
          marketTitle={market.title}
          marketId={market.id}
          yesPrice={market.yesPrice}
        />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-secondary/50 border border-border/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-muted-foreground tracking-wider uppercase">{t('market.countdown')}</span>
          </div>
          <div className="text-xl font-bold text-blue-400 font-mono">
            {(() => { const r = getTimeRemainingParts(market.endTime); return t(r.key, r.params); })()}
          </div>
        </div>

        <div className="bg-secondary/50 border border-border/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-muted-foreground tracking-wider uppercase">{t('market.volume')}</span>
          </div>
          <div className="text-xl font-bold text-foreground font-mono">
            {formatVolume(market.volume)}
          </div>
        </div>

        <div className="bg-secondary/50 border border-border/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-purple-400" />
            <span className="text-xs text-muted-foreground tracking-wider uppercase">{t('market.participants')}</span>
          </div>
          <div className="text-xl font-bold text-foreground font-mono">
            {market.participants.toLocaleString()}
          </div>
        </div>

        <div className="bg-secondary/50 border border-border/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-muted-foreground tracking-wider uppercase">{t('market.currentProb')}</span>
          </div>
          {market.marketType === "multi" && market.options && market.options.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {market.options.map((opt) => (
                <div key={opt.id} className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: opt.color }} />
                  <span className="text-xs font-mono font-bold" style={{ color: opt.color }}>
                    {Math.round(opt.price * 100)}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xl font-bold font-mono">
              <span className="text-emerald-400">{Math.round(market.yesPrice * 100)}%</span>
              <span className="text-muted-foreground mx-1">/</span>
              <span className="text-red-400">{100 - Math.round(market.yesPrice * 100)}%</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
