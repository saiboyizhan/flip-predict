import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { useTransitionNavigate } from "@/app/hooks/useTransitionNavigate";
import { ShoppingCart, Clock, Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getAgentMarketplace } from "@/app/services/api";
import type { Agent } from "@/app/services/api";
import { AgentCard } from "./AgentCard";

export function AgentMarketplace() {
  const { t } = useTranslation();
  const { navigate } = useTransitionNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"sale" | "rent">("sale");

  useEffect(() => {
    getAgentMarketplace()
      .then(setAgents)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const forSale = agents.filter((a) => a.is_for_sale);
  const forRent = agents.filter((a) => a.is_for_rent && !a.is_for_sale);
  const displayed = tab === "sale" ? forSale : forRent;

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Skeleton tabs */}
        <div className="flex gap-1 inline-flex">
          <div className="h-9 w-28 bg-muted rounded animate-pulse" />
          <div className="h-9 w-28 bg-muted rounded animate-pulse" />
        </div>
        {/* Skeleton grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 bg-muted rounded" />
                  <div className="h-3 w-1/3 bg-muted rounded" />
                </div>
              </div>
              <div className="h-3 w-full bg-muted rounded mb-2" />
              <div className="h-3 w-3/4 bg-muted rounded mb-4" />
              <div className="flex gap-2">
                <div className="h-8 flex-1 bg-muted rounded" />
                <div className="h-8 flex-1 bg-muted rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-1 border border-border inline-flex">
        <button
          onClick={() => setTab("sale")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === "sale" ? "bg-blue-500 text-black" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          {t('agentMarketplace.forSale', { count: forSale.length })}
        </button>
        <button
          onClick={() => setTab("rent")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === "rent" ? "bg-blue-500 text-black" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Clock className="w-4 h-4" />
          {t('agentMarketplace.forRent', { count: forRent.length })}
        </button>
      </div>

      {/* Grid */}
      {displayed.length > 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
        >
          {displayed.map((agent, i) => (
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
        <div className="p-12 text-center border border-border border-dashed">
          <Bot className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm font-medium">
            {t('agentMarketplace.noAgents', { defaultValue: 'No agents available' })}
          </p>
          <p className="text-muted-foreground/60 text-xs mt-1">
            {t('agentMarketplace.noAgentsHint', { defaultValue: 'Be the first to mint one!' })}
          </p>
        </div>
      )}
    </div>
  );
}
