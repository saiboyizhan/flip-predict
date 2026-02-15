import { motion } from 'motion/react'
import { Lock, Loader2 } from 'lucide-react'
import { useAccount } from 'wagmi'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchAchievements } from '@/app/services/api'
import type { AchievementData } from '@/app/services/api'
import { useUserStore } from '@/app/stores/useUserStore'
import type { Achievement } from '@/app/stores/useUserStore'

function AchievementCard({ achievement, isBackendData }: { achievement: AchievementData | Achievement; isBackendData: boolean }) {
  const { i18n } = useTranslation()
  const isZh = i18n.language === 'zh'
  const unlocked = achievement.unlocked

  // Type guard helpers
  const backendAchievement = isBackendData ? (achievement as AchievementData) : null
  const name = backendAchievement
    ? (isZh ? backendAchievement.titleZh : backendAchievement.title)
    : (achievement as Achievement).name
  const description = backendAchievement
    ? (isZh ? backendAchievement.descriptionZh : backendAchievement.description)
    : (achievement as Achievement).description
  const icon = achievement.icon
  const unlockedAt = backendAchievement ? backendAchievement.unlockedAt : (achievement as Achievement).unlockedAt

  // Progress bar for backend data
  const progress = backendAchievement ? backendAchievement.progress : 0
  const requirement = backendAchievement ? backendAchievement.requirement : 0
  const progressPercent = requirement > 0 ? Math.min((progress / requirement) * 100, 100) : 0
  const showProgress = isBackendData && !unlocked && requirement > 0

  return (
    <div
      className={`relative p-4 border text-center transition-colors ${
        unlocked
          ? 'bg-card border-border hover:border-border'
          : 'bg-secondary/50 border-border/50 opacity-60'
      }`}
    >
      {/* Unlocked badge */}
      {unlocked && (
        <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-400" />
      )}

      {/* Icon */}
      <div className="text-3xl mb-2">
        {unlocked ? (
          icon
        ) : (
          <Lock className="w-7 h-7 text-muted-foreground mx-auto" />
        )}
      </div>

      {/* Name */}
      <div
        className={`text-sm font-semibold mb-1 ${
          unlocked ? 'text-foreground' : 'text-muted-foreground'
        }`}
      >
        {name}
      </div>

      {/* Description */}
      <div className="text-xs text-muted-foreground mb-2 line-clamp-2">
        {description}
      </div>

      {/* Progress bar */}
      {showProgress && (
        <div className="mt-2">
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500/70 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {progress}/{requirement}
          </div>
        </div>
      )}

      {/* Unlock time */}
      {unlocked && unlockedAt && (
        <div className="text-[10px] text-muted-foreground">
          {new Date(unlockedAt).toLocaleDateString(isZh ? 'zh-CN' : 'en-US')}
        </div>
      )}
    </div>
  )
}

export function AchievementGrid() {
  const { address, isConnected } = useAccount()
  const { t } = useTranslation()
  const [backendAchievements, setBackendAchievements] = useState<AchievementData[] | null>(null)
  const [loading, setLoading] = useState(false)

  // Fallback to store achievements
  const storeAchievements = useUserStore((s) => s.achievements)

  useEffect(() => {
    if (!isConnected || !address) {
      setBackendAchievements(null)
      return
    }

    let cancelled = false
    setLoading(true)

    fetchAchievements(address)
      .then((data) => {
        if (!cancelled) {
          setBackendAchievements(data.achievements)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBackendAchievements(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [address, isConnected])

  const isBackendData = backendAchievements !== null
  const achievements = isBackendData ? backendAchievements : storeAchievements
  const unlockedCount = achievements.filter((a) => a.unlocked).length

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-foreground">{t('profile.achievements')}</h2>
        <span className="text-sm text-muted-foreground">
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin inline" />
          ) : (
            t('profile.achievementsUnlocked', { count: unlockedCount, total: achievements.length })
          )}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {achievements.map((achievement, index) => (
          <motion.div
            key={achievement.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.05 }}
          >
            <AchievementCard achievement={achievement} isBackendData={isBackendData} />
          </motion.div>
        ))}
      </div>
    </div>
  )
}
