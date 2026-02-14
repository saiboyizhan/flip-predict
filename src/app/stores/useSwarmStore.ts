import { create } from 'zustand'
import { fetchSwarmHistory, fetchSwarmAgentStats } from '@/app/services/api'
import type { SwarmHistoryItem, SwarmAgentStat } from '@/app/services/api'

let pendingTimeouts: ReturnType<typeof setTimeout>[] = []
let activeAbortController: AbortController | null = null

function clearAllTimeouts() {
  pendingTimeouts.forEach(clearTimeout)
  pendingTimeouts = []
}

function addTimeout(fn: () => void, ms: number) {
  const id = setTimeout(fn, ms)
  pendingTimeouts.push(id)
  return id
}

// ═══════════════════════════════════════
// Agent pool — Leader dynamically selects
// ═══════════════════════════════════════

export interface SwarmAgentDef {
  id: string
  icon: string
  color: string
  dimensionKey: string
}

export const ALL_AGENTS: SwarmAgentDef[] = [
  { id: 'security', icon: 'SC', color: '#ef4444', dimensionKey: 'security' },
  { id: 'technical', icon: 'TA', color: '#3b82f6', dimensionKey: 'technical' },
  { id: 'social', icon: 'SS', color: '#8b5cf6', dimensionKey: 'social' },
  { id: 'whale', icon: 'WT', color: '#f59e0b', dimensionKey: 'whale' },
  { id: 'momentum', icon: 'MB', color: '#10b981', dimensionKey: 'momentum' },
  { id: 'liquidity', icon: 'LS', color: '#14b8a6', dimensionKey: 'liquidity' },
  { id: 'narrative', icon: 'NT', color: '#ec4899', dimensionKey: 'narrative' },
  { id: 'contract', icon: 'CA', color: '#f97316', dimensionKey: 'contract' },
]

export const LEADER_AGENT = {
  id: 'leader' as const,
  name: 'SwarmLeader',
  icon: 'SL',
  color: '#06b6d4',
}

// ═══════════════════════════════════════
// Per-market team configurations
// ═══════════════════════════════════════

export type SwarmPhase = 'idle' | 'creating_team' | 'team_ready' | 'phase1' | 'phase2' | 'phase3' | 'phase4' | 'complete'
export type SwarmMessageType = 'finding' | 'alert' | 'question' | 'response' | 'revision' | 'command' | 'consensus'

export interface SwarmMessage {
  id: string
  fromAgentId: string
  toAgentId: string
  contentKey: string
  rawContent?: string
  params?: Record<string, string | number>
  type: SwarmMessageType
  timestamp: number
  phase: 0 | 1 | 2 | 3 | 4
}

export interface AgentAnalysis {
  agentId: string
  weight: number
  initialScore: number | null
  revisedScore: number | null
  finalScore: number | null
  status: 'idle' | 'joining' | 'analyzing' | 'phase1_complete' | 'communicating' | 'revising' | 'complete'
  timestamp: number | null
}

interface MarketTeamConfig {
  agentIds: string[]
  weights: number[]
  initialScores: Record<string, number>
  revisedScores: Record<string, number>
  phase2Messages: Omit<SwarmMessage, 'id' | 'timestamp'>[]
}

export interface DemoMarket {
  id: string
  i18nKey: string
  nameKey: string
  descKey: string
  team: MarketTeamConfig
}

export const DEMO_MARKETS: DemoMarket[] = [
  {
    id: 'pepe-pump',
    i18nKey: 'pepePump',
    nameKey: 'swarm.markets.pepePump',
    descKey: 'swarm.markets.pepePumpDesc',
    team: {
      agentIds: ['technical', 'social', 'whale', 'momentum'],
      weights: [25, 25, 25, 25],
      initialScores: { technical: 68, social: 78, whale: 65, momentum: 74 },
      revisedScores: { technical: 62, social: 70, whale: 55, momentum: 66 },
      phase2Messages: [
        { fromAgentId: 'social', toAgentId: 'whale', contentKey: 'swarm.chat.pepePump.phase2.socialAskWhale', type: 'question', phase: 2 },
        { fromAgentId: 'whale', toAgentId: 'social', contentKey: 'swarm.chat.pepePump.phase2.whaleReplySocial', type: 'response', phase: 2 },
        { fromAgentId: 'momentum', toAgentId: 'technical', contentKey: 'swarm.chat.pepePump.phase2.momentumAskTech', type: 'question', phase: 2 },
        { fromAgentId: 'technical', toAgentId: 'momentum', contentKey: 'swarm.chat.pepePump.phase2.techReplyMomentum', type: 'response', phase: 2 },
        { fromAgentId: 'whale', toAgentId: 'all', contentKey: 'swarm.chat.pepePump.phase2.whaleAlert', type: 'alert', phase: 2 },
      ],
    },
  },
  {
    id: 'new-meme',
    i18nKey: 'newMeme',
    nameKey: 'swarm.markets.newMeme',
    descKey: 'swarm.markets.newMemeDesc',
    team: {
      agentIds: ['security', 'contract', 'whale', 'liquidity'],
      weights: [30, 25, 25, 20],
      initialScores: { security: 42, contract: 35, whale: 48, liquidity: 55 },
      revisedScores: { security: 28, contract: 22, whale: 38, liquidity: 40 },
      phase2Messages: [
        { fromAgentId: 'security', toAgentId: 'contract', contentKey: 'swarm.chat.newMeme.phase2.securityAskContract', type: 'question', phase: 2 },
        { fromAgentId: 'contract', toAgentId: 'security', contentKey: 'swarm.chat.newMeme.phase2.contractReplySecurity', type: 'response', phase: 2 },
        { fromAgentId: 'liquidity', toAgentId: 'whale', contentKey: 'swarm.chat.newMeme.phase2.liquidityAskWhale', type: 'question', phase: 2 },
        { fromAgentId: 'whale', toAgentId: 'liquidity', contentKey: 'swarm.chat.newMeme.phase2.whaleReplyLiquidity', type: 'response', phase: 2 },
        { fromAgentId: 'contract', toAgentId: 'all', contentKey: 'swarm.chat.newMeme.phase2.contractAlert', type: 'alert', phase: 2 },
      ],
    },
  },
  {
    id: 'doge-fork',
    i18nKey: 'dogeFork',
    nameKey: 'swarm.markets.dogeFork',
    descKey: 'swarm.markets.dogeForkDesc',
    team: {
      agentIds: ['security', 'technical', 'social', 'narrative'],
      weights: [25, 25, 25, 25],
      initialScores: { security: 70, technical: 62, social: 82, narrative: 75 },
      revisedScores: { security: 65, technical: 58, social: 74, narrative: 70 },
      phase2Messages: [
        { fromAgentId: 'narrative', toAgentId: 'social', contentKey: 'swarm.chat.dogeFork.phase2.narrativeAskSocial', type: 'question', phase: 2 },
        { fromAgentId: 'social', toAgentId: 'narrative', contentKey: 'swarm.chat.dogeFork.phase2.socialReplyNarrative', type: 'response', phase: 2 },
        { fromAgentId: 'security', toAgentId: 'technical', contentKey: 'swarm.chat.dogeFork.phase2.securityAskTech', type: 'question', phase: 2 },
        { fromAgentId: 'technical', toAgentId: 'security', contentKey: 'swarm.chat.dogeFork.phase2.techReplySecurity', type: 'response', phase: 2 },
        { fromAgentId: 'security', toAgentId: 'all', contentKey: 'swarm.chat.dogeFork.phase2.securityAlert', type: 'alert', phase: 2 },
      ],
    },
  },
]

// ═══════════════════════════════════════
// Store
// ═══════════════════════════════════════

interface SwarmState {
  activeAgents: SwarmAgentDef[]
  activeWeights: number[]
  phase: SwarmPhase
  messages: SwarmMessage[]
  analyses: Record<string, AgentAnalysis[]>
  consensus: Record<string, { score: number; initialScore: number; complete: boolean; timestamp: number } | null>
  isAnalyzing: boolean
  analysisMode: 'demo' | 'real'
  selectedMarketId: string | null
  typingAgentId: string | null
  historyData: SwarmHistoryItem[]
  agentStats: SwarmAgentStat[]
  isDynamicWeights: boolean
  historyLoading: boolean

  selectMarket: (marketId: string) => void
  startCollaborativeAnalysis: () => void
  startRealAnalysis: (tokenName: string, tokenAddress?: string, chain?: string, category?: string) => void
  loadHistory: (tokenName?: string) => Promise<void>
  loadAgentStats: () => Promise<void>
  reset: () => void
}

let msgCounter = 0

export const useSwarmStore = create<SwarmState>((set, get) => ({
  activeAgents: [],
  activeWeights: [],
  phase: 'idle',
  messages: [],
  analyses: {},
  consensus: {},
  isAnalyzing: false,
  analysisMode: 'demo',
  selectedMarketId: null,
  typingAgentId: null,
  historyData: [],
  agentStats: [],
  isDynamicWeights: false,
  historyLoading: false,

  selectMarket: (marketId: string) => {
    const market = DEMO_MARKETS.find((m) => m.id === marketId)
    if (!market) return
    const agents = market.team.agentIds
      .map((id) => ALL_AGENTS.find((a) => a.id === id))
      .filter((a): a is SwarmAgentDef => a !== null)
    set({ selectedMarketId: marketId, activeAgents: agents, activeWeights: market.team.weights })
  },

  startCollaborativeAnalysis: () => {
    const { selectedMarketId } = get()
    if (!selectedMarketId) return

    const market = DEMO_MARKETS.find((m) => m.id === selectedMarketId)
    if (!market) return

    clearAllTimeouts()
    msgCounter = 0

    const marketId = selectedMarketId
    const prefix = market.i18nKey
    const config = market.team
    const teamAgents = config.agentIds
      .map((id) => ALL_AGENTS.find((a) => a.id === id))
      .filter((a): a is SwarmAgentDef => a !== null)
    const marketNameKey = `@${market.nameKey}`

    const emptyAnalyses: AgentAnalysis[] = config.agentIds.map((id, i) => ({
      agentId: id,
      weight: config.weights[i],
      initialScore: null,
      revisedScore: null,
      finalScore: null,
      status: 'idle' as const,
      timestamp: null,
    }))

    set({
      phase: 'creating_team',
      isAnalyzing: true,
      messages: [],
      activeAgents: teamAgents,
      activeWeights: config.weights,
      analyses: { [marketId]: emptyAnalyses },
      consensus: { [marketId]: null },
    })

    function push(msg: Omit<SwarmMessage, 'id' | 'timestamp'>) {
      set((s) => ({
        messages: [...s.messages, { ...msg, id: `msg-${msgCounter++}`, timestamp: Date.now() }],
        typingAgentId: null,
      }))
    }

    function setStatus(agentId: string, status: AgentAnalysis['status']) {
      set((s) => {
        const list = [...(s.analyses[marketId] || [])]
        const idx = list.findIndex((a) => a.agentId === agentId)
        if (idx >= 0) list[idx] = { ...list[idx], status }
        return { analyses: { ...s.analyses, [marketId]: list } }
      })
    }

    function setScore(agentId: string, field: 'initialScore' | 'revisedScore', score: number) {
      set((s) => {
        const list = [...(s.analyses[marketId] || [])]
        const idx = list.findIndex((a) => a.agentId === agentId)
        if (idx >= 0) {
          const finalScore = field === 'revisedScore' ? score : (list[idx].revisedScore ?? score)
          list[idx] = { ...list[idx], [field]: score, finalScore, timestamp: Date.now() }
        }
        return { analyses: { ...s.analyses, [marketId]: list } }
      })
    }

    function startTyping(agentId: string) {
      set({ typingAgentId: agentId })
    }

    // ══════════════════════════════════════
    // Phase 0: Leader creates team (0-4s)
    // ══════════════════════════════════════
    addTimeout(() => startTyping('leader'), 0)
    addTimeout(() => {
      push({
        fromAgentId: 'leader', toAgentId: 'all',
        contentKey: `swarm.chat.${prefix}.leader.initTeam`,
        params: { market: marketNameKey },
        type: 'command', phase: 0,
      })
    }, 600)

    config.agentIds.forEach((agentId, i) => {
      const base = 1400 + i * 800
      addTimeout(() => startTyping('leader'), base - 500)
      addTimeout(() => {
        push({
          fromAgentId: 'leader', toAgentId: agentId,
          contentKey: `swarm.chat.${prefix}.leader.assign.${agentId}`,
          type: 'command', phase: 0,
        })
        setStatus(agentId, 'joining')
      }, base)
    })

    const teamReadyTime = 1400 + config.agentIds.length * 800 + 800
    addTimeout(() => startTyping('leader'), teamReadyTime - 500)
    addTimeout(() => {
      push({
        fromAgentId: 'leader', toAgentId: 'all',
        contentKey: 'swarm.chat.leader.teamReady',
        type: 'command', phase: 0,
      })
      set({ phase: 'team_ready' })
    }, teamReadyTime)

    // ══════════════════════════════════════
    // Phase 1: Independent analysis (5-13s)
    // Each agent "thinks" 1.5s before reporting
    // ══════════════════════════════════════
    const phase1Start = teamReadyTime + 1500
    addTimeout(() => {
      set({ phase: 'phase1' })
      config.agentIds.forEach((id) => setStatus(id, 'analyzing'))
    }, phase1Start)

    config.agentIds.forEach((agentId, i) => {
      const msgTime = phase1Start + 2000 + i * 2200
      addTimeout(() => startTyping(agentId), msgTime - 1500)
      addTimeout(() => {
        push({
          fromAgentId: agentId, toAgentId: 'leader',
          contentKey: `swarm.chat.${prefix}.phase1.${agentId}`,
          type: 'finding', phase: 1,
        })
        setScore(agentId, 'initialScore', config.initialScores[agentId])
        setStatus(agentId, 'phase1_complete')
      }, msgTime)
    })

    // ══════════════════════════════════════
    // Phase 2: Cross discussion (15-24s)
    // Agents read + think before responding
    // ══════════════════════════════════════
    const phase2Start = phase1Start + 2000 + config.agentIds.length * 2200 + 1500
    addTimeout(() => startTyping('leader'), phase2Start - 800)
    addTimeout(() => {
      push({
        fromAgentId: 'leader', toAgentId: 'all',
        contentKey: 'swarm.chat.leader.startDiscussion',
        type: 'command', phase: 2,
      })
      set({ phase: 'phase2' })
      config.agentIds.forEach((id) => setStatus(id, 'communicating'))
    }, phase2Start)

    config.phase2Messages.forEach((msg, i) => {
      const msgTime = phase2Start + 1800 + i * 2200
      addTimeout(() => startTyping(msg.fromAgentId), msgTime - 1500)
      addTimeout(() => push(msg), msgTime)
    })

    // ══════════════════════════════════════
    // Phase 3: Score revision (26-31s)
    // ══════════════════════════════════════
    const phase3Start = phase2Start + 1800 + config.phase2Messages.length * 2200 + 1500
    addTimeout(() => startTyping('leader'), phase3Start - 800)
    addTimeout(() => {
      push({
        fromAgentId: 'leader', toAgentId: 'all',
        contentKey: 'swarm.chat.leader.requestRevision',
        type: 'command', phase: 3,
      })
      set({ phase: 'phase3' })
      config.agentIds.forEach((id) => setStatus(id, 'revising'))
    }, phase3Start)

    config.agentIds.forEach((agentId, i) => {
      const msgTime = phase3Start + 1800 + i * 1500
      addTimeout(() => startTyping(agentId), msgTime - 1000)
      addTimeout(() => {
        push({
          fromAgentId: agentId, toAgentId: 'leader',
          contentKey: `swarm.chat.${prefix}.phase3.${agentId}`,
          type: 'revision', phase: 3,
        })
        setScore(agentId, 'revisedScore', config.revisedScores[agentId])
        setStatus(agentId, 'complete')
      }, msgTime)
    })

    // ══════════════════════════════════════
    // Phase 4: Consensus
    // ══════════════════════════════════════
    const phase4Start = phase3Start + 1800 + config.agentIds.length * 1500 + 1500
    addTimeout(() => startTyping('leader'), phase4Start - 1000)
    addTimeout(() => {
      set({ phase: 'phase4' })

      let initW = 0, revW = 0, tw = 0
      config.agentIds.forEach((id, i) => {
        const w = config.weights[i]
        initW += config.initialScores[id] * w
        revW += config.revisedScores[id] * w
        tw += w
      })
      const initialConsensus = Math.round(initW / tw)
      const finalConsensus = Math.round(revW / tw)

      push({
        fromAgentId: 'leader', toAgentId: 'all',
        contentKey: `swarm.chat.${prefix}.leader.consensus`,
        params: { initial: initialConsensus, final: finalConsensus },
        type: 'consensus', phase: 4,
      })

      set((s) => ({
        phase: 'complete',
        isAnalyzing: false,
        consensus: {
          ...s.consensus,
          [marketId]: {
            score: finalConsensus,
            initialScore: initialConsensus,
            complete: true,
            timestamp: Date.now(),
          },
        },
      }))
    }, phase4Start)
  },

  startRealAnalysis: (tokenName: string, tokenAddress?: string, chain?: string, category?: string) => {
    if (activeAbortController) activeAbortController.abort()
    activeAbortController = new AbortController()

    clearAllTimeouts()
    msgCounter = 0

    const marketKey = tokenName

    set({
      phase: 'creating_team',
      isAnalyzing: true,
      analysisMode: 'real',
      messages: [],
      activeAgents: [],
      activeWeights: [],
      analyses: { [marketKey]: [] },
      consensus: { [marketKey]: null },
      selectedMarketId: marketKey,
      typingAgentId: null,
    })

    function push(msg: Omit<SwarmMessage, 'id' | 'timestamp'>) {
      set((s) => ({
        messages: [...s.messages, { ...msg, id: `msg-${msgCounter++}`, timestamp: Date.now() }],
        typingAgentId: null,
      }))
    }

    function setStatus(agentId: string, status: AgentAnalysis['status']) {
      set((s) => {
        const list = [...(s.analyses[marketKey] || [])]
        const idx = list.findIndex((a) => a.agentId === agentId)
        if (idx >= 0) list[idx] = { ...list[idx], status }
        return { analyses: { ...s.analyses, [marketKey]: list } }
      })
    }

    function setScore(agentId: string, field: 'initialScore' | 'revisedScore', score: number) {
      set((s) => {
        const list = [...(s.analyses[marketKey] || [])]
        const idx = list.findIndex((a) => a.agentId === agentId)
        if (idx >= 0) {
          const finalScore = field === 'revisedScore' ? score : (list[idx].revisedScore ?? score)
          list[idx] = { ...list[idx], [field]: score, finalScore, timestamp: Date.now() }
        }
        return { analyses: { ...s.analyses, [marketKey]: list } }
      })
    }

    const controller = activeAbortController

    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

    fetch(`${API_BASE}/api/swarm/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenName, tokenAddress, chain, category }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok || !response.body) throw new Error('SSE connection failed')

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() || ''

          for (const part of parts) {
            if (!part.trim()) continue
            const lines = part.split('\n')
            let eventName = ''
            let eventData = ''
            for (const line of lines) {
              if (line.startsWith('event: ')) eventName = line.slice(7)
              if (line.startsWith('data: ')) eventData = line.slice(6)
            }
            if (!eventName || !eventData) continue

            try {
              const data = JSON.parse(eventData)
              switch (eventName) {
                case 'phase':
                  set({ phase: data.phase })
                  break
                case 'agent_join': {
                  const agentDef = ALL_AGENTS.find(a => a.id === data.agentId)
                  if (agentDef) {
                    set(s => ({
                      activeAgents: [...s.activeAgents, agentDef],
                      activeWeights: [...s.activeWeights, data.weight],
                      analyses: {
                        ...s.analyses,
                        [marketKey]: [...(s.analyses[marketKey] || []), {
                          agentId: data.agentId,
                          weight: data.weight,
                          initialScore: null,
                          revisedScore: null,
                          finalScore: null,
                          status: 'joining' as const,
                          timestamp: null,
                        }],
                      },
                    }))
                  }
                  break
                }
                case 'typing':
                  set({ typingAgentId: data.agentId })
                  break
                case 'message':
                  push({
                    fromAgentId: data.fromAgentId,
                    toAgentId: data.toAgentId,
                    contentKey: '',
                    rawContent: data.content,
                    type: data.type,
                    phase: data.phase,
                  })
                  break
                case 'score':
                  setScore(data.agentId, data.field, data.score)
                  break
                case 'agent_status':
                  setStatus(data.agentId, data.status)
                  break
                case 'consensus':
                  set(s => ({
                    phase: 'complete',
                    isAnalyzing: false,
                    typingAgentId: null,
                    isDynamicWeights: data.isDynamic ?? false,
                    activeWeights: data.weights ?? s.activeWeights,
                    consensus: {
                      ...s.consensus,
                      [marketKey]: {
                        score: data.finalScore,
                        initialScore: data.initialScore,
                        complete: true,
                        timestamp: Date.now(),
                      },
                    },
                  }))
                  // Auto-load history after analysis completes
                  get().loadHistory(tokenName)
                  break
                case 'error':
                  console.error('[Swarm SSE Error]', data.message)
                  break
              }
            } catch (e) {
              console.error('[Swarm SSE parse error]', e)
            }
          }
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        console.warn('[Swarm] SSE failed, falling back to demo mode:', err.message)
        get().reset()
        const firstDemo = DEMO_MARKETS[0]
        if (firstDemo) {
          set({ selectedMarketId: firstDemo.id })
          get().selectMarket(firstDemo.id)
          get().startCollaborativeAnalysis()
        }
      })
  },

  loadHistory: async (tokenName?: string) => {
    set({ historyLoading: true })
    try {
      const data = await fetchSwarmHistory({ tokenName, limit: 20 })
      set({ historyData: data, historyLoading: false })
    } catch (err) {
      console.error('[Swarm] Failed to load history:', err)
      set({ historyLoading: false })
    }
  },

  loadAgentStats: async () => {
    try {
      const data = await fetchSwarmAgentStats()
      set({ agentStats: data })
    } catch (err) {
      console.error('[Swarm] Failed to load agent stats:', err)
    }
  },

  reset: () => {
    if (activeAbortController) { activeAbortController.abort(); activeAbortController = null }
    clearAllTimeouts()
    set({
      activeAgents: [],
      activeWeights: [],
      phase: 'idle',
      messages: [],
      analyses: {},
      consensus: {},
      isAnalyzing: false,
      analysisMode: 'demo',
      typingAgentId: null,
      historyData: [],
      agentStats: [],
      isDynamicWeights: false,
      historyLoading: false,
    })
  },
}))
