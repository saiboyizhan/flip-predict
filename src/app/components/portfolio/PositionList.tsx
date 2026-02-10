"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Wallet, TrendingUp, PieChart, Trophy, Inbox, ArrowRight } from "lucide-react";
import { PositionCard } from "./PositionCard";
import { usePortfolioStore } from "@/app/stores/usePortfolioStore";

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

export function PositionList({ history = [] }: PositionListProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"positions" | "history">("positions");

  const positions = usePortfolioStore((s) => s.positions);
  const getTotalValue = usePortfolioStore((s) => s.getTotalValue);
  const getTotalPnL = usePortfolioStore((s) => s.getTotalPnL);
  const removePosition = usePortfolioStore((s) => s.removePosition);

  const totalValue = getTotalValue();
  const totalPnl = getTotalPnL();
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
        {stats.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="bg-zinc-900 border border-zinc-800 p-6"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-8 h-8 bg-${stat.color}-500/10 border border-${stat.color}-500/30 flex items-center justify-center`}>
                <stat.icon className={`w-4 h-4 text-${stat.color}-400`} />
              </div>
              <span className="text-xs text-zinc-500 tracking-wider uppercase">{stat.label}</span>
            </div>
            <div className="text-2xl font-bold text-white font-mono">{stat.value}</div>
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        <button
          onClick={() => setActiveTab("positions")}
          className={`px-6 py-3 text-sm font-semibold tracking-wider uppercase transition-colors border-b-2 ${
            activeTab === "positions"
              ? "border-amber-500 text-amber-400"
              : "border-transparent text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {t('portfolio.currentPositions', { count: positions.length })}
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`px-6 py-3 text-sm font-semibold tracking-wider uppercase transition-colors border-b-2 ${
            activeTab === "history"
              ? "border-amber-500 text-amber-400"
              : "border-transparent text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {t('portfolio.tradeHistory', { count: history.length })}
        </button>
      </div>

      {/* Content */}
      {activeTab === "positions" && (
        <div>
          {positions.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 p-16 flex flex-col items-center justify-center">
              <Inbox className="w-16 h-16 text-zinc-700 mb-4" />
              <h3 className="text-xl font-bold text-zinc-400 mb-2">{t('portfolio.noPositions')}</h3>
              <p className="text-zinc-600 text-sm mb-6">{t('portfolio.noPositionsDesc')}</p>
              <button
                onClick={() => navigate("/")}
                className="flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm transition-all hover:scale-[1.02]"
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
                  <PositionCard position={position} onSell={removePosition} />
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "history" && (
        <div>
          {history.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 p-16 flex flex-col items-center justify-center">
              <TrendingUp className="w-16 h-16 text-zinc-700 mb-4" />
              <h3 className="text-xl font-bold text-zinc-400 mb-2">{t('portfolio.noTradeHistory')}</h3>
              <p className="text-zinc-600 text-sm">{t('portfolio.noTradeHistoryDesc')}</p>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead className="bg-zinc-950/50 border-b border-zinc-800">
                  <tr>
                    <th className="text-left p-4 text-zinc-500 text-xs tracking-wider uppercase">{t('portfolio.market')}</th>
                    <th className="text-center p-4 text-zinc-500 text-xs tracking-wider uppercase">{t('portfolio.direction')}</th>
                    <th className="text-right p-4 text-zinc-500 text-xs tracking-wider uppercase">{t('portfolio.amount')}</th>
                    <th className="text-center p-4 text-zinc-500 text-xs tracking-wider uppercase">{t('portfolio.result')}</th>
                    <th className="text-right p-4 text-zinc-500 text-xs tracking-wider uppercase">{t('portfolio.pnl')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {history.map((record) => (
                    <tr key={record.id} className="hover:bg-zinc-950/50 transition-colors">
                      <td className="p-4 text-white text-sm font-medium max-w-[200px] truncate">
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
                      <td className="p-4 text-right text-white font-mono text-sm">
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
