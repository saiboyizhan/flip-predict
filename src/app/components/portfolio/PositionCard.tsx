"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { useContractPosition } from "@/app/hooks/useContracts";
import type { Position } from "@/app/types/market.types";

interface PositionCardProps {
  position: Position;
  onSell?: (positionId: string) => void;
}

export function PositionCard({ position, onSell }: PositionCardProps) {
  const { t } = useTranslation();
  const { address } = useAccount();

  // Read on-chain position as source of truth
  const marketIdBigint = useMemo(() => {
    if (!position.onChainMarketId) return undefined;
    try { return BigInt(position.onChainMarketId); } catch { return undefined; }
  }, [position.onChainMarketId]);

  const { position: onChainPos } = useContractPosition(marketIdBigint, address as `0x${string}` | undefined);

  // Use on-chain shares if available, fallback to DB shares
  const shares = useMemo(() => {
    if (!onChainPos) return position.shares;
    const yesAmount = Number(formatUnits(onChainPos.yesAmount, 18));
    const noAmount = Number(formatUnits(onChainPos.noAmount, 18));
    return position.side === 'yes' ? yesAmount : noAmount;
  }, [onChainPos, position.shares, position.side]);

  const totalCost = shares * position.avgCost;
  const currentValue = shares * position.currentPrice;
  const pnl = currentValue - totalCost;
  const pnlPercent = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
  const isProfit = pnl >= 0;

  // Don't render if on-chain shows 0 shares
  if (onChainPos && shares <= 0.001) return null;

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
          <div className="text-foreground font-mono font-semibold">{shares.toFixed(2)}</div>
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
