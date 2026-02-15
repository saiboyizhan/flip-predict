import { useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Leaderboard } from "../components/leaderboard";

type TimeRange = "all" | "week" | "month";

export default function LeaderboardPage() {
  const { t } = useTranslation();
  const [timeRange, setTimeRange] = useState<TimeRange>("all");

  const tabs: { id: TimeRange; labelKey: string }[] = [
    { id: "all", labelKey: "leaderboard.allTime" },
    { id: "week", labelKey: "leaderboard.thisWeek" },
    { id: "month", labelKey: "leaderboard.thisMonth" },
  ];

  return (
    <div className="relative min-h-[80vh]">
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-6"
        >
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            {t("leaderboard.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("leaderboard.subtitle", "Top traders ranked by profit and accuracy")}
          </p>

          {/* Time Range Tabs */}
          <div className="flex items-center gap-1 mt-4">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setTimeRange(tab.id)}
                className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors ${
                  timeRange === tab.id
                    ? "bg-blue-500/15 text-blue-500 border border-blue-500/30"
                    : "bg-white/[0.04] text-muted-foreground hover:text-foreground border border-white/[0.08] hover:border-white/[0.15]"
                }`}
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </div>
        </motion.div>
        <Leaderboard timeRange={timeRange} />
      </div>
    </div>
  );
}
