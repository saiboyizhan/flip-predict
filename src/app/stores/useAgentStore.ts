import { create } from 'zustand'
import { getMyAgents, autoSyncAgents, type Agent } from '@/app/services/api'

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
      // Auto-sync on-chain agents that aren't registered in backend yet.
      // Fire-and-forget: don't block the main fetch if sync fails or is slow.
      autoSyncAgents()
        .then((result) => {
          if (result.synced > 0) {
            // Re-fetch after successful sync to include newly synced agents
            getMyAgents().then((agents) => {
              set({
                agents,
                hasAgent: agents.length > 0,
                agentCount: agents.length,
              })
            }).catch(() => {})
          }
        })
        .catch(() => {
          // Sync failed (RPC unavailable, not authenticated, etc.) — ignore
        })

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
