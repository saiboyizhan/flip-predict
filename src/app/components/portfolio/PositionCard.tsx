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
      className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-all p-6"
    >
      {/* Top Row: Title + Direction */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0 mr-4">
          <h3 className="text-white font-bold text-lg leading-tight truncate">
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
          {position.side === "yes" ? "YES" : "NO"}
        </span>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-xs text-zinc-500 tracking-wider uppercase mb-1">{t('portfolio.shares')}</div>
          <div className="text-white font-mono font-semibold">{position.shares.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500 tracking-wider uppercase mb-1">{t('portfolio.avgCost')}</div>
          <div className="text-white font-mono font-semibold">${position.avgCost.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500 tracking-wider uppercase mb-1">{t('portfolio.currentPrice')}</div>
          <div className="text-white font-mono font-semibold">${position.currentPrice.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500 tracking-wider uppercase mb-1">{t('portfolio.pnl')}</div>
          <div className={`flex items-center gap-1 font-mono font-bold ${isProfit ? "text-emerald-400" : "text-red-400"}`}>
            {isProfit ? (
              <ArrowUpRight className="w-4 h-4" />
            ) : (
              <ArrowDownRight className="w-4 h-4" />
            )}
            <span>${Math.abs(pnl).toFixed(2)}</span>
            <span className="text-xs">({isProfit ? "+" : ""}{pnlPercent.toFixed(1)}%)</span>
          </div>
        </div>
      </div>

      {/* Sell Button */}
      {onSell && (
        <button
          onClick={() => onSell(position.id)}
          className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white font-semibold text-sm tracking-wide uppercase transition-all"
        >
          {t('portfolio.sell')}
        </button>
      )}
    </motion.div>
  );
}

export type { Position };
