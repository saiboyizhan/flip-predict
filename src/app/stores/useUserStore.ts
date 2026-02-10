import { create } from 'zustand'

export interface UserLevel {
  level: number
  name: string
  icon: string
  minVolume: number
  benefits: string[]
}

export interface Achievement {
  id: string
  name: string
  icon: string
  description: string
  unlocked: boolean
  unlockedAt?: number
}

const USER_LEVELS: UserLevel[] = [
  { level: 1, name: '韭菜', icon: '🌱', minVolume: 0, benefits: ['基础功能'] },
  { level: 2, name: '老韭菜', icon: '🌿', minVolume: 1_000, benefits: ['基础功能', '评论置顶'] },
  { level: 3, name: '预测师', icon: '🔮', minVolume: 10_000, benefits: ['基础功能', '评论置顶', '创建市场提案'] },
  { level: 4, name: '链上OG', icon: '👑', minVolume: 50_000, benefits: ['基础功能', '评论置顶', '创建市场提案', '手续费折扣'] },
  { level: 5, name: '预言家', icon: '⚡', minVolume: 200_000, benefits: ['基础功能', '评论置顶', '创建市场提案', '手续费折扣', 'VIP标识'] },
]

const DEFAULT_ACHIEVEMENTS: Achievement[] = [
  { id: 'first_prediction', name: '初次预测', icon: '🎯', description: '完成第一次预测', unlocked: true, unlockedAt: 1706140800000 },
  { id: 'winning_streak_5', name: '五连胜', icon: '🔥', description: '连续赢得5次预测', unlocked: true, unlockedAt: 1707350400000 },
  { id: 'perfect_accuracy', name: '百发百中', icon: '💎', description: '连续10次预测全部正确', unlocked: false },
  { id: 'degen_master', name: 'Degen大师', icon: '🃏', description: '单次下注超过 $10,000', unlocked: true, unlockedAt: 1708560000000 },
  { id: 'social_butterfly', name: '社交达人', icon: '🦋', description: '发表50条评论', unlocked: false },
  { id: 'diamond_hands', name: '钻石手', icon: '💠', description: '持仓超过30天不卖出', unlocked: true, unlockedAt: 1709769600000 },
  { id: 'early_bird', name: '早期玩家', icon: '🐦', description: '在平台上线首月内注册', unlocked: true, unlockedAt: 1706140800000 },
  { id: 'market_maker', name: '做市专家', icon: '🏦', description: '在5个不同市场中持有头寸', unlocked: false },
  { id: 'whale', name: '巨鲸', icon: '🐋', description: '累计交易额超过 $100,000', unlocked: false },
  { id: 'prophet', name: '先知', icon: '🔮', description: '连续预测准确率超过80%维持一个月', unlocked: false },
]

interface UserState {
  totalVolume: number
  achievements: Achievement[]
  getUserLevel: () => UserLevel
  unlockAchievement: (achievementId: string) => void
}

export function getUserLevel(totalVolume: number): UserLevel {
  for (let i = USER_LEVELS.length - 1; i >= 0; i--) {
    if (totalVolume >= USER_LEVELS[i].minVolume) {
      return USER_LEVELS[i]
    }
  }
  return USER_LEVELS[0]
}

export function getUserLevelByNumber(level: number): UserLevel {
  return USER_LEVELS[level - 1] ?? USER_LEVELS[0]
}

/** Given a totalWagered value, return the level number (1-5) */
export function getLevelFromVolume(totalVolume: number): number {
  return getUserLevel(totalVolume).level
}

export const USER_LEVELS_LIST = USER_LEVELS

export const useUserStore = create<UserState>((set, get) => ({
  totalVolume: 38_720,
  achievements: DEFAULT_ACHIEVEMENTS,

  getUserLevel: () => getUserLevel(get().totalVolume),

  unlockAchievement: (achievementId: string) => {
    set({
      achievements: get().achievements.map((a) =>
        a.id === achievementId && !a.unlocked
          ? { ...a, unlocked: true, unlockedAt: Date.now() }
          : a,
      ),
    })
  },
}))
