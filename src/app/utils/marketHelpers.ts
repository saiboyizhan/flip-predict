import type { MarketCategory, CategoryConfig } from '@/app/types/market.types'

const CATEGORIES: CategoryConfig[] = [
  { id: 'four-meme', name: 'Four.meme', emoji: '', description: '四meme主战场', color: 'purple' },
  { id: 'meme-arena', name: 'Meme竞技场', emoji: '', description: 'Meme币生死局', color: 'orange' },
  { id: 'narrative', name: '叙事风暴', emoji: '', description: '热门叙事预测', color: 'blue' },
  { id: 'kol', name: 'KOL开盘', emoji: '', description: 'KOL喊单预测', color: 'pink' },
  { id: 'on-chain', name: '链上追踪', emoji: '', description: '链上数据预测', color: 'cyan' },
  { id: 'rug-alert', name: 'Rug预警', emoji: '', description: '项目跑路预测', color: 'red' },
  { id: 'btc-weather', name: '大饼天气', emoji: '', description: 'BTC行情预测', color: 'amber' },
  { id: 'fun', name: '整活现场', emoji: '', description: '娱乐整活预测', color: 'emerald' },
  { id: 'daily', name: '每日对决', emoji: '', description: '每日链上热门币对决', color: 'indigo' },
]

export function formatVolume(volume: number): string {
  if (volume >= 1_000_000) {
    return `¥${(volume / 1_000_000).toFixed(1)}M`
  }
  if (volume >= 1_000) {
    return `¥${(volume / 1_000).toFixed(1)}K`
  }
  return `¥${volume.toFixed(0)}`
}

export function formatPrice(price: number): string {
  return `${Math.round(price * 100)}%`
}

export function formatPriceUsd(price: number): string {
  return `¥${price.toFixed(2)}`
}

export function calculateReturn(price: number, amount: number): number {
  return (1 / price - 1) * amount
}

export function getTimeRemaining(endTime: string): string {
  const now = new Date().getTime()
  const end = new Date(endTime).getTime()
  const diff = end - now

  if (diff <= 0) return '已结束'

  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (days > 0) return `${days}天${hours}小时`
  if (hours > 0) return `${hours}小时${minutes}分钟`
  return `${minutes}分钟`
}

export function getCategoryConfig(category: MarketCategory): CategoryConfig {
  return CATEGORIES.find(c => c.id === category) ?? CATEGORIES[0]
}

export function getAllCategories(): CategoryConfig[] {
  return CATEGORIES
}
