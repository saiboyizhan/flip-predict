"use client";

import { motion } from "motion/react";
import { useState, useMemo, useEffect } from "react";
import { useTransitionNavigate } from "@/app/hooks/useTransitionNavigate";
import { useTranslation } from "react-i18next";
import { Wallet, TrendingUp, PieChart, Trophy, Inbox, ArrowRight, Droplets } from "lucide-react";
import { PositionCard } from "./PositionCard";
import { usePortfolioStore } from "@/app/stores/usePortfolioStore";
import { useTradeStore } from "@/app/stores/useTradeStore";
import { getLpInfo } from "@/app/services/api";
import { useAuthStore } from "@/app/stores/useAuthStore";

interface HistoryRecord {
  id: string;
  marketTitle: string;
  side: "yes" | "no";
  amount: number;
  result: "won" | "lost" | "pending";
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
  const { navigate } = useTransitionNavigate();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"positions" | "history" | "lp">("positions");
  const address = useAuthStore((s) => s.address);
  const [lpPositions, setLpPositions] = useState<Array<{ marketId: string; marketTitle: string; shares: number; value: number; shareOfPool: number }>>([]);
  const [lpLoading, setLpLoading] = useState(false);

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

  // Fetch LP positions for all markets the user has positions in
  useEffect(() => {
    if (!address || positions.length === 0) return;
    setLpLoading(true);
    const marketIds = [...new Set(positions.map(p => p.marketId))];
    Promise.all(
      marketIds.map(id =>
        getLpInfo(id).then(info => ({
          marketId: id,
          marketTitle: positions.find(p => p.marketId === id)?.marketTitle || id,
          shares: info.userShares,
          value: info.userValue,
          shareOfPool: info.shareOfPool,
        })).catch(() => null)
      )
    ).then(results => {
      setLpPositions(results.filter((r): r is NonNullable<typeof r> => r !== null && r.shares > 0));
    }).finally(() => setLpLoading(false));
  }, [address, positions]);

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
  const settledHistory = history.filter((h) => h.result === "won" || h.result === "lost");
  const wonCount = history.filter((h) => h.result === "won").length;
  const winRate = settledHistory.length > 0 ? (wonCount / settledHistory.length) * 100 : 0;

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
        {["positions", "history", "lp"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as "positions" | "history" | "lp")}
            className={`relative px-6 py-3 text-sm font-semibold tracking-wider uppercase transition-colors ${
              activeTab === tab
                ? "text-blue-400"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "positions"
              ? t('portfolio.currentPositions', { count: positions.length })
              : tab === "history"
              ? t('portfolio.tradeHistory', { count: history.length })
              : `LP (${lpPositions.length})`}
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
                          record.result === "won" ? "text-emerald-400" : record.result === "lost" ? "text-red-400" : "text-muted-foreground"
                        }`}>
                          {record.result === "won" ? t('portfolio.won') : record.result === "lost" ? t('portfolio.lost') : t('portfolio.pending', 'Open')}
                        </span>
                      </td>
                      <td className={`p-4 text-right font-mono text-sm font-bold ${
                        record.result === "pending" ? "text-muted-foreground" : record.pnl >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}>
                        {record.result === "pending" ? "--" : `${record.pnl >= 0 ? "+" : ""}$${record.pnl.toFixed(2)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "lp" && (
        <div>
          {lpLoading ? (
            <div className="bg-card border border-border p-16 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : lpPositions.length === 0 ? (
            <div className="bg-card border border-border p-16 flex flex-col items-center justify-center">
              <Droplets className="w-16 h-16 text-muted-foreground mb-4" />
              <h3 className="text-xl font-bold text-muted-foreground mb-2">{t('portfolio.noLpPositions', 'No LP Positions')}</h3>
              <p className="text-muted-foreground text-sm">{t('portfolio.noLpPositionsDesc', 'You haven\'t provided liquidity to any markets yet.')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {lpPositions.map((lp, index) => (
                <motion.div
                  key={lp.marketId}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => navigate(`/market/${lp.marketId}`)}
                  className="bg-card border border-border rounded-xl p-5 cursor-pointer hover:border-blue-500/30 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Droplets className="w-4 h-4 text-blue-400" />
                    <span className="text-sm font-semibold text-foreground truncate">{lp.marketTitle}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div>
                      <div className="text-muted-foreground mb-1">{t('lp.yourShares', 'LP Shares')}</div>
                      <div className="font-mono font-semibold">{lp.shares.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">{t('lp.yourValue', 'Value')}</div>
                      <div className="font-mono font-semibold text-blue-400">${lp.value.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">{t('lp.poolShare', 'Pool Share')}</div>
                      <div className="font-mono font-semibold">{(lp.shareOfPool * 100).toFixed(1)}%</div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
