"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Clock, Timer, CheckCircle2, Bot } from "lucide-react";
import { useTranslation } from "react-i18next";

interface MarketCountdownProps {
  endTime: string | number;
  status: string;
  outcome?: string;
}

function calcRemaining(endTime: string | number) {
  const now = Date.now();
  const end =
    typeof endTime === "number" ? endTime : new Date(endTime).getTime();
  const diff = end - now;
  if (diff <= 0) return null;

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return { days, hours, minutes, seconds, totalMs: diff };
}

export function MarketCountdown({
  endTime,
  status,
  outcome,
}: MarketCountdownProps) {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(() => calcRemaining(endTime));

  useEffect(() => {
    if (status === "resolved") return;

    const id = setInterval(() => {
      setRemaining(calcRemaining(endTime));
    }, 1000);

    return () => clearInterval(id);
  }, [endTime, status]);

  // resolved states
  if (status === "resolved") {
    const isYes = outcome?.toLowerCase() === "yes";
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`flex items-center gap-2 px-4 py-2 text-sm font-bold ${
          isYes
            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
            : "bg-red-500/20 text-red-400 border border-red-500/30"
        }`}
      >
        <CheckCircle2 className="w-4 h-4" />
        <span>
          {t('market.settled_outcome', { side: isYes ? "YES" : "NO" })}
        </span>
      </motion.div>
    );
  }

  // pending_resolution
  if (status === "pending_resolution") {
    return (
      <motion.div
        animate={{ opacity: [1, 0.6, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30"
      >
        <Bot className="w-4 h-4" />
        <span>{t('market.waitingAdmin')}</span>
      </motion.div>
    );
  }

  // active but expired
  if (!remaining) {
    return (
      <motion.div
        animate={{ opacity: [1, 0.6, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30"
      >
        <Timer className="w-4 h-4" />
        <span>{t('market.expired_waiting')}</span>
      </motion.div>
    );
  }

  // active with time left
  const { days, hours, minutes, seconds, totalMs } = remaining;
  const isUrgent = totalMs < 60 * 60 * 1000; // < 1 hour

  let timeStr: string;
  if (days > 0) {
    timeStr = t('market.daysH', { days, hours });
  } else {
    timeStr = t('market.hhmmss', { hh: hours.toString().padStart(2, "0"), mm: minutes.toString().padStart(2, "0"), ss: seconds.toString().padStart(2, "0") });
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={timeStr}
        initial={{ opacity: 0.8 }}
        animate={{
          opacity: isUrgent ? [1, 0.5, 1] : 1,
        }}
        transition={
          isUrgent
            ? { duration: 1, repeat: Infinity }
            : { duration: 0.3 }
        }
        className={`flex items-center gap-2 px-4 py-2 text-sm font-bold font-mono ${
          isUrgent
            ? "bg-red-500/20 text-red-400 border border-red-500/30"
            : "bg-muted text-muted-foreground border border-border"
        }`}
      >
        <Clock className="w-4 h-4" />
        <span>{timeStr}</span>
      </motion.div>
    </AnimatePresence>
  );
}
