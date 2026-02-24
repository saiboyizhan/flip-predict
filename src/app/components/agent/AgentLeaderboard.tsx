import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Crown, Medal, Award, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getAgentLeaderboard } from "@/app/services/api";
import type { Agent } from "@/app/services/api";

export function AgentLeaderboard() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const STRATEGY_MAP: Record<string, string> = {
    conservative: t("agent.strategies.conservative"),
    aggressive: t("agent.strategies.aggressive"),
    contrarian: t("agent.strategies.contrarian"),
    momentum: t("agent.strategies.momentum"),
    random: t("agent.strategies.random"),
  };

  useEffect(() => {
    getAgentLeaderboard()
      .then(setAgents)
      .catch((e) => { console.warn('[AgentLeaderboard] Failed to load:', e.message) })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">{t("common.loading")}</div>;
  }

  if (agents.length === 0) {
    return <div className="p-8 text-center text-muted-foreground">{t("agent.noLeaderboardData")}</div>;
  }

  const top3 = agents.slice(0, 3);
  const rest = agents;

  return (
    <div className="space-y-6">
      {/* Top 3 Podium */}
      {top3.length >= 3 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
          {/* 2nd Place */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="sm:pt-12 order-2 sm:order-1"
          >
            <div className="bg-gradient-to-br from-muted/30 to-secondary border border-zinc-400/50 p-4 text-center">
              <Medal className="w-7 h-7 text-zinc-400 dark:text-zinc-300 mx-auto mb-2" />
              <div className="text-muted-foreground text-[10px] tracking-wider uppercase mb-1">{t("leaderboard.runnerUp")}</div>
              <div className="text-sm font-bold text-foreground mb-0.5">{top3[1].name}</div>
              <div className="text-muted-foreground text-[10px] mb-1">{STRATEGY_MAP[top3[1].strategy] || top3[1].strategy}</div>
              <div className={`text-base font-bold ${top3[1].roi >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {top3[1].roi >= 0 ? "+" : ""}{top3[1].roi.toFixed(1)}% {t("agent.roi")}
              </div>
            </div>
          </motion.div>

          {/* 1st Place */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="order-1 sm:order-2"
          >
            <div className="bg-gradient-to-br from-blue-900/30 to-secondary border-2 border-blue-500/50 p-4 text-center">
              <Crown className="w-8 h-8 text-blue-400 mx-auto mb-2" />
              <div className="text-blue-400 text-[10px] tracking-wider uppercase mb-1">{t("leaderboard.champion")}</div>
              <div className="text-sm sm:text-base font-bold text-foreground mb-0.5">{top3[0].name}</div>
              <div className="text-muted-foreground text-[10px] mb-1">{STRATEGY_MAP[top3[0].strategy] || top3[0].strategy}</div>
              <div className={`text-lg font-bold mb-1 ${top3[0].roi >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {top3[0].roi >= 0 ? "+" : ""}{top3[0].roi.toFixed(1)}% {t("agent.roi")}
              </div>
              <div className="flex items-center justify-center gap-1.5 text-blue-400 text-xs">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>{top3[0].winning_trades}/{top3[0].total_trades} {t("leaderboard.wins")}</span>
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
            <div className="bg-gradient-to-br from-orange-900/30 to-secondary border border-orange-600/50 p-4 text-center">
              <Award className="w-7 h-7 text-orange-600 mx-auto mb-2" />
              <div className="text-orange-400 text-[10px] tracking-wider uppercase mb-1">{t("leaderboard.thirdPlace")}</div>
              <div className="text-sm font-bold text-foreground mb-0.5">{top3[2].name}</div>
              <div className="text-muted-foreground text-[10px] mb-1">{STRATEGY_MAP[top3[2].strategy] || top3[2].strategy}</div>
              <div className={`text-base font-bold ${top3[2].roi >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {top3[2].roi >= 0 ? "+" : ""}{top3[2].roi.toFixed(1)}% {t("agent.roi")}
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Full Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-muted/30 border border-border"
      >
        <div className="p-4 sm:p-6 border-b border-border">
          <h2 className="text-sm sm:text-base font-bold">{t("agent.fullList")}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left p-3 text-muted-foreground text-xs uppercase tracking-wider">{t("leaderboard.rank")}</th>
                <th className="text-left p-3 text-muted-foreground text-xs uppercase tracking-wider">Agent</th>
                <th className="text-center p-3 text-muted-foreground text-xs uppercase tracking-wider hidden sm:table-cell">{t("agent.strategy")}</th>
                <th className="text-right p-3 text-muted-foreground text-xs uppercase tracking-wider">{t("agent.roi")}</th>
                <th className="text-right p-3 text-muted-foreground text-xs uppercase tracking-wider">{t("agent.winRate")}</th>
                <th className="text-right p-3 text-muted-foreground text-xs uppercase tracking-wider hidden md:table-cell">{t("agent.totalProfit")}</th>
                <th className="text-center p-3 text-muted-foreground text-xs uppercase tracking-wider hidden lg:table-cell">{t("agent.level")}</th>
                <th className="text-right p-3 text-muted-foreground text-xs uppercase tracking-wider hidden lg:table-cell">{t("agent.trades")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rest.map((agent, index) => {
                const rank = index + 1;
                const getRankBg = () => {
                  if (rank === 1) return "bg-gradient-to-r from-blue-900/20 to-transparent";
                  if (rank === 2) return "bg-gradient-to-r from-muted/20 to-transparent";
                  if (rank === 3) return "bg-gradient-to-r from-orange-900/20 to-transparent";
                  return "";
                };
                return (
                  <motion.tr
                    key={agent.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 + index * 0.03 }}
                    className={`hover:bg-accent transition-colors ${getRankBg()}`}
                  >
                    <td className="p-3">
                      {rank === 1 ? <Crown className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400" /> :
                       rank === 2 ? <Medal className="w-5 h-5 sm:w-6 sm:h-6 text-zinc-400 dark:text-zinc-300" /> :
                       rank === 3 ? <Award className="w-5 h-5 sm:w-6 sm:h-6 text-orange-600" /> :
                       <span className="text-muted-foreground font-bold text-sm">#{rank}</span>}
                    </td>
                    <td className="p-3">
                      <span className="text-foreground font-semibold text-sm">{agent.name}</span>
                    </td>
                    <td className="p-3 text-center hidden sm:table-cell">
                      <span className="text-muted-foreground text-xs sm:text-sm">{STRATEGY_MAP[agent.strategy] || agent.strategy}</span>
                    </td>
                    <td className="p-3 text-right">
                      <span className={`font-bold font-mono text-sm ${agent.roi >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {agent.roi >= 0 ? "+" : ""}{agent.roi.toFixed(1)}%
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <span className="text-foreground font-mono text-sm">{agent.win_rate.toFixed(1)}%</span>
                    </td>
                    <td className="p-3 text-right hidden md:table-cell">
                      <span className={`font-bold font-mono text-sm ${agent.total_profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {agent.total_profit >= 0 ? "+" : ""}${agent.total_profit.toFixed(2)}
                      </span>
                    </td>
                    <td className="p-3 text-center hidden lg:table-cell">
                      <span className="px-2 py-0.5 bg-blue-500 text-black text-xs font-bold">Lv.{agent.level}</span>
                    </td>
                    <td className="p-3 text-right text-muted-foreground font-mono text-sm hidden lg:table-cell">{agent.total_trades}</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}
