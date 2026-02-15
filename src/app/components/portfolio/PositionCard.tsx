"use client";

import { motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Position } from "@/app/types/market.types";

interface PositionCardProps {
  position: Position;
  onSell?: (positionId: string) => void;
}

export function PositionCard({ position, onSell }: PositionCardProps) {
  const { t } = useTranslation();
  const totalCost = position.shares * position.avgCost;
  const currentValue = position.shares * position.currentPrice;
  const pnl = currentValue - totalCost;
  const pnlPercent = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
  const isProfit = pnl >= 0;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="bg-card border border-border rounded-xl hover:shadow-lg hover:shadow-blue-500/5 hover:-translate-y-0.5 transition-all duration-300 p-6"
    >
      {/* Top Row: Title + Direction */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0 mr-4">
          <h3 className="text-foreground font-bold text-lg leading-tight truncate">
            {position.marketTitle}
          </h3>
        </div>
        <span
          className={`shrink-0 px-3 py-1 text-sm font-bold ${
            position.side === "yes"
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-red-500/20 text-red-400 border border-red-500/30"
          }`}
        >
          {position.side === "yes" ? t('market.yes') : t('market.no')}
        </span>
      </div>

      {/* Unrealized P&L Banner */}
      <div className={`flex items-center justify-between mb-4 px-4 py-3 rounded-lg border ${
        isProfit
          ? "bg-emerald-500/10 border-emerald-500/20"
          : "bg-red-500/10 border-red-500/20"
      }`}>
        <div>
          <div className="text-xs text-muted-foreground tracking-wider uppercase mb-0.5">Unrealized P&L</div>
          <div className={`flex items-center gap-1.5 font-mono font-bold text-lg ${isProfit ? "text-emerald-400" : "text-red-400"}`}>
            {isProfit ? (
              <ArrowUpRight className="w-5 h-5" />
            ) : (
              <ArrowDownRight className="w-5 h-5" />
            )}
            <span>{isProfit ? "+" : "-"}${Math.abs(pnl).toFixed(2)}</span>
          </div>
        </div>
        <div className={`text-right font-mono font-bold text-sm px-2 py-1 rounded ${
          isProfit
            ? "bg-emerald-500/20 text-emerald-400"
            : "bg-red-500/20 text-red-400"
        }`}>
          {isProfit ? "+" : ""}{pnlPercent.toFixed(1)}%
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-xs text-muted-foreground tracking-wider uppercase mb-1">{t('portfolio.shares')}</div>
          <div className="text-foreground font-mono font-semibold">{position.shares.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground tracking-wider uppercase mb-1">{t('portfolio.avgCost')}</div>
          <div className="text-foreground font-mono font-semibold">${position.avgCost.toFixed(4)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground tracking-wider uppercase mb-1">Market Value</div>
          <div className="text-foreground font-mono font-semibold">${currentValue.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground tracking-wider uppercase mb-1">Cost Basis</div>
          <div className="text-foreground font-mono font-semibold">${totalCost.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground tracking-wider uppercase mb-1">{t('portfolio.currentPrice')}</div>
          <div className="text-foreground font-mono font-semibold">${position.currentPrice.toFixed(4)}</div>
        </div>
      </div>

      {/* Sell Button */}
      {onSell && (
        <button
          onClick={() => onSell(position.id)}
          className="w-full py-3 bg-muted hover:bg-accent text-muted-foreground hover:text-foreground font-semibold text-sm tracking-wide uppercase transition-all rounded-lg"
        >
          {t('portfolio.sell')}
        </button>
      )}
    </motion.div>
  );
}

export type { Position };
