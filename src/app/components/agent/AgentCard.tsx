import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { Agent } from "@/app/services/api";

const STRATEGY_MAP: Record<string, { labelKey: string; color: string }> = {
  conservative: { labelKey: "agent.strategies.conservative", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  aggressive: { labelKey: "agent.strategies.aggressive", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  contrarian: { labelKey: "agent.strategies.contrarian", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  momentum: { labelKey: "agent.strategies.momentum", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  random: { labelKey: "agent.strategies.random", color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
};

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
}

const GRADIENT_PAIRS = [
  ["from-blue-500", "to-purple-600"],
  ["from-emerald-500", "to-blue-600"],
  ["from-red-500", "to-blue-600"],
  ["from-blue-500", "to-emerald-600"],
  ["from-purple-500", "to-red-600"],
  ["from-pink-500", "to-blue-600"],
  ["from-cyan-500", "to-purple-600"],
  ["from-orange-500", "to-emerald-600"],
];

interface AgentCardProps {
  agent: Agent;
  onClick?: (id: string) => void;
}

export function AgentCard({ agent, onClick }: AgentCardProps) {
  const { t } = useTranslation();
  const strategy = STRATEGY_MAP[agent.strategy] || STRATEGY_MAP.random;
  const gradientIndex = Math.abs(hashCode(agent.name)) % GRADIENT_PAIRS.length;
  const [from, to] = GRADIENT_PAIRS[gradientIndex];

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.2 }}
      onClick={() => onClick?.(agent.id)}
      className="bg-card border border-border rounded-xl hover:shadow-lg hover:shadow-blue-500/5 hover:-translate-y-0.5 cursor-pointer transition-all duration-300 overflow-hidden"
    >
      <div className="h-0.5 bg-gradient-to-r from-blue-500 to-purple-500" />
      <div className="p-4">
        {/* Header: Avatar + Name + Level */}
        <div className="flex items-center gap-3 mb-3">
          {agent.avatar && (agent.avatar.startsWith("data:") || agent.avatar.startsWith("http") || agent.avatar.startsWith("ipfs")) ? (
            <div className="w-10 h-10 shrink-0 overflow-hidden border border-border">
              <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" />
            </div>
          ) : agent.avatar && agent.avatar.length <= 4 ? (
            <div className={`w-10 h-10 bg-gradient-to-br ${from} ${to} flex items-center justify-center shrink-0`}>
              <span className="text-lg">{agent.avatar}</span>
            </div>
          ) : (
            <div className={`w-10 h-10 bg-gradient-to-br ${from} ${to} flex items-center justify-center shrink-0`}>
              <span className="text-white font-bold text-lg">{agent.name.charAt(0)}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-foreground font-semibold truncate">{agent.name}</span>
              <span className="px-1.5 py-0.5 bg-blue-500 text-black text-xs font-bold shrink-0">
                Lv.{agent.level}
              </span>
            </div>
            <span className={`inline-block mt-1 px-2 py-0.5 text-xs border ${strategy.color}`}>
              {t(strategy.labelKey)}
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div>
            <div className="text-muted-foreground text-xs">ROI</div>
            <div className={`text-sm font-bold font-mono ${agent.roi >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {agent.roi >= 0 ? "+" : ""}{agent.roi.toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">{t('agentCard.winRate')}</div>
            <div className="text-sm font-bold font-mono text-foreground">
              {agent.win_rate.toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">{t('agentCard.trades')}</div>
            <div className="text-sm font-bold font-mono text-foreground">
              {agent.total_trades}
            </div>
          </div>
        </div>

        {/* Reputation & Followers */}
        <div className="flex items-center gap-3 mb-2">
          {(agent as any).reputation_score > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-blue-400 text-xs">★</span>
              <span className="text-blue-400 text-xs font-mono">{(agent as any).reputation_score}</span>
            </div>
          )}
          {(agent as any).copyFollowerCount > 0 && (
            <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 border border-purple-500/30 text-xs">
              {t('copyTrade.followers', { count: (agent as any).copyFollowerCount })}
            </span>
          )}
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-border">
          {agent.is_for_sale ? (
            <span className="text-blue-400 text-sm font-semibold">
              {t('agentCard.forSale', { price: agent.sale_price?.toLocaleString() })}
            </span>
          ) : agent.is_for_rent ? (
            <span className="text-blue-400 text-sm font-semibold">
              {t('agentCard.forRent', { price: agent.rent_price })}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs font-mono">
              {agent.owner_address.slice(0, 6)}...{agent.owner_address.slice(-4)}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
