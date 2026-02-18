import type { Market, MarketOption } from '@/app/types/market.types'

const API_BASE = import.meta.env.VITE_API_URL || 'https://flip-backend-production.up.railway.app'

// --- Token management ---
let token: string | null = null

export function getToken(): string | null {
  if (!token) {
    token = localStorage.getItem('jwt_token')
  }
  return token
}

export function setToken(t: string): void {
  token = t
  localStorage.setItem('jwt_token', t)
}

export function clearToken(): void {
  token = null
  localStorage.removeItem('jwt_token')
}

// Sync JWT token across browser tabs via storage event
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'jwt_token') {
      token = e.newValue;
    }
  });
}

// --- Generic request helper ---
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const currentToken = getToken()
  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...(options?.headers as Record<string, string>),
      },
    })
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error('Network error. Please check your internet connection.')
    }
    throw err
  }

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API ${res.status}: ${body}`)
  }

  return res.json() as Promise<T>
}

// --- API methods ---

interface RawMarket {
  id: string
  onChainMarketId?: string | number
  on_chain_market_id?: string | number
  title?: string
  description?: string
  category?: string
  status?: string
  yesPrice?: number | string
  yes_price?: number | string
  noPrice?: number | string
  no_price?: number | string
  volume?: number | string
  totalShares?: number | string
  total_shares?: number | string
  participants?: number | string
  createdAt?: string | number
  created_at?: string | number
  endTime?: string | number
  end_time?: string | number
  resolvedAt?: string | number
  resolved_at?: string | number
  resolvedOutcome?: string
  resolved_outcome?: string
  imageUrl?: string
  image_url?: string
  tags?: string[]
  featured?: boolean | number
  resolutionSource?: string
  resolution_source?: string
  resolution_type?: string
  market_type?: string
  marketType?: string
  options?: any[]
  totalLiquidity?: number
  total_liquidity?: number
  yesReserve?: number
  yes_reserve?: number
  noReserve?: number
  no_reserve?: number
}

function toIsoTime(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }
  if (typeof value === 'string') {
    const asNum = Number(value)
    if (Number.isFinite(asNum) && /^\d+$/.test(value)) {
      return new Date(asNum).toISOString()
    }
    const ts = new Date(value).getTime()
    if (Number.isFinite(ts)) return new Date(ts).toISOString()
  }
  return new Date(Date.now()).toISOString()
}

function normalizeMarketStatus(status: unknown): Market['status'] {
  const normalized = String(status ?? 'active').toLowerCase()
  if (normalized === 'active') return 'active'
  if (normalized === 'resolved') return 'resolved'
  if (normalized === 'closed') return 'closed'
  if (normalized === 'disputed') return 'disputed'
  if (normalized === 'pending' || normalized === 'pending_resolution') return 'pending'
  return 'active'
}

function normalizeMarket(raw: RawMarket): Market {
  const yesPrice = Number(raw.yesPrice ?? raw.yes_price ?? 0.5) || 0.5
  const noPrice = 1 - yesPrice  // always derived — guarantees yes + no === 1

  const resolvedOutcome = String(raw.resolvedOutcome ?? raw.resolved_outcome ?? '').toLowerCase()
  const mappedOutcome = resolvedOutcome === 'yes' ? 'YES' : resolvedOutcome === 'no' ? 'NO' : undefined
  const tags = Array.isArray(raw.tags) ? raw.tags : []

  const rawMarketType = raw.market_type ?? raw.marketType ?? 'binary'
  const marketType = (rawMarketType === 'multi' ? 'multi' : 'binary') as Market['marketType']

  const options: MarketOption[] | undefined = Array.isArray(raw.options)
    ? raw.options.map((o: any) => ({
        id: String(o.id),
        optionIndex: Number(o.option_index ?? o.optionIndex) || 0,
        label: String(o.label ?? ''),
        color: String(o.color ?? '#3b82f6'),
        price: Number(o.price) || 0,
        reserve: Number(o.reserve) || 0,
      }))
    : undefined

  const parsedOnChainMarketId = raw.onChainMarketId ?? raw.on_chain_market_id
  const onChainMarketId = parsedOnChainMarketId == null
    ? undefined
    : String(parsedOnChainMarketId)

  return {
    id: String(raw.id),
    onChainMarketId,
    title: String(raw.title ?? ''),
    description: String(raw.description ?? ''),
    category: (raw.category ?? 'four-meme') as Market['category'],
    status: normalizeMarketStatus(raw.status),
    yesPrice,
    noPrice,
    volume: Number(raw.volume) || 0,
    totalShares: Number(raw.totalShares ?? raw.total_shares) || 0,
    participants: Number(raw.participants) || 0,
    createdAt: toIsoTime(raw.createdAt ?? raw.created_at),
    endTime: toIsoTime(raw.endTime ?? raw.end_time),
    resolvedAt: (raw.resolvedAt ?? raw.resolved_at) == null ? undefined : toIsoTime(raw.resolvedAt ?? raw.resolved_at),
    resolvedOutcome: mappedOutcome,
    imageUrl: raw.imageUrl ?? raw.image_url,
    tags,
    featured: Boolean(raw.featured),
    resolutionSource: String(raw.resolution_type ?? raw.resolution_source ?? raw.resolutionSource ?? 'auto'),
    marketType,
    options,
    totalLiquidity: Number(raw.totalLiquidity ?? raw.total_liquidity) || undefined,
    yesReserve: Number(raw.yesReserve ?? raw.yes_reserve) || undefined,
    noReserve: Number(raw.noReserve ?? raw.no_reserve) || undefined,
  }
}

export async function fetchMarkets(params?: {
  category?: string
  search?: string
  sort?: string
}): Promise<Market[]> {
  const query = new URLSearchParams()
  if (params?.category) query.set('category', params.category)
  if (params?.search) query.set('search', params.search)
  if (params?.sort) query.set('sort', params.sort)

  const qs = query.toString()
  const data = await request<{ markets: RawMarket[] }>(`/api/markets${qs ? `?${qs}` : ''}`)
  return (data.markets ?? []).map(normalizeMarket)
}

export async function fetchMarket(id: string): Promise<Market> {
  const data = await request<{ market: RawMarket; recentOrders: unknown[]; options?: any[] }>(`/api/markets/${id}`)
  const rawMarket = { ...data.market, options: data.options ?? data.market.options }
  return normalizeMarket(rawMarket)
}

export async function createOrder(data: {
  marketId: string
  side?: string
  amount: number
  optionId?: string
}): Promise<{
  orderId: string
  shares: number
  price: number
  newYesPrice: number
  newNoPrice: number
  newYesReserve?: number
  newNoReserve?: number
  newPrices?: { optionId: string; price: number }[]
}> {
  const res = await request<{
    order?: {
      orderId: string
      shares: number
      price: number
      newYesPrice: number
      newNoPrice: number
      newYesReserve?: number
      newNoReserve?: number
      newPrices?: { optionId: string; price: number }[]
    }
  }>('/api/orders', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  if (!res.order) {
    throw new Error('Invalid order response from server')
  }
  return res.order
}

export async function sellOrder(data: {
  marketId: string
  side?: string
  shares: number
  optionId?: string
}): Promise<{
  orderId: string
  amountOut: number
  price: number
  newYesPrice: number
  newNoPrice: number
  newYesReserve?: number
  newNoReserve?: number
  newPrices?: { optionId: string; price: number }[]
}> {
  const res = await request<{
    order?: {
      orderId: string
      amountOut: number
      price: number
      newYesPrice: number
      newNoPrice: number
      newYesReserve?: number
      newNoReserve?: number
      newPrices?: { optionId: string; price: number }[]
    }
  }>('/api/orders/sell', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  if (!res.order) {
    throw new Error('Invalid sell response from server')
  }
  return res.order
}

export async function getPositions(): Promise<unknown[]> {
  const data = await request<{ positions: unknown[] }>('/api/positions')
  return data.positions
}

export async function getBalances(): Promise<{
  available: number
  locked: number
}> {
  return request('/api/balances')
}

export async function getNonce(
  address: string,
): Promise<{ nonce: string; message: string }> {
  return request(`/api/auth/nonce/${address}`)
}

export async function verifySignature(
  address: string,
  signature: string,
): Promise<{ token: string; user?: { isAdmin?: boolean } }> {
  return request('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ address, signature }),
  })
}

// --- Market Activity API ---

export interface MarketActivity {
  id: string
  userAddress: string
  side: string
  type: string
  amount: number
  shares: number
  price: number
  optionLabel: string | null
  createdAt: number
}

export async function fetchMarketActivity(marketId: string): Promise<MarketActivity[]> {
  const data = await request<{ activity: MarketActivity[] }>(`/api/markets/${marketId}/activity`)
  return data.activity ?? []
}

// --- Related Markets API ---

export async function fetchRelatedMarkets(marketId: string): Promise<Market[]> {
  const data = await request<{ markets: RawMarket[] }>(`/api/markets/${marketId}/related`)
  return (data.markets ?? []).map(normalizeMarket)
}

// --- Price History API ---

export interface PricePoint {
  time_bucket: string
  yes_price: number
  no_price: number
  volume: number
  timestamp: string
}

export async function fetchPriceHistory(marketId: string, interval: string = '1h', from?: string, to?: string) {
  const params = new URLSearchParams({ interval })
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  return request<{ history: PricePoint[] }>(`/api/markets/${marketId}/history?${params}`)
}

// --- Orderbook API ---

export interface OrderBookLevel {
  price: number
  amount: number
  count: number
}

export interface OrderBookData {
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  spread: number
  midPrice: number
}

export interface OpenOrder {
  id: string
  marketId: string
  side: string
  orderSide: string
  price: number
  amount: number
  filled: number
  status: string
  createdAt: string
}

interface RawOpenOrder {
  id: string
  market_id?: string
  marketId?: string
  side: string
  order_side?: string
  orderSide?: string
  price: number
  amount: number
  filled: number
  status: string
  created_at?: string | number
  createdAt?: string | number
}

function normalizeOpenOrder(order: RawOpenOrder): OpenOrder {
  return {
    id: order.id,
    marketId: order.marketId ?? order.market_id ?? '',
    side: order.side,
    orderSide: order.orderSide ?? order.order_side ?? 'buy',
    price: Number(order.price) || 0,
    amount: Number(order.amount) || 0,
    filled: Number(order.filled) || 0,
    status: order.status,
    createdAt: String(order.createdAt ?? order.created_at ?? ''),
  }
}

export async function getOrderBook(marketId: string, side: string): Promise<OrderBookData> {
  return request<OrderBookData>(`/api/orderbook/${marketId}/${side}`)
}

export async function placeLimitOrder(data: {
  marketId: string
  side: string
  orderSide: string
  price: number
  amount: number
}): Promise<{ orderId: string }> {
  const res = await request<{ order?: { orderId: string } }>('/api/orderbook/limit', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  if (!res.order?.orderId) {
    throw new Error('Invalid limit order response from server')
  }
  return { orderId: res.order.orderId }
}

export async function placeMarketOrder(data: {
  marketId: string
  side: string
  orderSide: string
  amount: number
}): Promise<{ orderId: string }> {
  const res = await request<{ order?: { orderId: string } }>('/api/orderbook/market', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  if (!res.order?.orderId) {
    throw new Error('Invalid market order response from server')
  }
  return { orderId: res.order.orderId }
}

export async function cancelOrder(orderId: string): Promise<{ success: boolean }> {
  return request(`/api/orderbook/${orderId}`, {
    method: 'DELETE',
  })
}

export async function getOpenOrders(): Promise<OpenOrder[]> {
  const data = await request<{ orders?: RawOpenOrder[] } | RawOpenOrder[]>('/api/orderbook/open')
  const orders = Array.isArray(data) ? data : (data.orders ?? [])
  return orders.map(normalizeOpenOrder)
}

// --- Settlement API ---

export async function getSettlement(marketId: string): Promise<{
  resolution: {
    resolution_type: string
    oracle_pair?: string
    target_price?: number
    resolved_price?: number
    outcome?: string
    resolved_at?: string
    resolved_by?: string
    winning_option_id?: string
    rule_text?: string
    data_source_url?: string
    evidence_url?: string
    evidence_hash?: string
    resolve_tx_hash?: string
  }
  logs: unknown[]
  proposals?: unknown[]
  challenges?: unknown[]
}> {
  return request(`/api/settlement/${marketId}`)
}

export async function getSettlementPreview(marketId: string): Promise<{
  marketId: string
  market: {
    id: string
    title: string
    status: string
    marketType: string
    endTime: number
    ended: boolean
  }
  resolution: {
    type: string
    oraclePair: string | null
    targetPrice: number | null
    currentPrice: number | null
    priceSource: 'oracle' | 'dexscreener' | null
    priceUpdatedAt: number | null
    expectedOutcome: 'yes' | 'no' | null
    resolvedOutcome: string | null
    resolvedPrice: number | null
    resolvedAt: number | null
    resolvedBy: string | null
    winningOptionId: string | null
    ruleText: string | null
    dataSourceUrl: string | null
    resolutionTimeUtc: number | null
    resolveTxHash: string | null
    priceError: string | null
  }
  arbitration: {
    latestProposalId: string
    status: string
    proposedOutcome: string | null
    proposedWinningOptionId: string | null
    proposedBy: string | null
    evidenceUrl: string | null
    evidenceHash: string | null
    sourceUrl: string | null
    resolveTxHash: string | null
    challengeWindowEndsAt: number
    challengeCount: number
    createdAt: number
  } | null
  canAutoResolveNow: boolean
  generatedAt: number
}> {
  return request(`/api/settlement/${marketId}/preview`)
}

export async function getSettlementProof(marketId: string): Promise<{
  market: {
    id: string
    title: string
    status: string
    marketType: string
    endTime: number
    onChainMarketId?: string | null
  }
  resolution: Record<string, unknown> | null
  resolveTxVerification?: {
    ok: boolean
    error?: string
    blockNumber?: number
    txTo?: string | null
  }
  summary: {
    winnerCount: number
    loserCount: number
    cancelledOpenOrders: number
    claimedCount: number
    winnerTotal: number
    loserTotal: number
    claimedTotal: number
    cancelledOpenOrdersTotal: number
    netDeposits: number
    settlementGap: number
    challengeCount: number
  }
  checks: Array<{ key: string; pass: boolean; message: string }>
  overallPass: boolean
  proofDigest: string
  arbitration: {
    proposalId: string
    status: string
    proposedBy: string
    proposedOutcome: string | null
    proposedWinningOptionId: string | null
    challengeWindowEndsAt: number
    challengeCount: number
    sourceUrl: string | null
    evidenceUrl: string | null
    evidenceHash: string | null
    resolveTxHash: string | null
    finalizedAt: number | null
    finalizedBy: string | null
  } | null
  logs: {
    resolveLogs: unknown[]
    winnerSamples: unknown[]
    loserSamples: unknown[]
    challengeSamples: unknown[]
  }
  generatedAt: number
}> {
  return request(`/api/settlement/${marketId}/proof`)
}

export async function proposeSettlement(
  marketId: string,
  data: {
    outcome?: 'yes' | 'no'
    winningOptionId?: string
    evidenceUrl?: string
    evidenceHash?: string
    sourceUrl?: string
    notes?: string
    resolveTxHash?: string
    challengeWindowHours?: number
  },
): Promise<{
  success: boolean
  proposal: {
    id: string
    marketId: string
    proposedBy: string
    proposedOutcome: string | null
    proposedWinningOptionId: string | null
    challengeWindowEndsAt: number
    status: string
  }
}> {
  return request(`/api/settlement/${marketId}/propose`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function challengeSettlement(
  marketId: string,
  data: {
    proposalId?: string
    reason: string
    evidenceUrl?: string
    evidenceHash?: string
  },
): Promise<{
  success: boolean
  challenge: {
    id: string
    proposalId: string
    marketId: string
    challenger: string
    createdAt: number
  }
}> {
  return request(`/api/settlement/${marketId}/challenge`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function finalizeSettlement(
  marketId: string,
  data: {
    proposalId?: string
    outcome?: 'yes' | 'no'
    winningOptionId?: string
    evidenceUrl?: string
    evidenceHash?: string
    resolveTxHash: string
    notes?: string
  },
): Promise<{
  success: boolean
  marketId: string
  outcome: string
  proposalId: string | null
  resolveTxHash?: string
  resolveTxBlockNumber?: number | null
}> {
  return request(`/api/settlement/${marketId}/finalize`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function claimWinnings(marketId: string): Promise<{
  success: boolean
  amount?: number
}> {
  return request(`/api/settlement/${marketId}/claim`, {
    method: 'POST',
  })
}

export async function getResolvedMarkets(): Promise<unknown[]> {
  const data = await request<{ markets?: unknown[] } | unknown[]>('/api/settlement/resolved')
  return Array.isArray(data) ? data : (data.markets ?? [])
}

export async function adminResolve(
  marketId: string,
  outcome: string,
  winningOptionId?: string,
  extra?: {
    evidenceUrl?: string
    evidenceHash?: string
    resolveTxHash: string
    notes?: string
  },
): Promise<{ success: boolean }> {
  if (!extra?.resolveTxHash) {
    throw new Error('resolveTxHash is required for adminResolve');
  }
  return finalizeSettlement(marketId, {
    outcome: outcome === 'yes' || outcome === 'no' ? outcome : undefined,
    winningOptionId,
    evidenceUrl: extra?.evidenceUrl,
    evidenceHash: extra?.evidenceHash,
    resolveTxHash: extra.resolveTxHash,
    notes: extra?.notes,
  })
}

// === NFA Agent API ===

export interface AgentTrade {
  id: string
  agent_id: string
  market_id: string
  side: string
  amount: number
  shares: number
  price: number
  outcome: string | null
  profit: number | null
  created_at: string
}

export interface Agent {
  id: string
  name: string
  owner_address: string
  avatar: string | null
  strategy: string
  description: string | null
  status: string
  wallet_balance: number
  total_trades: number
  winning_trades: number
  total_profit: number
  win_rate: number
  roi: number
  level: number
  experience: number
  is_for_sale: boolean
  sale_price: number | null
  is_for_rent: boolean
  rent_price: number | null
  vault_uri: string | null
  vault_hash: string | null
  token_id?: number | null
  mint_tx_hash?: string | null
  created_at: string
  last_trade_at: string | null
  reputation_score?: number
}

export interface AgentDetail extends Agent {
  agent_trades: AgentTrade[]
}

export async function getAgents(params?: { sort?: string; strategy?: string }): Promise<Agent[]> {
  const query = new URLSearchParams()
  if (params?.sort) query.set('sort', params.sort)
  if (params?.strategy) query.set('strategy', params.strategy)
  const qs = query.toString()
  const data = await request<{ agents: Agent[] }>(`/api/agents${qs ? `?${qs}` : ''}`)
  return data.agents
}

export async function getAgent(id: string): Promise<AgentDetail> {
  const data = await request<{ agent: Agent; trades: AgentTrade[] }>(`/api/agents/${id}`)
  return { ...data.agent, agent_trades: data.trades }
}

export async function getAgentLeaderboard(): Promise<Agent[]> {
  const data = await request<{ agents: Agent[] }>('/api/agents/leaderboard')
  return data.agents
}

export async function getAgentMarketplace(): Promise<Agent[]> {
  const data = await request<{ agents: Agent[] }>('/api/agents/marketplace')
  return data.agents
}

export async function mintAgent(data: {
  name: string
  strategy: string
  description: string
  persona?: string
  avatar?: string | null
  tokenId?: string
  mintTxHash?: string
}): Promise<Agent> {
  const res = await request<{ agent: Agent }>('/api/agents/mint', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return res.agent
}

export async function recoverAgent(data: {
  name: string
  strategy: string
  description: string
  persona?: string
  avatar: string
  mintTxHash: string
}): Promise<Agent> {
  const res = await request<{ agent: Agent }>('/api/agents/recover', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return res.agent
}

export async function autoSyncAgents(): Promise<{ synced: number; agents: Agent[] }> {
  return request<{ synced: number; agents: Agent[] }>('/api/agents/auto-sync', {
    method: 'POST',
  })
}

export async function getMyAgents(): Promise<Agent[]> {
  const data = await request<{ agents: Agent[] }>('/api/agents/my')
  return data.agents
}

export async function checkAgent(): Promise<{ hasAgent: boolean; agentCount: number }> {
  return request('/api/agents/check')
}

export async function updateAgent(id: string, data: { strategy?: string; description?: string }): Promise<Agent> {
  const res = await request<{ agent?: Agent }>(`/api/agents/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
  if (!res.agent) {
    throw new Error('Invalid agent response from server')
  }
  return res.agent
}

export async function listAgentForSale(id: string, price: number): Promise<{ success: boolean }> {
  return request(`/api/agents/${id}/list-sale`, {
    method: 'POST',
    body: JSON.stringify({ price }),
  })
}

export async function listAgentForRent(id: string, pricePerDay: number): Promise<{ success: boolean }> {
  return request(`/api/agents/${id}/list-rent`, {
    method: 'POST',
    body: JSON.stringify({ pricePerDay }),
  })
}

export async function buyAgent(id: string, txHash?: string): Promise<{ success: boolean }> {
  return request(`/api/agents/${id}/buy`, {
    method: 'POST',
    body: txHash ? JSON.stringify({ txHash }) : undefined,
  })
}

export async function rentAgent(id: string, days: number): Promise<{ success: boolean }> {
  return request(`/api/agents/${id}/rent`, {
    method: 'POST',
    body: JSON.stringify({ days }),
  })
}

export async function delistAgent(id: string): Promise<{ success: boolean }> {
  return request(`/api/agents/${id}/delist`, {
    method: 'DELETE',
  })
}

export async function updateAgentVault(id: string, data: { vaultURI: string; vaultHash: string }): Promise<{ success: boolean }> {
  return request(`/api/agents/${id}/vault`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function getAgentVault(id: string): Promise<{ vaultURI: string | null; vaultHash: string | null }> {
  return request(`/api/agents/${id}/vault`)
}

// ============================================
// Agent Platform Funding (user balance <-> agent)
// ============================================

export async function fundAgentPlatform(agentId: string, amount: number): Promise<{ success: boolean; agentBalance: number; userBalance: number }> {
  return request(`/api/agents/${agentId}/fund-platform`, {
    method: 'POST',
    body: JSON.stringify({ amount }),
  })
}

export async function withdrawAgentPlatform(agentId: string, amount: number): Promise<{ success: boolean; agentBalance: number; userBalance: number }> {
  return request(`/api/agents/${agentId}/withdraw-platform`, {
    method: 'POST',
    body: JSON.stringify({ amount }),
  })
}

// ============================================
// BAP-578 Agent Prediction & Advisory API
// ============================================

// --- Agent Predictions ---

export async function recordPrediction(agentId: string, data: {
  marketId: string
  prediction: 'yes' | 'no'
  confidence: number
  reasoning?: string
}): Promise<any> {
  const res = await request<{ prediction: any }>(`/api/agents/${agentId}/predict`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return res.prediction
}

export async function getAgentPredictions(agentId: string, limit?: number): Promise<any[]> {
  const params = limit ? `?limit=${limit}` : ''
  const data = await request<{ predictions: any[] }>(`/api/agents/${agentId}/predictions${params}`)
  return data.predictions
}

export async function getAgentStyleProfile(agentId: string): Promise<any> {
  const data = await request<{ profile: any }>(`/api/agents/${agentId}/style-profile`)
  return data.profile
}

// --- Agent Suggestions ---

export async function generateSuggestion(agentId: string, marketId: string): Promise<any> {
  const data = await request<{ suggestion: any }>(`/api/agents/${agentId}/suggest`, {
    method: 'POST',
    body: JSON.stringify({ marketId }),
  })
  return data.suggestion
}

export async function executeSuggestion(agentId: string, suggestionId: string, riskConfirmed: boolean): Promise<any> {
  return request(`/api/agents/${agentId}/execute-suggestion`, {
    method: 'POST',
    body: JSON.stringify({ suggestionId, riskConfirmed }),
  })
}

// --- Auto Trade ---

export async function authorizeAutoTrade(agentId: string, data: {
  maxPerTrade: number
  maxDailyAmount: number
  durationHours: number
}): Promise<any> {
  const res = await request<{ agent: any }>(`/api/agents/${agentId}/authorize-trade`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return res.agent
}

export async function revokeAutoTrade(agentId: string): Promise<any> {
  const res = await request<{ agent: any }>(`/api/agents/${agentId}/revoke-trade`, {
    method: 'POST',
  })
  return res.agent
}

export async function getAutoTradeAuth(agentId: string): Promise<any> {
  const data = await request<{ agent?: any }>(`/api/agents/${agentId}`)
  return data.agent ?? null
}

// --- Learning ---

// Available but not yet wired to UI - see AgentDetail for integration point
export async function getAgentLearningMetrics(agentId: string): Promise<any> {
  const data = await request<{ metrics: any }>(`/api/agents/${agentId}/learning-metrics`)
  return data.metrics
}

// --- Owner Learning ---

// Available but not yet wired to UI - see AgentDetail for integration point
export async function toggleLearnFromOwner(agentId: string, enabled: boolean): Promise<{ success: boolean; learnFromOwner: number }> {
  return request<{ success: boolean; learnFromOwner: number }>(`/api/agents/${agentId}/learn-from-owner`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  })
}

// Available but not yet wired to UI - see AgentDetail for integration point
export async function getOwnerProfile(agentId: string): Promise<{ profile: any; influence: any; enabled: boolean }> {
  return request<{ profile: any; influence: any; enabled: boolean }>(`/api/agents/${agentId}/owner-profile`)
}

// ============================================
// User Market Creation API
// ============================================

export async function createUserMarket(data: {
  title: string
  description?: string
  category: string
  endTime: number
  onChainMarketId: string
  createTxHash: string
  onChainCreationFee?: number
  marketType?: string
  options?: { label: string; color?: string }[]
  resolutionType?: 'manual' | 'price_above' | 'price_below'
  oraclePair?: string
  targetPrice?: number
  resolutionRule?: string
  resolutionSourceUrl?: string
  resolutionTimeUtc?: number
}): Promise<any> {
  return request('/api/markets/create', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function createMultiMarket(data: {
  title: string
  description?: string
  category: string
  endTime: number
  onChainMarketId: string
  createTxHash: string
  onChainCreationFee?: number
  options: { label: string; color?: string }[]
}): Promise<any> {
  return createUserMarket({
    ...data,
    marketType: 'multi',
  })
}

export async function getMyCreatedMarkets(): Promise<any[]> {
  const data = await request<{ markets: any[] }>('/api/markets/user-created')
  return data.markets
}

export async function getMarketCreationStats(): Promise<{
  dailyCount: number
  maxPerDay: number
  totalCreated: number
  creationFee: number
  balance: number
}> {
  return request('/api/markets/creation-stats')
}

export async function flagMarket(marketId: string): Promise<{ flagCount: number; status: string }> {
  return request(`/api/markets/${marketId}/flag`, {
    method: 'POST',
  })
}

export async function fetchPendingMarkets(): Promise<Market[]> {
  const data = await request<{ markets: RawMarket[] }>('/api/markets?status=pending_approval')
  return (data.markets ?? []).map(normalizeMarket)
}

export async function approveMarket(marketId: string): Promise<{ success: boolean; message: string }> {
  return request(`/api/markets/${marketId}/approve`, {
    method: 'POST',
  })
}

export async function rejectMarket(marketId: string, reason: string): Promise<{ success: boolean; message: string }> {
  return request(`/api/markets/${marketId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

// --- Leaderboard API ---

export async function fetchLeaderboard(period: string = 'all') {
  const params = period !== 'all' ? `?period=${period}` : ''
  const data = await request<{ leaderboard: unknown[] }>(`/api/leaderboard${params}`)
  return data.leaderboard
}

// --- Comments API ---

export async function fetchComments(marketId: string) {
  const data = await request<{ comments?: unknown[] }>(`/api/comments/${marketId}`)
  return data.comments ?? []
}

export async function postComment(marketId: string, content: string, parentId?: string) {
  const data = await request<{ comment?: unknown }>(`/api/comments/${marketId}`, {
    method: 'POST',
    body: JSON.stringify(parentId ? { content, parentId } : { content }),
  })
  return data.comment
}

export async function toggleCommentLike(commentId: string) {
  const data = await request<{ comment?: unknown }>(`/api/comments/${commentId}/like`, {
    method: 'POST',
  })
  return data.comment
}

// === Portfolio / Wallet API ===

export async function fetchPortfolio(address: string) {
  const data = await request<{ positions?: any[]; totalValue?: number; pnl?: number }>(`/api/portfolio/${address}`)
  const positions = data.positions ?? []

  const computedTotalValue = positions.reduce((sum: number, p: any) => {
    return sum + (Number(p.current_value ?? p.currentValue) || 0)
  }, 0)
  const computedPnl = positions.reduce((sum: number, p: any) => {
    return sum + (Number(p.unrealized_pnl ?? p.unrealizedPnl) || 0)
  }, 0)

  return {
    positions,
    totalValue: Number(data.totalValue ?? computedTotalValue) || 0,
    pnl: Number(data.pnl ?? computedPnl) || 0,
  }
}

export async function fetchTradeHistory(address: string) {
  const data = await request<{ trades?: any[] }>(`/api/portfolio/${address}/history`)
  const trades = (data.trades ?? []).map((t: any) => ({
    ...t,
    id: t.id,
    type: t.type,
    amount: Number(t.amount) || 0,
    market: t.market ?? t.market_title ?? '',
    timestamp: t.timestamp
      ? String(t.timestamp)
      : new Date(Number(t.created_at) || Date.now()).toLocaleString(),
    status: t.status === 'pending' ? 'pending' : 'completed',
    txHash: t.txHash ?? t.tx_hash ?? '',
  }))
  return { trades }
}

export async function fetchBalance(address: string) {
  const data = await request<{ available: number; locked: number; total?: number; totalValue?: number }>(`/api/portfolio/${address}/balance`)
  return {
    available: Number(data.available) || 0,
    locked: Number(data.locked) || 0,
    total: Number(data.total ?? data.totalValue) || 0,
  }
}

export async function fetchUserStats(address: string) {
  const data = await request<{ stats?: any } | any>(`/api/portfolio/${address}/stats`)
  const raw = (data && typeof data === 'object' && 'stats' in data) ? data.stats : data
  return {
    totalTrades: Number(raw?.totalTrades) || 0,
    totalVolume: Number(raw?.totalVolume) || 0,
    totalBought: Number(raw?.totalBought) || 0,
    totalSold: Number(raw?.totalSold) || 0,
    activePositions: Number(raw?.activePositions) || 0,
    unrealizedPnl: Number(raw?.unrealizedPnl) || 0,
    portfolioValue: Number(raw?.portfolioValue) || 0,
    resolvedTrades: Number(raw?.resolvedTrades) || 0,
    winningTrades: Number(raw?.winningTrades) || 0,
    winRate: Number(raw?.winRate) || 0,
    totalProfit: Number(raw?.totalProfit) || 0,
    totalWins: Number(raw?.totalWins ?? raw?.winningTrades) || 0,
  }
}

// === Notification API ===

export interface AppNotification {
  id: string
  type: 'trade' | 'market' | 'system'
  title: string
  message: string
  timestamp: number
  read: boolean
}

interface RawNotification {
  id: string
  type: string
  title: string
  message: string
  created_at?: number | string
  timestamp?: number | string
  is_read?: boolean | number
  read?: boolean
}

function normalizeNotification(item: RawNotification): AppNotification {
  const ts = Number(item.timestamp ?? item.created_at) || Date.now()
  return {
    id: item.id,
    type: (item.type === 'trade' || item.type === 'market' || item.type === 'system') ? item.type : 'system',
    title: item.title,
    message: item.message,
    timestamp: ts,
    read: Boolean(item.read ?? item.is_read),
  }
}

export async function fetchNotifications() {
  const data = await request<{ notifications?: RawNotification[] }>('/api/notifications')
  const notifications = data.notifications ?? []
  return { notifications: notifications.map(normalizeNotification) }
}

export async function markNotificationRead(id: string) {
  return request<{ success: boolean }>(`/api/notifications/${id}/read`, { method: 'PUT' })
}

export async function markAllNotificationsRead() {
  return request<{ success: boolean }>('/api/notifications/read-all', { method: 'PUT' })
}

export async function fetchUnreadCount() {
  return request<{ count: number }>('/api/notifications/unread-count')
}

// === Search API ===

export async function searchMarkets(query: string) {
  const data = await request<{ markets: RawMarket[] }>(`/api/markets/search?q=${encodeURIComponent(query)}`)
  return { markets: (data.markets ?? []).map(normalizeMarket) }
}

// === Platform Stats API ===

export async function fetchPlatformStats() {
  return request<{
    totalMarkets: number
    activeMarkets: number
    totalVolume: number
    totalUsers: number
    todayNewMarkets: number
    todayTrades: number
  }>('/api/markets/stats')
}

// === Rewards API ===

export async function fetchRewards() {
  const data = await request<{ rewards?: any[] }>('/api/rewards')
  const rewards = (data.rewards ?? []).map((r: any) => ({
    ...r,
    title: r.title ?? (r.type === 'referral' ? 'Referral Reward' : 'Reward'),
    description: r.description ?? (r.type === 'referral' ? 'Invite reward pending claim' : 'Available reward'),
    status: r.status === 'pending' ? 'claimable' : r.status,
    createdAt: r.createdAt ?? r.created_at,
  }))
  return { rewards }
}

export async function claimReward(id: string) {
  const data = await request<{ success: boolean; amount?: number; reward?: { amount?: number } }>(`/api/rewards/claim/${id}`, { method: 'POST' })
  return {
    success: data.success,
    amount: Number(data.amount ?? data.reward?.amount) || 0,
  }
}

export async function getReferralCode() {
  const data = await request<{ code?: string; referralCode?: string; referrals?: number; earnings?: number }>('/api/rewards/referral-code')
  return {
    code: data.code ?? data.referralCode ?? '',
    referrals: Number(data.referrals) || 0,
    earnings: Number(data.earnings) || 0,
  }
}

// === Wallet Deposit / Withdraw API ===

export async function depositFunds(amount: number, txHash: string) {
  return request<{ success: boolean; balance: { available: number; locked: number; total: number } }>('/api/wallet/deposit', {
    method: 'POST',
    body: JSON.stringify({ amount, txHash }),
  })
}

export async function withdrawFunds(amount: number, toAddress: string, requestTxHash?: string) {
  return request<{ success: boolean; balance: { available: number; locked: number; total: number } }>('/api/wallet/withdraw', {
    method: 'POST',
    body: JSON.stringify({ amount, toAddress, ...(requestTxHash ? { txHash: requestTxHash } : {}) }),
  })
}

export async function fetchWalletTransactions(limit = 20, offset = 0) {
  return request<{ transactions: any[]; total: number }>(`/api/wallet/transactions?limit=${limit}&offset=${offset}`)
}

// === Achievements API ===

export interface AchievementData {
  id: string
  title: string
  titleZh: string
  description: string
  descriptionZh: string
  icon: string
  category: string
  requirement: number
  type: string
  progress: number
  unlocked: boolean
  unlockedAt: number | null
}

export async function fetchAchievements(address: string) {
  return request<{ achievements: AchievementData[] }>(`/api/achievements/${address}`)
}

export async function fetchAllAchievementDefs() {
  return request<{ achievements: AchievementData[] }>('/api/achievements')
}

// === Social API ===

export async function followUser(address: string) {
  return request<{ success: boolean }>('/api/social/follow', {
    method: 'POST',
    body: JSON.stringify({ followedAddress: address }),
  })
}

export async function unfollowUser(address: string) {
  return request<{ success: boolean }>('/api/social/unfollow', {
    method: 'DELETE',
    body: JSON.stringify({ followedAddress: address }),
  })
}

export async function getFollowing(address: string) {
  return request<{ following: { address: string; display_name: string | null }[] }>(`/api/social/following/${address}`)
}

export async function getFollowers(address: string) {
  return request<{ followers: { address: string; display_name: string | null }[] }>(`/api/social/followers/${address}`)
}

export async function getTradingFeed(before?: number) {
  const params = before ? `?before=${before}` : ''
  return request<{ feed: any[] }>(`/api/social/feed${params}`)
}

export async function getPublicProfile(address: string) {
  return request<{ profile: any }>(`/api/profile/${address}`)
}

export async function updateProfile(data: { displayName?: string; bio?: string; avatarUrl?: string }) {
  return request<{ profile: any }>('/api/profile', {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

// === Copy Trading API ===

export async function startCopyTrading(data: {
  agentId: string
  copyPercentage: number
  maxPerTrade: number
  dailyLimit: number
  onChain?: boolean
}) {
  return request<{ follower: any }>('/api/copy-trading/start', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function stopCopyTrading(agentId: string) {
  return request<{ follower: any }>('/api/copy-trading/stop', {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  })
}

export async function updateCopySettings(data: {
  agentId: string
  copyPercentage?: number
  maxPerTrade?: number
  dailyLimit?: number
  onChain?: boolean
}) {
  return request<{ follower: any }>('/api/copy-trading/settings', {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function getCopyStatus(agentId: string) {
  return request<{ follower: any }>(`/api/copy-trading/status/${agentId}`)
}

export async function getCopyTrades(limit?: number, offset?: number) {
  const params = new URLSearchParams()
  if (limit) params.set('limit', String(limit))
  if (offset) params.set('offset', String(offset))
  const qs = params.toString()
  return request<{ trades: any[]; total: number }>(`/api/copy-trading/trades${qs ? `?${qs}` : ''}`)
}

export async function getAgentEarnings(agentId: string) {
  return request<{ earnings: any[]; totalEarnings: number; unclaimed: number }>(
    `/api/copy-trading/earnings/${agentId}`
  )
}

export async function getPendingOnChainTrades() {
  return request<{ trades: any[] }>('/api/copy-trading/pending-on-chain')
}

export async function confirmOnChainTrade(tradeId: string, txHash: string) {
  return request<{ success: boolean; trade: any }>('/api/copy-trading/confirm-on-chain', {
    method: 'POST',
    body: JSON.stringify({ tradeId, txHash }),
  })
}

export async function claimEarnings(agentId: string) {
  return request<{ success: boolean; amount: number }>('/api/copy-trading/claim', {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  })
}

export async function setComboStrategy(agentId: string, weights: Record<string, number>) {
  return request<{ success: boolean; weights: Record<string, number> }>(
    '/api/copy-trading/combo-strategy',
    {
      method: 'PUT',
      body: JSON.stringify({ agentId, weights }),
    }
  )
}

// === NFA Agent LLM Config API ===

export interface AgentLlmConfig {
  provider: string
  model: string
  apiKeyMasked: string
  baseUrl: string | null
  systemPrompt: string | null
  temperature: number
  maxTokens: number
  enabled: number
  lastUsedAt: number | null
  totalCalls: number
  totalErrors: number
  createdAt: number
  updatedAt: number
}

export async function getAgentLlmConfig(agentId: string): Promise<AgentLlmConfig | null> {
  const data = await request<{ config: AgentLlmConfig | null }>(`/api/agents/${agentId}/llm-config`)
  return data.config
}

export async function setAgentLlmConfig(agentId: string, data: {
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
}): Promise<{ success: boolean }> {
  return request(`/api/agents/${agentId}/llm-config`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function deleteAgentLlmConfig(agentId: string): Promise<{ success: boolean }> {
  return request(`/api/agents/${agentId}/llm-config`, {
    method: 'DELETE',
  })
}

export async function toggleAgentLlm(agentId: string, enabled: boolean): Promise<{ success: boolean; enabled: number }> {
  return request(`/api/agents/${agentId}/llm-config/toggle`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  })
}

// === Testnet Faucet ===

export async function claimPlatformFaucet(address: string, amount: number = 10000): Promise<{ success: boolean; balance: { available: number; locked: number } }> {
  return request('/api/faucet', {
    method: 'POST',
    body: JSON.stringify({ address, amount }),
  })
}
