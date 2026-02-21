import type { CategoryConfig } from '@/app/types/market.types'

export const CATEGORIES: CategoryConfig[] = [
  { id: 'flap', name: 'Flap', emoji: '', description: '发射台预测 -- Flap.sh Bonding Curve 与代币毕业', color: 'emerald' },
  { id: 'four-meme', name: 'Four.meme', emoji: '', description: 'Meme 币预测 -- Four.meme 平台热门代币趋势', color: 'amber' },
  { id: 'nfa', name: 'NFA', emoji: '', description: 'Agent 生态 -- NFA Agent 性能、协同与链上指标', color: 'blue' },
  { id: 'other', name: 'Other', emoji: '', description: '其他预测 -- 不属于以上分类的预测市场', color: 'slate' },
]
