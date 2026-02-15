import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { useTransitionNavigate } from "@/app/hooks/useTransitionNavigate";
import { ShoppingCart, Clock } from "lucide-react";
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
    return <div className="p-8 text-center text-muted-foreground">{t('common.loading')}</div>;
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
        <div className="p-12 text-center text-muted-foreground border border-border border-dashed">
          {t('agentMarketplace.noAgents')}
        </div>
      )}
    </div>
  );
}
