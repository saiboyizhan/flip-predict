import { motion } from "motion/react";
import { AgentDashboard } from "../components/agent/AgentDashboard";

export default function AgentDashboardPage() {
  return (
    <div className="relative min-h-[80vh]">
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-6"
        >
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">AI Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">Deploy and manage your NFA agents</p>
        </motion.div>
        <AgentDashboard />
      </div>
    </div>
  );
}
