import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { Bot, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getMyAgents } from "@/app/services/api";
import type { Agent } from "@/app/services/api";
import { AgentLeaderboard } from "./AgentLeaderboard";
import { AgentMarketplace } from "./AgentMarketplace";
import { AgentCard } from "./AgentCard";

type TabId = "leaderboard" | "marketplace" | "my";

export function AgentDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("leaderboard");
  const [myAgents, setMyAgents] = useState<Agent[]>([]);
  const [myLoading, setMyLoading] = useState(false);

  const TABS: { id: TabId; label: string }[] = [
    { id: "leaderboard", label: t("agent.tabs.leaderboard") },
    { id: "marketplace", label: t("agent.tabs.marketplace") },
    { id: "my", label: t("agent.tabs.my") },
  ];

  useEffect(() => {
    if (tab === "my") {
      setMyLoading(true);
      getMyAgents()
        .then(setMyAgents)
        .catch(() => {})
        .finally(() => setMyLoading(false));
    }
  }, [tab]);

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-blue-500/10 via-card to-purple-500/10 border border-border p-4 sm:p-6 md:p-8"
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Bot className="w-6 h-6 sm:w-8 sm:h-8 text-blue-400" />
                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold">{t("agent.title")}</h1>
              </div>
              <p className="text-muted-foreground text-sm sm:text-base">
                {t("agent.subtitle")}
              </p>
            </div>
            <button
              onClick={() => navigate("/agents/mint")}
              className="flex items-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 bg-blue-500 hover:bg-blue-400 text-black font-bold transition-colors shrink-0 w-full sm:w-auto justify-center text-sm sm:text-base"
            >
              <Sparkles className="w-5 h-5" />
              {t("agent.mintAgent")}
            </button>
          </div>
        </motion.div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: "none" }}>
          {TABS.map((tabItem) => (
            <button
              key={tabItem.id}
              onClick={() => setTab(tabItem.id)}
              className={`relative px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                tab === tabItem.id ? "text-blue-400" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tabItem.label}
              {tab === tabItem.id && (
                <motion.div
                  layoutId="agent-tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === "leaderboard" && <AgentLeaderboard />}
        {tab === "marketplace" && <AgentMarketplace />}
        {tab === "my" && (
          <div>
            {myLoading ? (
              <div className="p-8 text-center text-muted-foreground">{t("common.loading")}</div>
            ) : myAgents.length > 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
              >
                {myAgents.map((agent, i) => (
                  <motion.div
                    key={agent.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <AgentCard agent={agent} onClick={(id) => navigate(`/agents/${id}`)} />
                  </motion.div>
                ))}
              </motion.div>
            ) : (
              <div className="p-8 sm:p-12 text-center border border-border border-dashed">
                <p className="text-muted-foreground mb-4">{t("agent.noAgentYet")}</p>
                <button
                  onClick={() => navigate("/agents/mint")}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-blue-500 hover:bg-blue-400 text-black font-bold transition-colors w-full sm:w-auto justify-center"
                >
                  <Sparkles className="w-5 h-5" />
                  {t("agent.mintAgent")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
