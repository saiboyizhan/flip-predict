export interface PresetAvatar {
  id: number
  label: string
  src: string
}

export const PRESET_AVATARS: PresetAvatar[] = Array.from({ length: 12 }, (_, i) => ({
  id: i,
  label: `Avatar ${i + 1}`,
  src: `/avatars/avatar_${i}.svg`,
}))

export const MAX_AGENTS_PER_ADDRESS = 3
