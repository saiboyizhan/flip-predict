import { getUserLevelByNumber } from '@/app/stores/useUserStore'

const SIZE_CLASSES = {
  sm: 'text-xs px-1.5 py-0.5 gap-1',
  md: 'text-sm px-2 py-1 gap-1.5',
  lg: 'text-base px-3 py-1.5 gap-2',
} as const

const LEVEL_COLORS: Record<number, string> = {
  1: 'bg-muted text-muted-foreground border-border',
  2: 'bg-emerald-950/50 text-emerald-400 border-emerald-800/60',
  3: 'bg-purple-950/50 text-purple-400 border-purple-800/60',
  4: 'bg-blue-950/50 text-blue-400 border-blue-700/60',
  5: 'bg-sky-950/50 text-sky-300 border-sky-600/60',
}

export function LevelBadge({
  level,
  size = 'md',
}: {
  level: number
  size?: 'sm' | 'md' | 'lg'
}) {
  const userLevel = getUserLevelByNumber(level)
  const colorClass = LEVEL_COLORS[level] ?? LEVEL_COLORS[1]

  return (
    <span
      className={`inline-flex items-center font-semibold border whitespace-nowrap ${SIZE_CLASSES[size]} ${colorClass}`}
    >
      <span>{userLevel.icon}</span>
      <span>Lv{userLevel.level} {userLevel.name}</span>
    </span>
  )
}
