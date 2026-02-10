import type { Market } from '@/app/types/market.types'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

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

// --- Generic request helper ---
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const currentToken = getToken()
  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options?.headers as Record<string, string>),
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API ${res.status}: ${body}`)
  }

  return res.json() as Promise<T>
}

// --- API methods ---

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
  return request<Market[]>(`/api/markets${qs ? `?${qs}` : ''}`)
}

export async function fetchMarket(id: string): Promise<Market> {
  return request<Market>(`/api/markets/${id}`)
}

export async function createOrder(data: {
  marketId: string
  side: string
  amount: number
}): Promise<{
  orderId: string
  shares: number
  price: number
  newYesPrice: number
  newNoPrice: number
}> {
  return request('/api/orders', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function sellOrder(data: {
  marketId: string
  side: string
  shares: number
}): Promise<{
  orderId: string
  amountOut: number
  price: number
  newYesPrice: number
  newNoPrice: number
}> {
  return request('/api/orders/sell', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function getPositions(): Promise<unknown[]> {
  return request('/api/positions')
}

export async function getBalances(): Promise<{
  available: number
  locked: number
}> {
  return request('/api/balances')
}

export async function getNonce(
  address: string,
): Promise<{ nonce: string }> {
  return request(`/api/auth/nonce/${address}`)
}

export async function verifySignature(
  address: string,
  signature: string,
): Promise<{ token: string }> {
  return request('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ address, signature }),
  })
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
  return request('/api/orderbook/limit', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function placeMarketOrder(data: {
  marketId: string
  side: string
  orderSide: string
  amount: number
}): Promise<{ orderId: string }> {
  return request('/api/orderbook/market', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function cancelOrder(orderId: string): Promise<{ success: boolean }> {
  return request(`/api/orderbook/${orderId}`, {
    method: 'DELETE',
  })
}

export async function getOpenOrders(): Promise<OpenOrder[]> {
  return request<OpenOrder[]>('/api/orderbook/open')
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
  }
  logs: unknown[]
}> {
  return request(`/api/settlement/${marketId}`)
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
  return request('/api/settlement/resolved')
}

export async function adminResolve(
  marketId: string,
  outcome: string,
): Promise<{ success: boolean }> {
  return request(`/api/settlement/${marketId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ outcome }),
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
  created_at: string
  last_trade_at: string | null
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

export async function mintAgent(data: { name: string; strategy: string; description: string; persona?: string; avatar?: string | null }): Promise<Agent> {
  const res = await request<{ agent: Agent }>('/api/agents/mint', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return res.agent
}

export async function getMyAgents(): Promise<Agent[]> {
  const data = await request<{ agents: Agent[] }>('/api/agents/my')
  return data.agents
}

export async function updateAgent(id: string, data: { strategy?: string; description?: string }): Promise<Agent> {
  return request<Agent>(`/api/agents/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
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

export async function buyAgent(id: string): Promise<{ success: boolean }> {
  return request(`/api/agents/${id}/buy`, {
    method: 'POST',
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
  return request(`/api/agents/${agentId}`)
}

// --- Learning ---

export async function getAgentLearningMetrics(agentId: string): Promise<any> {
  const data = await request<{ metrics: any }>(`/api/agents/${agentId}/learning-metrics`)
  return data.metrics
}

// ============================================
// User Market Creation API
// ============================================

export async function createUserMarket(data: {
  title: string
  description?: string
  category: string
  endTime: number
}): Promise<any> {
  return request('/api/markets/create', {
    method: 'POST',
    body: JSON.stringify(data),
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

// --- Leaderboard API ---

export async function fetchLeaderboard() {
  const res = await fetch(`${API_BASE}/api/leaderboard`)
  if (!res.ok) throw new Error('Failed to fetch leaderboard')
  return res.json()
}

// --- Comments API ---

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const currentToken = getToken()
  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`
  }
  return headers
}

export async function fetchComments(marketId: string) {
  const res = await fetch(`${API_BASE}/api/comments/${marketId}`)
  if (!res.ok) throw new Error('Failed to fetch comments')
  return res.json()
}

export async function postComment(marketId: string, content: string) {
  const res = await fetch(`${API_BASE}/api/comments/${marketId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error('Failed to post comment')
  return res.json()
}

export async function toggleCommentLike(commentId: string) {
  const res = await fetch(`${API_BASE}/api/comments/${commentId}/like`, {
    method: 'POST',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error('Failed to like comment')
  return res.json()
}

// === Portfolio / Wallet API ===

export async function fetchPortfolio(address: string) {
  return request<{ positions: any[]; totalValue: number; pnl: number }>(`/api/portfolio/${address}`)
}

export async function fetchTradeHistory(address: string) {
  return request<{ trades: any[] }>(`/api/portfolio/${address}/history`)
}

export async function fetchBalance(address: string) {
  return request<{ available: number; locked: number; total: number }>(`/api/portfolio/${address}/balance`)
}

export async function fetchUserStats(address: string) {
  return request<{ totalTrades: number; winRate: number; totalProfit: number; totalWins: number }>(`/api/portfolio/${address}/stats`)
}

// === Notification API ===

export async function fetchNotifications() {
  return request<{ notifications: Notification[] }>('/api/notifications')
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
  return request<{ markets: Market[] }>(`/api/markets/search?q=${encodeURIComponent(query)}`)
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
  return request<{ rewards: any[] }>('/api/rewards')
}

export async function claimReward(id: string) {
  return request<{ success: boolean; amount: number }>(`/api/rewards/claim/${id}`, { method: 'POST' })
}

export async function getReferralCode() {
  return request<{ code: string; referrals: number; earnings: number }>('/api/rewards/referral-code')
}

// === Wallet Deposit / Withdraw API ===

export async function depositFunds(amount: number, txHash: string) {
  return request<{ success: boolean; balance: { available: number; locked: number; total: number } }>('/api/wallet/deposit', {
    method: 'POST',
    body: JSON.stringify({ amount, txHash }),
  })
}

export async function withdrawFunds(amount: number, toAddress: string) {
  return request<{ success: boolean; balance: { available: number; locked: number; total: number } }>('/api/wallet/withdraw', {
    method: 'POST',
    body: JSON.stringify({ amount, toAddress }),
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
