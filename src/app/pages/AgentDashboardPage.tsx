import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { AgentDashboard } from "../components/agent/AgentDashboard";

export default function AgentDashboardPage() {
  const { t } = useTranslation();

  return (
    <div className="relative min-h-[80vh]">
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-6"
        >
          <h1 className="text-lg sm:text-xl font-bold text-foreground">{t('agents.title')}</h1>
          <p className="text-xs text-muted-foreground mt-1">{t('agents.description')}</p>
        </motion.div>
        <AgentDashboard />
      </div>
    </div>
  );
}
