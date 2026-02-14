import { motion, motionValue, animate } from "motion/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface ConsensusGaugeProps {
  score: number | null;
  initialScore?: number | null;
  complete: boolean;
}

function gaugeColor(score: number): string {
  if (score <= 30) return "#ef4444";
  if (score <= 60) return "#f59e0b";
  return "#10b981";
}

function gaugeGlow(score: number): string {
  if (score <= 30) return "rgba(239, 68, 68, 0.2)";
  if (score <= 60) return "rgba(245, 158, 11, 0.2)";
  return "rgba(16, 185, 129, 0.2)";
}

function gaugeLabelKey(score: number): string {
  if (score >= 75) return "swarm.gauge.veryBullish";
  if (score > 60) return "swarm.gauge.bullish";
  if (score >= 40) return "swarm.gauge.neutral";
  if (score >= 25) return "swarm.gauge.bearish";
  return "swarm.gauge.veryBearish";
}

function labelColor(score: number): string {
  if (score > 60) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

function labelBgClass(score: number): string {
  if (score > 60) return "bg-emerald-500/10 border-emerald-500/20";
  if (score >= 40) return "bg-amber-500/10 border-amber-500/20";
  return "bg-red-500/10 border-red-500/20";
}

function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const mv = motionValue(0);
    const unsubscribe = mv.on("change", (v) => setDisplay(Math.round(v)));
    animate(mv, value, { duration: 1, ease: "easeOut" });
    return () => { unsubscribe(); mv.destroy(); };
  }, [value]);

  return <>{display}</>;
}

export default function ConsensusGauge({ score, initialScore, complete }: ConsensusGaugeProps) {
  const { t } = useTranslation();
  const size = 180;
  const strokeWidth = 8;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = score !== null ? score / 100 : 0;
  const dashOffset = circumference * (1 - progress);
  const color = score !== null ? gaugeColor(score) : "#6b7280";
  const glow = score !== null ? gaugeGlow(score) : "transparent";

  const showComparison = complete && score !== null && initialScore != null && initialScore !== score;
  const shift = score !== null && initialScore != null ? score - initialScore : 0;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative" style={{ width: size, height: size }}>
        {/* Glow background */}
        {complete && score !== null && (
          <motion.div
            className="absolute inset-2 rounded-full pointer-events-none"
            style={{ boxShadow: `0 0 40px ${glow}, inset 0 0 30px ${glow}` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
          />
        )}

        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {/* Tick marks */}
          {Array.from({ length: 20 }).map((_, i) => {
            const angle = (i / 20) * 360;
            const rad = (angle * Math.PI) / 180;
            const innerR = radius - 8;
            const outerR = radius - 4;
            const x1 = size / 2 + innerR * Math.cos(rad);
            const y1 = size / 2 + innerR * Math.sin(rad);
            const x2 = size / 2 + outerR * Math.cos(rad);
            const y2 = size / 2 + outerR * Math.sin(rad);
            return (
              <line
                key={i}
                x1={x1} y1={y1} x2={x2} y2={y2}
                className="stroke-border"
                strokeWidth={i % 5 === 0 ? 1.5 : 0.5}
              />
            );
          })}

          {/* Background track */}
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" strokeWidth={strokeWidth}
            className="stroke-border"
            strokeOpacity={0.5}
          />

          {/* Progress arc */}
          <motion.circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: dashOffset }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            style={{
              filter: complete ? `drop-shadow(0 0 6px ${color})` : undefined,
            }}
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {complete && score !== null ? (
            <>
              <span className="text-4xl font-bold text-foreground leading-none">
                <AnimatedNumber value={score} />
              </span>
              <span className="text-xs text-muted-foreground mt-1 font-mono">/100</span>
            </>
          ) : score !== null ? (
            <motion.div
              className="flex flex-col items-center"
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              <span className="text-2xl font-bold text-muted-foreground">--</span>
              <span className="text-xs text-muted-foreground mt-1">{t("swarm.computing")}</span>
            </motion.div>
          ) : (
            <motion.div
              className="flex flex-col items-center gap-1"
              animate={{ opacity: [0.3, 0.7, 0.3] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-muted-foreground"
                    animate={{ scale: [1, 1.4, 1] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
                  />
                ))}
              </div>
              <span className="text-xs text-muted-foreground mt-1">{t("swarm.awaiting")}</span>
            </motion.div>
          )}
        </div>
      </div>

      {/* Label badge */}
      {complete && score !== null ? (
        <div className="flex flex-col items-center gap-2">
          <motion.div
            className={`px-3 py-1.5 rounded-lg border ${labelBgClass(score)}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.6 }}
          >
            <span className={`text-sm font-semibold ${labelColor(score)}`}>
              {t(gaugeLabelKey(score))}
            </span>
          </motion.div>

          {/* Initial vs Final comparison */}
          {showComparison && (
            <motion.div
              className="flex items-center gap-3 text-xs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
            >
              <span className="text-muted-foreground">
                {t("swarm.initialConsensus")}: <span className="font-mono font-semibold text-foreground">{initialScore}</span>
              </span>
              <span className={`font-mono font-semibold ${shift < 0 ? "text-red-400" : "text-emerald-400"}`}>
                {shift > 0 ? "+" : ""}{shift}
              </span>
              <span className="text-muted-foreground">
                {t("swarm.finalConsensus")}: <span className="font-mono font-semibold text-foreground">{score}</span>
              </span>
            </motion.div>
          )}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground px-3 py-1.5">
          {t("swarm.consensusPending")}
        </span>
      )}
    </div>
  );
}
