import { create } from 'zustand'
import { getMyAgents, type Agent } from '@/app/services/api'

interface AgentState {
  agents: Agent[]
  hasAgent: boolean
  agentCount: number
  showMintModal: boolean

  fetchMyAgents: () => Promise<void>
  setShowMintModal: (show: boolean) => void
  addAgent: (agent: Agent) => void
  reset: () => void
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  hasAgent: false,
  agentCount: 0,
  showMintModal: false,

  fetchMyAgents: async () => {
    try {
      const agents = await getMyAgents()
      set({
        agents,
        hasAgent: agents.length > 0,
        agentCount: agents.length,
      })
    } catch {
      // API not available or not authenticated — keep defaults
    }
  },

  setShowMintModal: (show) => set({ showMintModal: show }),

  addAgent: (agent) => {
    const agents = [...get().agents, agent]
    set({
      agents,
      hasAgent: true,
      agentCount: agents.length,
    })
  },

  reset: () =>
    set({
      agents: [],
      hasAgent: false,
      agentCount: 0,
      showMintModal: false,
    }),
}))
