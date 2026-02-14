import { motion } from "motion/react";
import { Zap, RotateCw, ArrowRight, CheckCircle2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSwarmStore, DEMO_MARKETS } from "@/app/stores/useSwarmStore";
import SwarmAgentCard from "./SwarmAgentCard";
import ConsensusGauge from "./ConsensusGauge";
import AgentChatPanel from "./AgentChatPanel";
import PhaseIndicator from "./PhaseIndicator";
import SwarmHistory from "./SwarmHistory";

export default function SwarmPanel() {
  const { t } = useTranslation();
  const activeAgents = useSwarmStore((s) => s.activeAgents);
  const activeWeights = useSwarmStore((s) => s.activeWeights);
  const analyses = useSwarmStore((s) => s.analyses);
  const consensus = useSwarmStore((s) => s.consensus);
  const phase = useSwarmStore((s) => s.phase);
  const isAnalyzing = useSwarmStore((s) => s.isAnalyzing);
  const selectedMarketId = useSwarmStore((s) => s.selectedMarketId);
  const isDynamicWeights = useSwarmStore((s) => s.isDynamicWeights);

  const marketId = selectedMarketId || "";
  const marketAnalyses = analyses[marketId] ?? [];
  const marketConsensus = consensus[marketId] ?? null;

  const isComplete = marketConsensus?.complete === true;
  const consensusScore = marketConsensus?.score ?? null;
  const initialConsensusScore = marketConsensus?.initialScore ?? null;
  const hasStarted = phase !== "idle";

  const handleStart = () => {
    const store = useSwarmStore.getState();
    if (selectedMarketId) {
      const market = DEMO_MARKETS.find(m => m.id === selectedMarketId);
      if (market) {
        store.startRealAnalysis(market.id, undefined, 'BSC', 'meme');
      }
    }
  };

  const handleReset = () => {
    useSwarmStore.getState().reset();
  };

  const handleSelectMarket = (id: string) => {
    useSwarmStore.getState().selectMarket(id);
  };

  const direction = consensusScore !== null && consensusScore > 50 ? "YES" : "NO";

  // Get selected market info for team preview
  const selectedMarket = DEMO_MARKETS.find((m) => m.id === selectedMarketId);

  return (
    <div className="flex flex-col gap-6">
      {/* Hero header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative overflow-hidden bg-card border border-border rounded-xl p-5"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-purple-500/5 rounded-full translate-y-1/2 -translate-x-1/3 blur-3xl pointer-events-none" />

        <div className="relative flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                <Zap className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">{t("swarm.title")}</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {t("swarm.subtitle")}
                </p>
              </div>
            </div>

            {isComplete && (
              <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{t("swarm.analysisComplete")}</span>
              </div>
            )}
          </div>

          <PhaseIndicator phase={phase} />
        </div>
      </motion.div>

      {/* Main 3-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left column: Agent cards */}
        <div className="lg:col-span-3">
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
            {activeAgents.length > 0 ? (
              activeAgents.map((agent, i) => {
                const analysis = marketAnalyses.find((a) => a.agentId === agent.id) ?? {
                  agentId: agent.id,
                  weight: activeWeights[i] ?? 25,
                  initialScore: null,
                  revisedScore: null,
                  finalScore: null,
                  status: "idle" as const,
                  timestamp: null,
                };
                return (
                  <SwarmAgentCard key={agent.id} agent={agent} analysis={analysis} index={i} />
                );
              })
            ) : (
              <div className="col-span-2 lg:col-span-1 flex flex-col items-center justify-center py-8 text-center">
                <Users className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground">
                  {t("swarm.selectMarketFirst")}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Center column: Communication panel */}
        <div className="lg:col-span-5">
          <AgentChatPanel />
        </div>

        {/* Right column: Consensus gauge + actions */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="bg-card border border-border rounded-xl p-5 flex flex-col items-center gap-4"
          >
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {t("swarm.consensusScore")}
            </h2>

            <ConsensusGauge
              score={consensusScore}
              initialScore={initialConsensusScore}
              complete={isComplete}
            />

            {/* Action area */}
            <div className="w-full flex flex-col gap-3">
              {/* Market selector - shown when idle */}
              {!hasStarted && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {t("swarm.selectMarket")}
                  </h3>
                  {DEMO_MARKETS.map((market) => (
                    <button
                      key={market.id}
                      onClick={() => handleSelectMarket(market.id)}
                      className={`text-left p-3 rounded-lg border transition-all ${
                        selectedMarketId === market.id
                          ? "border-blue-500/60 bg-blue-500/8"
                          : "border-border hover:border-border/80 bg-transparent"
                      }`}
                    >
                      <span className="text-sm font-medium text-foreground">
                        {t(market.nameKey)}
                      </span>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {t(market.descKey)}
                      </p>
                      {/* Show which agents will be selected */}
                      {selectedMarketId === market.id && (
                        <div className="flex items-center gap-1 mt-1.5">
                          {market.team.agentIds.map((agentId) => {
                            const agentDef = activeAgents.find((a) => a.id === agentId);
                            if (!agentDef) return null;
                            return (
                              <span
                                key={agentId}
                                className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                                style={{ backgroundColor: agentDef.color + "15", color: agentDef.color }}
                              >
                                {t(`swarm.agents.${agentId}`)}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Create team button */}
              {!hasStarted && (
                <button
                  onClick={handleStart}
                  disabled={!selectedMarketId}
                  className={`w-full flex items-center justify-center gap-2 px-5 py-3 font-semibold text-sm rounded-lg transition-colors ${
                    selectedMarketId
                      ? "bg-blue-500 hover:bg-blue-400 text-black"
                      : "bg-blue-500/30 text-muted-foreground cursor-not-allowed"
                  }`}
                >
                  <Users className="w-4 h-4" />
                  {t("swarm.createTeam")}
                </button>
              )}

              {isAnalyzing && (
                <div className="w-full py-3 text-center">
                  <motion.p
                    className="text-sm text-muted-foreground"
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    {t("swarm.creatingTeam")}
                  </motion.p>
                </div>
              )}

              {isComplete && consensusScore !== null && (
                <>
                  <button
                    className={`w-full flex items-center justify-center gap-2 px-5 py-3 font-semibold text-sm rounded-lg transition-colors ${
                      direction === "YES"
                        ? "bg-emerald-500 hover:bg-emerald-400 text-black"
                        : "bg-red-500 hover:bg-red-400 text-white"
                    }`}
                  >
                    {t("swarm.betWithSwarm", { direction })}
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  <button
                    onClick={handleReset}
                    className="w-full flex items-center justify-center gap-2 px-5 py-2.5 text-muted-foreground hover:text-foreground text-sm font-medium border border-border rounded-lg hover:bg-accent transition-colors"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    {t("swarm.reAnalyze")}
                  </button>
                </>
              )}
            </div>
          </motion.div>

          {/* Weight breakdown */}
          {activeAgents.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="bg-card border border-border rounded-xl p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("swarm.weightDistribution")}
                </h3>
                {isDynamicWeights && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400">
                    Dynamic
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {activeAgents.map((agent, i) => {
                  const w = activeWeights[i] ?? 25;
                  const analysis = marketAnalyses.find((a) => a.agentId === agent.id);
                  const finalScore = analysis?.finalScore;
                  const initialScore = analysis?.initialScore;
                  const revisedScore = analysis?.revisedScore;
                  const showShift =
                    revisedScore != null && initialScore != null && revisedScore !== initialScore;
                  return (
                    <div key={agent.id} className="flex items-center gap-2">
                      <span className="text-xs w-16 truncate" style={{ color: agent.color }}>
                        {t(`swarm.agents.${agent.id}`)}
                      </span>
                      <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: agent.color }}
                          initial={{ width: 0 }}
                          animate={{ width: `${w}%` }}
                          transition={{ duration: 0.6, delay: 0.5 + i * 0.1 }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground font-mono w-7 text-right">
                        {w}%
                      </span>
                      {finalScore != null && (
                        <span className="text-xs font-mono font-semibold w-12 text-right text-foreground">
                          {showShift ? (
                            <>
                              <span className="text-muted-foreground line-through">
                                {initialScore}
                              </span>
                              <span className="mx-0.5">{revisedScore}</span>
                            </>
                          ) : (
                            finalScore
                          )}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
          {isComplete && <SwarmHistory />}
        </div>
      </div>
    </div>
  );
}
