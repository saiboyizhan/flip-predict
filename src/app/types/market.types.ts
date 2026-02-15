// 市场分类
export type MarketCategory =
  | 'four-meme'      // Four.meme Meme 币预测
  | 'flap'           // Flap.sh 发射台预测
  | 'nfa'            // NFA Agent 生态预测
  | 'hackathon'      // 黑客松 & 社区活动

export type MarketStatus = 'active' | 'pending' | 'pending_resolution' | 'closed' | 'resolved' | 'disputed'

export type MarketType = 'binary' | 'multi'

export interface MarketOption {
  id: string
  optionIndex: number
  label: string
  color: string
  price: number
  reserve: number
}

export interface Market {
  id: string
  onChainMarketId?: string
  title: string
  description: string
  category: MarketCategory
  status: MarketStatus
  yesPrice: number      // 0.01 - 0.99
  noPrice: number       // 自动计算 1 - yesPrice
  volume: number        // 交易量 (USDT)
  totalShares: number
  participants: number
  createdAt: string
  endTime: string
  resolvedAt?: string
  resolvedOutcome?: 'YES' | 'NO'
  imageUrl?: string
  tags: string[]
  featured: boolean
  resolutionSource: string
  marketType?: MarketType
  options?: MarketOption[]
  totalLiquidity?: number
}

export interface Position {
  id: string
  marketId: string
  marketTitle: string
  side: 'yes' | 'no' | (string & {})  // supports 'yes', 'no', and 'option_X' for multi-option markets
  shares: number
  avgCost: number
  currentPrice: number
  timestamp: number
}

export interface Order {
  id: string
  marketId: string
  side: 'BUY' | 'SELL'
  outcome: 'YES' | 'NO'
  type: 'MARKET' | 'LIMIT'
  price: number
  size: number
  filledSize: number
  status: 'open' | 'filled' | 'cancelled'
  createdAt: string
  txHash?: string
}

export interface UserProfile {
  address: string
  displayName: string
  avatar?: string
  balance: number
  totalTrades: number
  totalPnL: number
  winRate: number
  rank: number
  tier: 'newbie' | 'experienced' | 'expert' | 'hunter' | 'legend'
}

// 分类配置
export interface CategoryConfig {
  id: MarketCategory
  name: string
  emoji?: string
  description: string
  color: string // tailwind color
}
