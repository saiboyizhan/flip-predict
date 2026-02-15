"use client";

import { motion } from "motion/react";
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Wallet, TrendingUp, PieChart, Trophy, Inbox, ArrowRight } from "lucide-react";
import { PositionCard } from "./PositionCard";
import { usePortfolioStore } from "@/app/stores/usePortfolioStore";
import { useTradeStore } from "@/app/stores/useTradeStore";

interface HistoryRecord {
  id: string;
  marketTitle: string;
  side: "yes" | "no";
  amount: number;
  result: "won" | "lost";
  pnl: number;
  settledAt: string;
}

interface PositionListProps {
  history?: HistoryRecord[];
}

const STAT_COLOR_CLASS: Record<string, { badge: string; icon: string }> = {
  amber: {
    badge: "bg-blue-500/10 border-blue-500/30",
    icon: "text-blue-400",
  },
  blue: {
    badge: "bg-blue-500/10 border-blue-500/30",
    icon: "text-blue-400",
  },
  emerald: {
    badge: "bg-emerald-500/10 border-emerald-500/30",
    icon: "text-emerald-400",
  },
  red: {
    badge: "bg-red-500/10 border-red-500/30",
    icon: "text-red-400",
  },
  purple: {
    badge: "bg-purple-500/10 border-purple-500/30",
    icon: "text-purple-400",
  },
};

export function PositionList({ history = [] }: PositionListProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"positions" | "history">("positions");

  const positions = usePortfolioStore((s) => s.positions);
  const removePosition = usePortfolioStore((s) => s.removePosition);
  const executeAPISell = useTradeStore((s) => s.executeAPISell);
  const [sellingIds, setSellingIds] = useState<Set<string>>(new Set());

  const handleSell = async (positionId: string) => {
    if (sellingIds.has(positionId)) return;
    const position = positions.find((p) => p.id === positionId);
    if (!position) return;
    setSellingIds((prev) => new Set(prev).add(positionId));
    try {
      const result = await executeAPISell(position.marketId, position.side, position.shares);
      if (result.success) {
        removePosition(positionId);
      }
    } finally {
      setSellingIds((prev) => { const next = new Set(prev); next.delete(positionId); return next; });
    }
  };

  const totalValue = useMemo(
    () => positions.reduce((sum, p) => sum + p.shares * p.currentPrice, 0),
    [positions]
  );
  const totalPnl = useMemo(
    () => positions.reduce((sum, p) => {
      const cost = p.shares * p.avgCost;
      const value = p.shares * p.currentPrice;
      return sum + (value - cost);
    }, 0),
    [positions]
  );
  const wonCount = history.filter((h) => h.result === "won").length;
  const winRate = history.length > 0 ? (wonCount / history.length) * 100 : 0;

  const stats = [
    {
      label: t('portfolio.positionValue'),
      value: `$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: Wallet,
      color: "amber",
    },
    {
      label: t('portfolio.positionCount'),
      value: `${positions.length}`,
      icon: PieChart,
      color: "blue",
    },
    {
      label: t('portfolio.totalPnl'),
      value: `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: TrendingUp,
      color: totalPnl >= 0 ? "emerald" : "red",
    },
    {
      label: t('portfolio.winRate'),
      value: `${winRate.toFixed(1)}%`,
      icon: Trophy,
      color: "purple",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat, index) => {
          const color = STAT_COLOR_CLASS[stat.color] ?? STAT_COLOR_CLASS.amber;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-card border border-border rounded-xl p-6"
            >
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-8 h-8 border flex items-center justify-center ${color.badge}`}>
                  <stat.icon className={`w-4 h-4 ${color.icon}`} />
                </div>
                <span className="text-xs text-muted-foreground tracking-wider uppercase">{stat.label}</span>
              </div>
              <div className="text-2xl font-bold text-foreground font-mono">{stat.value}</div>
            </motion.div>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="relative flex border-b border-border">
        {["positions", "history"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as "positions" | "history")}
            className={`relative px-6 py-3 text-sm font-semibold tracking-wider uppercase transition-colors ${
              activeTab === tab
                ? "text-blue-400"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "positions"
              ? t('portfolio.currentPositions', { count: positions.length })
              : t('portfolio.tradeHistory', { count: history.length })}
            {activeTab === tab && (
              <motion.div
                layoutId="tab-indicator"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500"
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === "positions" && (
        <div>
          {positions.length === 0 ? (
            <div className="bg-card border border-border p-16 flex flex-col items-center justify-center">
              <Inbox className="w-16 h-16 text-muted-foreground mb-4" />
              <h3 className="text-xl font-bold text-muted-foreground mb-2">{t('portfolio.noPositions')}</h3>
              <p className="text-muted-foreground text-sm mb-6">{t('portfolio.noPositionsDesc')}</p>
              <button
                onClick={() => navigate("/")}
                className="flex items-center gap-2 px-6 py-3 bg-blue-500 hover:bg-blue-400 text-black font-semibold text-sm transition-all hover:scale-[1.02]"
              >
                {t('portfolio.discoverMarkets')}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {positions.map((position, index) => (
                <motion.div
                  key={position.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <PositionCard position={position} onSell={handleSell} />
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "history" && (
        <div>
          {history.length === 0 ? (
            <div className="bg-card border border-border p-16 flex flex-col items-center justify-center">
              <TrendingUp className="w-16 h-16 text-muted-foreground mb-4" />
              <h3 className="text-xl font-bold text-muted-foreground mb-2">{t('portfolio.noTradeHistory')}</h3>
              <p className="text-muted-foreground text-sm">{t('portfolio.noTradeHistoryDesc')}</p>
            </div>
          ) : (
            <div className="bg-card border border-border overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead className="bg-secondary/50 border-b border-border">
                  <tr>
                    <th className="text-left p-4 text-muted-foreground text-xs tracking-wider uppercase">{t('portfolio.market')}</th>
                    <th className="text-center p-4 text-muted-foreground text-xs tracking-wider uppercase">{t('portfolio.direction')}</th>
                    <th className="text-right p-4 text-muted-foreground text-xs tracking-wider uppercase">{t('portfolio.amount')}</th>
                    <th className="text-center p-4 text-muted-foreground text-xs tracking-wider uppercase">{t('portfolio.result')}</th>
                    <th className="text-right p-4 text-muted-foreground text-xs tracking-wider uppercase">{t('portfolio.pnl')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((record) => (
                    <tr key={record.id} className="hover:bg-accent/50 transition-colors">
                      <td className="p-4 text-foreground text-sm font-medium max-w-[200px] truncate">
                        {record.marketTitle}
                      </td>
                      <td className="p-4 text-center">
                        <span className={`px-2 py-0.5 text-xs font-bold ${
                          record.side === "yes"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-red-500/20 text-red-400"
                        }`}>
                          {record.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-4 text-right text-foreground font-mono text-sm">
                        ${record.amount.toFixed(2)}
                      </td>
                      <td className="p-4 text-center">
                        <span className={`text-xs font-bold ${
                          record.result === "won" ? "text-emerald-400" : "text-red-400"
                        }`}>
                          {record.result === "won" ? t('portfolio.won') : t('portfolio.lost')}
                        </span>
                      </td>
                      <td className={`p-4 text-right font-mono text-sm font-bold ${
                        record.pnl >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}>
                        {record.pnl >= 0 ? "+" : ""}${record.pnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
