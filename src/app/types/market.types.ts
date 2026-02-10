// 市场分类
export type MarketCategory =
  | 'four-meme'      // Four.meme 主战场
  | 'meme-arena'     // Meme竞技场
  | 'narrative'      // 叙事风暴
  | 'kol'            // KOL开盘
  | 'on-chain'       // 链上追踪
  | 'rug-alert'      // Rug预警
  | 'btc-weather'    // 大饼天气
  | 'fun'            // 整活现场
  | 'daily'          // 每日对决

export type MarketStatus = 'active' | 'pending' | 'closed' | 'resolved' | 'disputed'

export interface Market {
  id: string
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
}

export interface Position {
  id: string
  marketId: string
  marketTitle: string
  side: 'yes' | 'no'
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
  emoji: string
  description: string
  color: string // tailwind color
}
