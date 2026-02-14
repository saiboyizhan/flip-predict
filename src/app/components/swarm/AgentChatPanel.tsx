import { useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSwarmStore, ALL_AGENTS, LEADER_AGENT } from "@/app/stores/useSwarmStore";
import AgentMessage from "./AgentMessage";

function phaseLabel(phase: 0 | 1 | 2 | 3 | 4): string {
  switch (phase) {
    case 0: return "swarm.phases.creatingTeam";
    case 1: return "swarm.phases.independentAnalysis";
    case 2: return "swarm.phases.crossDiscussion";
    case 3: return "swarm.phases.scoreRevision";
    case 4: return "swarm.phases.consensus";
  }
}

function PhaseDivider({ phase }: { phase: 0 | 1 | 2 | 3 | 4 }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="flex-1 h-px bg-border/60" />
      <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider px-2">
        {t(phaseLabel(phase))}
      </span>
      <div className="flex-1 h-px bg-border/60" />
    </div>
  );
}

function getTypingAgent(id: string) {
  if (id === "leader") return LEADER_AGENT;
  return ALL_AGENTS.find((a) => a.id === id) || null;
}

function TypingBubble({ agentId }: { agentId: string }) {
  const { t } = useTranslation();
  const agent = getTypingAgent(agentId);
  if (!agent) return null;

  const nameKey = agentId === "leader" ? "swarm.leader" : `swarm.agents.${agentId}`;

  return (
    <div className="flex items-center gap-2 py-2 px-1">
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
        style={{
          backgroundColor: agent.color + "18",
          border: `1.5px solid ${agent.color}35`,
        }}
      >
        <span className="text-[8px] font-bold leading-none" style={{ color: agent.color }}>
          {agent.icon}
        </span>
      </div>
      <span className="text-xs font-medium" style={{ color: agent.color }}>
        {t(nameKey)}
      </span>
      <div className="flex items-center gap-0.5">
        <span
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ backgroundColor: agent.color, animationDelay: "0ms", animationDuration: "0.8s" }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ backgroundColor: agent.color, animationDelay: "200ms", animationDuration: "0.8s" }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ backgroundColor: agent.color, animationDelay: "400ms", animationDuration: "0.8s" }}
        />
      </div>
      <span className="text-[11px] text-muted-foreground/50">
        {t("swarm.chatPanel.thinking")}
      </span>
    </div>
  );
}

export default function AgentChatPanel() {
  const { t } = useTranslation();
  const messages = useSwarmStore((s) => s.messages);
  const phase = useSwarmStore((s) => s.phase);
  const typingAgentId = useSwarmStore((s) => s.typingAgentId);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, typingAgentId]);

  // Group messages by phase for dividers
  let lastPhase: number | null = null;
  const renderItems: Array<
    | { type: "divider"; phase: 0 | 1 | 2 | 3 | 4 }
    | { type: "message"; message: (typeof messages)[0] }
  > = [];

  messages.forEach((msg) => {
    if (msg.phase !== lastPhase) {
      renderItems.push({ type: "divider", phase: msg.phase });
      lastPhase = msg.phase;
    }
    renderItems.push({ type: "message", message: msg });
  });

  const isEmpty = phase === "idle";

  return (
    <div className="bg-card border border-border rounded-xl flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <MessageSquare className="w-4 h-4 text-blue-400" />
        <h2 className="text-sm font-semibold text-foreground">
          {t("swarm.chatPanel.title")}
        </h2>
        {messages.length > 0 && (
          <span className="text-[10px] text-muted-foreground font-mono ml-auto">
            {messages.length}
          </span>
        )}
      </div>

      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 min-h-0"
        style={{ maxHeight: 520 }}
      >
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-12">
            <MessageSquare className="w-8 h-8 text-muted-foreground/20" />
            <p className="text-xs text-muted-foreground/50 text-center">
              {t("swarm.chatPanel.title")}
            </p>
          </div>
        ) : (
          <>
            {renderItems.map((item, i) => {
              if (item.type === "divider") {
                return <PhaseDivider key={`div-${item.phase}`} phase={item.phase} />;
              }
              return (
                <AgentMessage
                  key={item.message.id}
                  message={item.message}
                />
              );
            })}
          </>
        )}

        {typingAgentId && (
          <TypingBubble agentId={typingAgentId} />
        )}
      </div>
    </div>
  );
}
