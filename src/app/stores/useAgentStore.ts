import { create } from 'zustand'
import { getMyAgents, autoSyncAgents, type Agent } from '@/app/services/api'

let syncInFlight = false

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
      // Guard: only one sync request at a time to prevent duplicate inserts.
      if (!syncInFlight) {
        syncInFlight = true
        autoSyncAgents()
          .then((result) => {
            if (result.synced > 0) {
              getMyAgents().then((agents) => {
                set({
                  agents,
                  hasAgent: agents.length > 0,
                  agentCount: agents.length,
                })
              }).catch((e) => { console.warn('[AgentStore] Failed to reload agents after sync:', e.message) })
            }
          })
          .catch((e) => { console.warn('[AgentStore] Auto-sync failed:', e.message) })
          .finally(() => { syncInFlight = false })
      }

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
