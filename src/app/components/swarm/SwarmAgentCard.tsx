import { motion } from "motion/react";
import { Shield, BarChart3, MessageCircle, Anchor, Zap, Droplets, Newspaper, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SwarmAgentDef, AgentAnalysis } from "@/app/stores/useSwarmStore";
import { useSwarmStore } from "@/app/stores/useSwarmStore";

interface SwarmAgentCardProps {
  agent: SwarmAgentDef;
  analysis: AgentAnalysis;
  index: number;
}

const DIMENSION_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  security: Shield,
  technical: BarChart3,
  social: MessageCircle,
  whale: Anchor,
  momentum: Zap,
  liquidity: Droplets,
  narrative: Newspaper,
  contract: Search,
};

function scoreColor(score: number): string {
  if (score < 40) return "#ef4444";
  if (score <= 60) return "#f59e0b";
  return "#10b981";
}

function scoreLabelClass(score: number): string {
  if (score < 40) return "text-red-500/70";
  if (score <= 60) return "text-amber-500/70";
  return "text-emerald-500/70";
}

function scoreLabelKey(score: number): string {
  if (score >= 80) return "swarm.scores.strong";
  if (score >= 60) return "swarm.scores.good";
  if (score >= 40) return "swarm.scores.mixed";
  return "swarm.scores.risky";
}

function MiniScoreArc({ score, color, size = 48 }: { score: number; color: string; size?: number }) {
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - score / 100);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={strokeWidth}
          className="stroke-border"
        />
        <motion.circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: dashOffset }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.span
          className="text-sm font-bold text-foreground"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: 0.5 }}
        >
          {score}
        </motion.span>
      </div>
    </div>
  );
}

function statusKey(status: AgentAnalysis["status"]): string | null {
  switch (status) {
    case "joining": return "swarm.phases.creatingTeam";
    case "analyzing": return "swarm.analyzing";
    case "communicating": return "swarm.phases.crossDiscussion";
    case "revising": return "swarm.phases.scoreRevision";
    default: return null;
  }
}

export default function SwarmAgentCard({ agent, analysis, index }: SwarmAgentCardProps) {
  const { t } = useTranslation();
  const DimIcon = DIMENSION_ICON_MAP[agent.dimensionKey] || Shield;
  const weight = analysis.weight;

  const isAnimating = ["joining", "analyzing", "communicating", "revising"].includes(analysis.status);
  const hasInitialScore = analysis.initialScore !== null;
  const hasRevisedScore = analysis.revisedScore !== null;
  const isComplete = analysis.status === "complete";
  const displayScore = analysis.finalScore ?? analysis.initialScore;
  const agentStats = useSwarmStore((s) => s.agentStats);
  const agentStat = agentStats.find(s => s.agent_id === agent.id);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1, ease: "easeOut" }}
      className="group relative bg-card border border-border rounded-xl overflow-hidden transition-colors hover:border-border/80"
    >
      <div className="h-0.5" style={{ backgroundColor: agent.color }} />

      {isAnimating && (
        <motion.div
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            background: `linear-gradient(180deg, transparent 0%, ${agent.color}08 50%, transparent 100%)`,
          }}
        >
          <motion.div
            className="absolute left-0 right-0 h-8"
            style={{
              background: `linear-gradient(180deg, transparent, ${agent.color}15, transparent)`,
            }}
            animate={{ top: ["-10%", "110%"] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
          />
        </motion.div>
      )}

      <div className="p-3.5 flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: agent.color + "15" }}
            >
              <span className="text-xs font-bold" style={{ color: agent.color }}>{agent.icon}</span>
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {t(`swarm.agents.${agent.id}`)}
              </h3>
              <p className="text-[11px] text-muted-foreground truncate">
                {t(`swarm.agents.${agent.id}Desc`)}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium"
            style={{ backgroundColor: agent.color + "12", color: agent.color }}
          >
            <DimIcon className="w-3 h-3" />
            <span>{t(`swarm.dimensions.${agent.dimensionKey}`)}</span>
          </div>
          <span className="text-[11px] text-muted-foreground font-mono">
            {weight}% {t("swarm.weight")}
          </span>
          {agentStat && agentStat.total_analyses >= 5 && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
              {Math.round(agentStat.accuracy)}% ({agentStat.total_analyses})
            </span>
          )}
        </div>

        <div className="flex items-center justify-center min-h-[56px]">
          {analysis.status === "idle" && (
            <div className="flex flex-col items-center gap-1">
              <div className="w-12 h-12 rounded-full border border-dashed border-border flex items-center justify-center">
                <span className="text-xs text-muted-foreground">--</span>
              </div>
              <span className="text-[11px] text-muted-foreground">{t("swarm.ready")}</span>
            </div>
          )}

          {analysis.status === "joining" && (
            <motion.div
              className="flex flex-col items-center gap-1.5"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <motion.div
                className="w-12 h-12 rounded-full border-2 flex items-center justify-center"
                style={{ borderColor: agent.color + "60" }}
                animate={{ scale: [1, 1.08, 1], borderColor: [agent.color + "30", agent.color, agent.color + "30"] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
              >
                <span className="text-base">{agent.icon}</span>
              </motion.div>
              <span className="text-[11px] font-medium" style={{ color: agent.color }}>
                {t("swarm.phases.creatingTeam")}
              </span>
            </motion.div>
          )}

          {analysis.status === "analyzing" && (
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex items-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: agent.color }}
                    animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
                    transition={{ duration: 1, repeat: Infinity, ease: "easeInOut", delay: i * 0.2 }}
                  />
                ))}
              </div>
              <span className="text-[11px] font-medium" style={{ color: agent.color }}>
                {t("swarm.analyzing")}
              </span>
            </div>
          )}

          {(analysis.status === "phase1_complete" || analysis.status === "communicating" || analysis.status === "revising") && hasInitialScore && (
            <motion.div
              className="flex flex-col items-center gap-1"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
            >
              <MiniScoreArc score={displayScore!} color={scoreColor(displayScore!)} />
              <span className={`text-[11px] font-medium ${scoreLabelClass(displayScore!)}`}>
                {t(scoreLabelKey(displayScore!))}
              </span>
              {statusKey(analysis.status) && (
                <motion.span
                  className="text-[10px] font-medium"
                  style={{ color: agent.color }}
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  {t(statusKey(analysis.status)!)}
                </motion.span>
              )}
            </motion.div>
          )}

          {isComplete && displayScore !== null && (
            <motion.div
              className="flex flex-col items-center gap-1"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <MiniScoreArc score={displayScore} color={scoreColor(displayScore)} />
              {hasRevisedScore && hasInitialScore && analysis.initialScore !== analysis.revisedScore ? (
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-muted-foreground line-through font-mono">
                    {analysis.initialScore}
                  </span>
                  <span className="text-[11px] text-muted-foreground">&rarr;</span>
                  <span className={`text-[11px] font-semibold font-mono ${scoreLabelClass(displayScore)}`}>
                    {analysis.revisedScore}
                  </span>
                </div>
              ) : (
                <span className={`text-[11px] font-medium ${scoreLabelClass(displayScore)}`}>
                  {t(scoreLabelKey(displayScore))}
                </span>
              )}
            </motion.div>
          )}
        </div>
      </div>

      {isComplete && displayScore !== null && (
        <motion.div
          className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none"
          style={{
            background: `linear-gradient(to top, ${scoreColor(displayScore)}08, transparent)`,
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
        />
      )}
    </motion.div>
  );
}
