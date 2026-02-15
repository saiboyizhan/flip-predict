"use client";

import { motion } from "motion/react";
import {
  Timer,
  Clock,
  CalendarDays,
  CalendarRange,
  CalendarClock,
  Layers,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Market } from "../../types/market.types";

export type TimeWindow = "all" | "today" | "week" | "month" | "quarter";

interface TimeFilterProps {
  selected: TimeWindow;
  onChange: (window: TimeWindow) => void;
  markets: Market[];
}

const TIME_OPTIONS: { id: TimeWindow; icon: typeof Clock }[] = [
  { id: "all", icon: Layers },
  { id: "today", icon: Timer },
  { id: "week", icon: CalendarDays },
  { id: "month", icon: CalendarRange },
  { id: "quarter", icon: CalendarClock },
];

function countMarketsInWindow(markets: Market[], tw: TimeWindow): number {
  if (tw === "all") return markets.length;
  const now = Date.now();
  const end = getWindowEnd(tw);
  if (end === null) return markets.length;
  return markets.filter((m) => {
    const t = new Date(m.endTime).getTime();
    return t >= now && t <= end;
  }).length;
}

function getWindowEnd(tw: TimeWindow): number | null {
  if (tw === "all") return null;
  const now = new Date();
  switch (tw) {
    case "today": {
      const e = new Date(now);
      e.setHours(23, 59, 59, 999);
      return e.getTime();
    }
    case "week": {
      const e = new Date(now);
      e.setDate(e.getDate() + (7 - e.getDay()));
      e.setHours(23, 59, 59, 999);
      return e.getTime();
    }
    case "month": {
      return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
    }
    case "quarter": {
      const qMonth = Math.ceil((now.getMonth() + 1) / 3) * 3;
      return new Date(now.getFullYear(), qMonth, 0, 23, 59, 59, 999).getTime();
    }
  }
}

export function TimeFilter({ selected, onChange, markets }: TimeFilterProps) {
  const { t } = useTranslation();

  return (
    <nav className="flex flex-col gap-0.5 w-full">
      {TIME_OPTIONS.map(({ id, icon: Icon }) => {
        const isSelected = selected === id;
        const count = countMarketsInWindow(markets, id);
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
              isSelected
                ? "text-blue-400"
                : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
            }`}
          >
            {isSelected && (
              <motion.div
                layoutId="time-sidebar-highlight"
                className="absolute inset-0 bg-blue-500/10 border border-blue-500/20 rounded-lg"
                transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
              />
            )}
            <Icon className="w-4.5 h-4.5 shrink-0 relative z-10" />
            <span className="relative z-10 flex-1 text-left">
              {t(`timeFilter.${id}`)}
            </span>
            <span
              className={`relative z-10 text-xs font-mono tabular-nums ${
                isSelected ? "text-blue-400" : "text-muted-foreground/60"
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
