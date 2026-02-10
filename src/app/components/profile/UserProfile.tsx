"use client";

import { motion } from "motion/react";
import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Copy,
  Check,
  Wallet,
  TrendingUp,
  BarChart3,
  Trophy,
  Inbox,
  ArrowLeft,
  Bot,
  Activity,
  Loader2,
} from "lucide-react";
import { PositionCard } from "@/app/components/portfolio/PositionCard";
import { usePortfolioStore } from "@/app/stores/usePortfolioStore";
import { useUserStore } from "@/app/stores/useUserStore";
import { LevelBadge } from "@/app/components/profile/LevelBadge";
import { AchievementGrid } from "@/app/components/profile/AchievementGrid";
import { fetchUserStats, fetchTradeHistory, getMyAgents } from "@/app/services/api";

/** Generate two hex colors from a wallet address for the avatar gradient */
function addressToColors(address: string): [string, string] {
  const hex = address.toLowerCase().replace("0x", "");
  const c1 = `#${hex.slice(0, 6)}`;
  const c2 = `#${hex.slice(6, 12)}`;
  return [c1, c2];
}

function WalletAvatar({ address }: { address: string }) {
  const [c1, c2] = addressToColors(address);
  return (
    <div
      className="w-20 h-20 shrink-0"
      style={{
        background: `linear-gradient(135deg, ${c1}, ${c2})`,
      }}
    />
  );
}

/** Truncate address: 0x1234...abcd */
function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Format number with $ sign */
function formatUsd(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

interface StatsData {
  totalTrades: number;
  totalVolume: number;
  winRate: number;
  unrealizedPnl: number;
  activePositions: number;
  winningTrades: number;
}

interface RecentTrade {
  id: string;
  market_id: string;
  market_title: string;
  side: string;
  type: string;
  amount: number;
  shares: number;
  price: number;
  created_at: number;
}

export function UserProfile() {
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const positions = usePortfolioStore((s) => s.positions);
  const removePosition = usePortfolioStore((s) => s.removePosition);
  const userLevel = useUserStore((s) => s.getUserLevel());

  // Backend data
  const [stats, setStats] = useState<StatsData | null>(null);
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [agentCount, setAgentCount] = useState(0);
  const [loadingStats, setLoadingStats] = useState(false);

  useEffect(() => {
    if (!isConnected || !address) return;

    let cancelled = false;
    setLoadingStats(true);

    Promise.allSettled([
      fetchUserStats(address),
      fetchTradeHistory(address),
      getMyAgents(),
    ]).then(([statsResult, tradesResult, agentsResult]) => {
      if (cancelled) return;

      if (statsResult.status === "fulfilled") {
        const s = (statsResult.value as any).stats || statsResult.value;
        setStats({
          totalTrades: s.totalTrades || 0,
          totalVolume: s.totalVolume || 0,
          winRate: s.winRate || 0,
          unrealizedPnl: s.unrealizedPnl || 0,
          activePositions: s.activePositions || 0,
          winningTrades: s.winningTrades || 0,
        });
      }

      if (tradesResult.status === "fulfilled") {
        const data = tradesResult.value as any;
        const trades = data.trades || data.orders || [];
        setRecentTrades(trades.slice(0, 5));
      }

      if (agentsResult.status === "fulfilled") {
        const agents = agentsResult.value as any[];
        setAgentCount(Array.isArray(agents) ? agents.length : 0);
      }

      setLoadingStats(false);
    });

    return () => { cancelled = true; };
  }, [address, isConnected]);

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success(t("profile.addressCopied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("profile.copyFailed"));
    }
  };

  // ---------- Not connected state ----------
  if (!isConnected || !address) {
    return (
      <div className="flex flex-col items-center justify-center py-32 px-6">
        <Wallet className="w-16 h-16 text-zinc-700 mb-4" />
        <h2 className="text-xl font-bold text-zinc-400 mb-2">{t("profile.connectWalletFirst")}</h2>
        <p className="text-zinc-600 text-sm mb-6">{t("profile.connectWalletDesc")}</p>
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-amber-400 hover:text-amber-300 text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("profile.backToHome")}
        </button>
      </div>
    );
  }

  // ---------- Stats cards data ----------
  const statCards = [
    {
      label: t("profile.totalTrades"),
      value: loadingStats ? "..." : `${stats?.totalTrades ?? 0}`,
      icon: BarChart3,
      colorClass: "text-blue-400 bg-blue-500/10 border-blue-500/30",
    },
    {
      label: t("profile.totalVolume"),
      value: loadingStats ? "..." : `$${(stats?.totalVolume ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
      icon: Wallet,
      colorClass: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    },
    {
      label: t("profile.winRate"),
      value: loadingStats ? "..." : `${((stats?.winRate ?? 0) * 100).toFixed(1)}%`,
      icon: Trophy,
      colorClass: "text-purple-400 bg-purple-500/10 border-purple-500/30",
    },
    {
      label: t("profile.pnl"),
      value: loadingStats ? "..." : formatUsd(stats?.unrealizedPnl ?? 0),
      icon: TrendingUp,
      colorClass: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    },
  ];

  return (
    <div className="space-y-8">
      {/* ========== Banner ========== */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden bg-gradient-to-r from-amber-500/5 via-zinc-900 to-emerald-500/5 border border-zinc-800 p-6 sm:p-8"
      >
        <div className="flex flex-col sm:flex-row items-center sm:items-center gap-4 sm:gap-6">
          <WalletAvatar address={address} />

          <div className="min-w-0 text-center sm:text-left">
            <div className="flex items-center justify-center sm:justify-start gap-3 mb-1">
              <h1 className="text-xl sm:text-2xl font-bold text-white">{t("profile.player")}</h1>
              <LevelBadge level={userLevel.level} size="md" />
            </div>

            {/* Wallet address (truncated) + copy */}
            <div className="flex items-center justify-center sm:justify-start gap-2 mb-2">
              <span className="text-zinc-400 font-mono text-xs sm:text-sm">
                {truncateAddress(address)}
              </span>
              <button
                onClick={handleCopy}
                className="shrink-0 p-1 text-zinc-500 hover:text-amber-400 transition-colors"
                title={address}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Member since + quick stats badges */}
            <div className="flex items-center justify-center sm:justify-start gap-3 flex-wrap">
              <span className="text-zinc-600 text-xs">
                {t("profile.memberSince")}: 2026-01
              </span>
              {stats && (
                <>
                  <span className="text-xs text-zinc-500 flex items-center gap-1">
                    <Activity className="w-3 h-3" />
                    {t("profile.activePositions")}: {stats.activePositions}
                  </span>
                  {agentCount > 0 && (
                    <span className="text-xs text-zinc-500 flex items-center gap-1">
                      <Bot className="w-3 h-3" />
                      {t("profile.myAgents")}: {agentCount}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Background glow */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
      </motion.div>

      {/* ========== Stats Cards ========== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((stat, index) => {
          const [textColor, bgColor, borderColor] = stat.colorClass.split(" ");
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-zinc-900 border border-zinc-800 p-4 sm:p-6"
            >
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-7 h-7 sm:w-8 sm:h-8 ${bgColor} border ${borderColor} flex items-center justify-center`}>
                  <stat.icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${textColor}`} />
                </div>
                <span className="text-[10px] sm:text-xs text-zinc-500 tracking-wider uppercase">
                  {stat.label}
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-white font-mono">
                {loadingStats ? (
                  <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
                ) : (
                  stat.value
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* ========== Recent Activity Feed ========== */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <h2 className="text-xl font-bold text-white mb-4">{t("profile.recentActivity")}</h2>
        {recentTrades.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 p-8 flex flex-col items-center justify-center">
            <Activity className="w-10 h-10 text-zinc-700 mb-3" />
            <p className="text-zinc-500 text-sm">{t("profile.noActivity")}</p>
          </div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 divide-y divide-zinc-800">
            {recentTrades.map((trade) => (
              <div key={trade.id} className="px-4 py-3 flex items-center justify-between hover:bg-zinc-800/50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-8 h-8 flex items-center justify-center text-xs font-bold border ${
                    trade.side === 'yes'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-red-500/10 border-red-500/30 text-red-400'
                  }`}>
                    {trade.side === 'yes' ? 'Y' : 'N'}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm text-white truncate max-w-[200px] sm:max-w-[300px]">
                      {trade.market_title || trade.market_id}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {trade.type === 'buy' ? 'Buy' : 'Sell'} &middot; {new Date(trade.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <div className="text-sm font-mono text-white">
                    ${trade.amount?.toFixed(2) ?? '0.00'}
                  </div>
                  <div className="text-xs text-zinc-500">
                    @{trade.price?.toFixed(2) ?? '0.00'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* ========== Level & Achievements ========== */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <AchievementGrid />
      </motion.div>

      {/* ========== Recent Positions ========== */}
      <div>
        <h2 className="text-xl font-bold text-white mb-4">{t("profile.recentPositions")}</h2>

        {positions.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 p-16 flex flex-col items-center justify-center">
            <Inbox className="w-16 h-16 text-zinc-700 mb-4" />
            <h3 className="text-xl font-bold text-zinc-400 mb-2">{t("profile.noPositions")}</h3>
            <p className="text-zinc-600 text-sm">{t("profile.noPositionsDesc")}</p>
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
                <PositionCard position={position} onSell={removePosition} />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
