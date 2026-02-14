// Swarm AI analysis types

export interface SwarmAnalyzeRequest {
  tokenName: string;
  tokenAddress?: string;
  chain?: string;
  category?: 'meme' | 'defi' | 'nft';
}

export interface AgentAnalysisResult {
  score: number;
  findings: string;
}

export interface DiscussionMessage {
  from: string;
  to: string;
  content: string;
  type: 'finding' | 'alert' | 'question' | 'response' | 'revision' | 'command' | 'consensus';
}

// SSE event payloads
export interface SSEPhaseEvent {
  phase: 'creating_team' | 'phase1' | 'phase2' | 'phase3' | 'phase4' | 'complete';
}

export interface SSEAgentJoinEvent {
  agentId: string;
  weight: number;
}

export interface SSETypingEvent {
  agentId: string;
}

export interface SSEMessageEvent {
  fromAgentId: string;
  toAgentId: string;
  content: string;
  type: string;
  phase: number;
}

export interface SSEScoreEvent {
  agentId: string;
  field: 'initialScore' | 'revisedScore';
  score: number;
}

export interface SSEAgentStatusEvent {
  agentId: string;
  status: 'joining' | 'analyzing' | 'phase1_complete' | 'communicating' | 'revising' | 'complete';
}

export interface SSEConsensusEvent {
  initialScore: number;
  finalScore: number;
}

export interface SSEErrorEvent {
  message: string;
  agentId?: string;
}

// Agent category team mappings
export const AGENT_TEAMS: Record<string, string[]> = {
  meme: ['security', 'social', 'whale', 'momentum'],
  defi: ['security', 'technical', 'liquidity', 'contract'],
  nft: ['social', 'narrative', 'whale', 'momentum'],
  default: ['security', 'technical', 'social', 'whale'],
};
