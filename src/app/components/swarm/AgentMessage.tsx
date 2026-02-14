import { useTranslation } from "react-i18next";
import {
  ALL_AGENTS,
  LEADER_AGENT,
  type SwarmMessage,
  type SwarmMessageType,
} from "@/app/stores/useSwarmStore";

function getAgent(id: string) {
  if (id === "leader") return LEADER_AGENT;
  return ALL_AGENTS.find((a) => a.id === id) || null;
}

function getAgentNameKey(id: string): string {
  if (id === "all") return "swarm.chatPanel.toAll";
  if (id === "leader") return "swarm.leader";
  return `swarm.agents.${id}`;
}

const TYPE_DOT_COLOR: Record<SwarmMessageType, string> = {
  finding: "bg-blue-400",
  alert: "bg-red-400",
  question: "bg-amber-400",
  response: "bg-emerald-400",
  revision: "bg-purple-400",
  command: "bg-cyan-400",
  consensus: "bg-cyan-300",
};

interface AgentMessageProps {
  message: SwarmMessage;
}

export default function AgentMessage({ message }: AgentMessageProps) {
  const { t } = useTranslation();
  const fromAgent = getAgent(message.fromAgentId);
  const isLeader = message.fromAgentId === "leader";
  const isConsensus = message.type === "consensus";
  const isAlert = message.type === "alert";

  if (!fromAgent) return null;

  const resolvedParams = message.params
    ? Object.fromEntries(
        Object.entries(message.params).map(([k, v]) => [
          k,
          typeof v === "string" && v.startsWith("@") ? t(v.slice(1)) : v,
        ])
      )
    : undefined;

  return (
    <div className={`flex gap-2 py-1.5 ${isConsensus ? "mt-1" : ""}`}>
      {/* Avatar */}
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
          isLeader ? "ring-1 ring-cyan-500/30" : ""
        }`}
        style={{
          backgroundColor: fromAgent.color + "18",
          border: `1.5px solid ${fromAgent.color}35`,
        }}
      >
        <span className="text-[9px] font-bold leading-none" style={{ color: fromAgent.color }}>
          {fromAgent.icon}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Name line */}
        <div className="flex items-center gap-1.5 mb-0.5">
          <span
            className={`text-xs font-semibold leading-none ${isLeader ? "uppercase tracking-wider" : ""}`}
            style={{ color: fromAgent.color }}
          >
            {t(getAgentNameKey(message.fromAgentId))}
          </span>
          {message.toAgentId !== "all" ? (
            <span className="text-[11px] text-muted-foreground/60 leading-none">
              &rarr;{" "}
              <span style={{ color: getAgent(message.toAgentId)?.color + "aa" }}>
                {t(getAgentNameKey(message.toAgentId))}
              </span>
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground/50 leading-none">
              &rarr; {t("swarm.chatPanel.toAll")}
            </span>
          )}
          {/* Type dot */}
          {!isLeader && (
            <span className={`w-1.5 h-1.5 rounded-full ${TYPE_DOT_COLOR[message.type]}`} />
          )}
        </div>

        {/* Message text */}
        <p
          className={`text-[13px] leading-relaxed ${
            isConsensus
              ? "text-cyan-300 font-medium"
              : isAlert
                ? "text-red-300/90"
                : isLeader
                  ? "text-foreground/80"
                  : "text-foreground/70"
          }`}
        >
          {message.rawContent || t(message.contentKey, resolvedParams)}
        </p>
      </div>
    </div>
  );
}
