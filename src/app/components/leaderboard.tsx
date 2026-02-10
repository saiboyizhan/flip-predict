import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Trophy, Medal, TrendingUp, Crown, Award } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LevelBadge } from "@/app/components/profile/LevelBadge";
import { getLevelFromVolume } from "@/app/stores/useUserStore";
import { fetchLeaderboard } from "@/app/services/api";

interface LeaderboardEntry {
  rank: number;
  address: string;
  nickname: string;
  totalWagered: number;
  totalWon: number;
  winRate: number;
  netProfit: number;
  bestStreak: number;
}

export function Leaderboard() {
  const { t } = useTranslation();
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchLeaderboard()
      .then((res) => {
        if (cancelled) return;
        // Support both { leaderboard: [...] } and direct array
        const list = Array.isArray(res) ? res : (res.leaderboard ?? res.data ?? []);
        setData(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || t("leaderboard.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [t]);

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Crown className="w-6 h-6 sm:w-8 sm:h-8 text-amber-400" />;
      case 2:
        return <Medal className="w-6 h-6 sm:w-8 sm:h-8 text-zinc-300" />;
      case 3:
        return <Award className="w-6 h-6 sm:w-8 sm:h-8 text-orange-600" />;
      default:
        return <div className="w-6 h-6 sm:w-8 sm:h-8 flex items-center justify-center text-zinc-500 font-bold text-lg sm:text-xl">#{rank}</div>;
    }
  };

  const getRankBackground = (rank: number) => {
    switch (rank) {
      case 1:
        return "bg-gradient-to-br from-amber-900/30 to-zinc-950 border-amber-500/50";
      case 2:
        return "bg-gradient-to-br from-zinc-800/30 to-zinc-950 border-zinc-400/50";
      case 3:
        return "bg-gradient-to-br from-orange-900/30 to-zinc-950 border-orange-600/50";
      default:
        return "bg-zinc-900/30 border-zinc-800";
    }
  };

  // Skeleton loader
  if (loading) {
    return (
      <div className="min-h-screen p-4 sm:p-8">
        <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
          <div className="flex items-center gap-3 mb-6 sm:mb-8">
            <Trophy className="w-6 h-6 sm:w-8 sm:h-8 text-amber-400" />
            <h1 className="text-2xl sm:text-4xl font-bold tracking-tight">{t("leaderboard.title")}</h1>
          </div>
          {/* Skeleton Top 3 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-8 sm:mb-12">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-zinc-900/30 border border-zinc-800 p-6 sm:p-8 animate-pulse">
                <div className="w-16 h-16 bg-zinc-800 rounded-full mx-auto mb-4" />
                <div className="h-6 bg-zinc-800 rounded w-1/2 mx-auto mb-3" />
                <div className="h-8 bg-zinc-800 rounded w-2/3 mx-auto mb-2" />
                <div className="h-4 bg-zinc-800 rounded w-1/3 mx-auto" />
              </div>
            ))}
          </div>
          {/* Skeleton Table */}
          <div className="bg-zinc-900/30 border border-zinc-800">
            <div className="p-4 sm:p-6 border-b border-zinc-800">
              <div className="h-7 bg-zinc-800 rounded w-32 animate-pulse" />
            </div>
            <div className="space-y-0">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4 border-b border-zinc-800 animate-pulse">
                  <div className="w-8 h-8 bg-zinc-800 rounded" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-zinc-800 rounded w-1/4" />
                    <div className="h-3 bg-zinc-800 rounded w-1/6" />
                  </div>
                  <div className="h-4 bg-zinc-800 rounded w-20" />
                  <div className="h-4 bg-zinc-800 rounded w-20" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen p-4 sm:p-8">
        <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
          <div className="flex items-center gap-3 mb-6 sm:mb-8">
            <Trophy className="w-6 h-6 sm:w-8 sm:h-8 text-amber-400" />
            <h1 className="text-2xl sm:text-4xl font-bold tracking-tight">{t("leaderboard.title")}</h1>
          </div>
          <div className="text-center py-20">
            <p className="text-red-400 text-lg mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm transition-colors w-full sm:w-auto"
            >
              {t("common.retry")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (data.length === 0) {
    return (
      <div className="min-h-screen p-4 sm:p-8">
        <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
          <div className="flex items-center gap-3 mb-6 sm:mb-8">
            <Trophy className="w-6 h-6 sm:w-8 sm:h-8 text-amber-400" />
            <h1 className="text-2xl sm:text-4xl font-bold tracking-tight">{t("leaderboard.title")}</h1>
          </div>
          <div className="text-center py-20">
            <Trophy className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-500 text-lg">{t("common.noData")}</p>
          </div>
        </div>
      </div>
    );
  }

  const top3 = data.slice(0, 3);

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6 sm:mb-8">
          <Trophy className="w-6 h-6 sm:w-8 sm:h-8 text-amber-400" />
          <h1 className="text-2xl sm:text-4xl font-bold tracking-tight">{t("leaderboard.title")}</h1>
        </div>

        {/* Top 3 Podium */}
        {top3.length >= 3 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-8 sm:mb-12">
            {/* 2nd Place */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="sm:pt-12 order-2 sm:order-1"
            >
              <div className="bg-gradient-to-br from-zinc-800/30 to-zinc-950 border border-zinc-400/50 p-6 sm:p-8 text-center">
                <Medal className="w-12 h-12 sm:w-16 sm:h-16 text-zinc-300 mx-auto mb-3 sm:mb-4" />
                <div className="text-zinc-400 text-sm tracking-wider uppercase mb-2">{t("leaderboard.runnerUp")}</div>
                <div className="text-xl sm:text-2xl font-bold text-white mb-2">{top3[1].nickname}</div>
                <div className="text-emerald-400 text-2xl sm:text-3xl font-bold mb-1">+${top3[1].netProfit.toLocaleString()}</div>
                <div className="text-zinc-500 text-sm">{t("leaderboard.winRate")} {top3[1].winRate}%</div>
              </div>
            </motion.div>

            {/* 1st Place */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="order-1 sm:order-2"
            >
              <div className="bg-gradient-to-br from-amber-900/30 to-zinc-950 border-2 border-amber-500/50 p-6 sm:p-8 text-center">
                <Crown className="w-16 h-16 sm:w-20 sm:h-20 text-amber-400 mx-auto mb-3 sm:mb-4" />
                <div className="text-amber-400 text-sm tracking-wider uppercase mb-2">{t("leaderboard.champion")}</div>
                <div className="text-2xl sm:text-3xl font-bold text-white mb-2">{top3[0].nickname}</div>
                <div className="text-emerald-400 text-3xl sm:text-4xl font-bold mb-1">+${top3[0].netProfit.toLocaleString()}</div>
                <div className="text-zinc-500 text-sm mb-4">{t("leaderboard.winRate")} {top3[0].winRate}%</div>
                <div className="flex items-center justify-center gap-2 text-amber-400 text-sm">
                  <TrendingUp className="w-4 h-4" />
                  <span>{top3[0].bestStreak} {t("leaderboard.streak")}</span>
                </div>
              </div>
            </motion.div>

            {/* 3rd Place */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="sm:pt-12 order-3"
            >
              <div className="bg-gradient-to-br from-orange-900/30 to-zinc-950 border border-orange-600/50 p-6 sm:p-8 text-center">
                <Award className="w-12 h-12 sm:w-16 sm:h-16 text-orange-600 mx-auto mb-3 sm:mb-4" />
                <div className="text-orange-400 text-sm tracking-wider uppercase mb-2">{t("leaderboard.thirdPlace")}</div>
                <div className="text-xl sm:text-2xl font-bold text-white mb-2">{top3[2].nickname}</div>
                <div className="text-emerald-400 text-2xl sm:text-3xl font-bold mb-1">+${top3[2].netProfit.toLocaleString()}</div>
                <div className="text-zinc-500 text-sm">{t("leaderboard.winRate")} {top3[2].winRate}%</div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Full Leaderboard Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-zinc-900/30 border border-zinc-800"
        >
          <div className="p-4 sm:p-6 border-b border-zinc-800">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight">{t("leaderboard.fullList")}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead className="bg-zinc-900/50 border-b border-zinc-800">
                <tr>
                  <th className="text-left p-3 sm:p-4 text-zinc-500 text-xs sm:text-sm tracking-wider uppercase">{t("leaderboard.rank")}</th>
                  <th className="text-left p-3 sm:p-4 text-zinc-500 text-xs sm:text-sm tracking-wider uppercase">{t("leaderboard.player")}</th>
                  <th className="text-right p-3 sm:p-4 text-zinc-500 text-xs sm:text-sm tracking-wider uppercase hidden sm:table-cell">{t("leaderboard.totalWagered")}</th>
                  <th className="text-right p-3 sm:p-4 text-zinc-500 text-xs sm:text-sm tracking-wider uppercase hidden md:table-cell">{t("leaderboard.totalWon")}</th>
                  <th className="text-right p-3 sm:p-4 text-zinc-500 text-xs sm:text-sm tracking-wider uppercase">{t("leaderboard.winRate")}</th>
                  <th className="text-right p-3 sm:p-4 text-zinc-500 text-xs sm:text-sm tracking-wider uppercase">{t("leaderboard.netProfit")}</th>
                  <th className="text-right p-3 sm:p-4 text-zinc-500 text-xs sm:text-sm tracking-wider uppercase hidden lg:table-cell">{t("leaderboard.bestStreak")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {data.map((entry, index) => (
                  <motion.tr
                    key={entry.address}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 + index * 0.05 }}
                    className={`hover:bg-zinc-900/50 transition-colors ${getRankBackground(entry.rank)} border`}
                  >
                    <td className="p-3 sm:p-4">
                      <div className="flex items-center gap-3">
                        {getRankIcon(entry.rank)}
                      </div>
                    </td>
                    <td className="p-3 sm:p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-semibold text-sm sm:text-base">{entry.nickname}</span>
                        <LevelBadge level={getLevelFromVolume(entry.totalWagered)} size="sm" />
                      </div>
                      <div className="text-zinc-600 text-xs font-mono">{entry.address.slice(0, 6)}...{entry.address.slice(-4)}</div>
                    </td>
                    <td className="p-3 sm:p-4 text-right hidden sm:table-cell">
                      <div className="text-white font-mono text-sm">${entry.totalWagered.toLocaleString()}</div>
                    </td>
                    <td className="p-3 sm:p-4 text-right hidden md:table-cell">
                      <div className="text-white font-mono text-sm">${entry.totalWon.toLocaleString()}</div>
                    </td>
                    <td className="p-3 sm:p-4 text-right">
                      <div className="text-emerald-400 font-bold text-sm">{entry.winRate}%</div>
                    </td>
                    <td className="p-3 sm:p-4 text-right">
                      <div className="text-emerald-400 text-base sm:text-lg font-bold">+${entry.netProfit.toLocaleString()}</div>
                    </td>
                    <td className="p-3 sm:p-4 text-right hidden lg:table-cell">
                      <div className="flex items-center justify-end gap-2">
                        <TrendingUp className="w-4 h-4 text-amber-400" />
                        <span className="text-white font-semibold">{entry.bestStreak}</span>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
