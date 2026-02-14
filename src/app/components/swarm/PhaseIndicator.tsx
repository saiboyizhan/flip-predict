import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { SwarmPhase } from "@/app/stores/useSwarmStore";

const PHASE_STEPS: { key: string; phases: SwarmPhase[] }[] = [
  { key: "swarm.phases.creatingTeam", phases: ["creating_team", "team_ready"] },
  { key: "swarm.phases.independentAnalysis", phases: ["phase1"] },
  { key: "swarm.phases.crossDiscussion", phases: ["phase2"] },
  { key: "swarm.phases.scoreRevision", phases: ["phase3"] },
  { key: "swarm.phases.consensus", phases: ["phase4", "complete"] },
];

function stepState(step: typeof PHASE_STEPS[number], currentPhase: SwarmPhase) {
  const allPhases: SwarmPhase[] = [
    "idle", "creating_team", "team_ready",
    "phase1", "phase2", "phase3", "phase4", "complete",
  ];
  const currentIdx = allPhases.indexOf(currentPhase);
  const stepFirstIdx = Math.min(...step.phases.map((p) => allPhases.indexOf(p)));
  const stepLastIdx = Math.max(...step.phases.map((p) => allPhases.indexOf(p)));

  if (currentIdx > stepLastIdx) return "completed";
  if (currentIdx >= stepFirstIdx && currentIdx <= stepLastIdx) return "active";
  return "pending";
}

interface PhaseIndicatorProps {
  phase: SwarmPhase;
}

export default function PhaseIndicator({ phase }: PhaseIndicatorProps) {
  const { t } = useTranslation();

  if (phase === "idle") return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex items-center gap-1 overflow-x-auto pb-1"
    >
      {PHASE_STEPS.map((step, i) => {
        const state = stepState(step, phase);
        return (
          <div key={step.key} className="flex items-center gap-1 shrink-0">
            {i > 0 && (
              <div
                className={`w-4 sm:w-6 h-px transition-colors duration-300 ${
                  state === "pending" ? "bg-border" : "bg-blue-500/50"
                }`}
              />
            )}
            <div className="flex items-center gap-1.5">
              {/* Dot */}
              <div className="relative">
                <div
                  className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                    state === "completed"
                      ? "bg-emerald-400"
                      : state === "active"
                        ? "bg-blue-400"
                        : "bg-border"
                  }`}
                />
                {state === "active" && (
                  <motion.div
                    className="absolute inset-0 rounded-full bg-blue-400"
                    animate={{ scale: [1, 2], opacity: [0.5, 0] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
                  />
                )}
              </div>
              {/* Label */}
              <span
                className={`text-[10px] sm:text-xs font-medium transition-colors duration-300 whitespace-nowrap ${
                  state === "completed"
                    ? "text-emerald-400"
                    : state === "active"
                      ? "text-blue-400"
                      : "text-muted-foreground/50"
                }`}
              >
                {t(step.key)}
              </span>
            </div>
          </div>
        );
      })}
    </motion.div>
  );
}
