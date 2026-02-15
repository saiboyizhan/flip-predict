import { create } from 'zustand'
import {
  followUser,
  unfollowUser,
  getFollowing,
  getTradingFeed,
} from '@/app/services/api'

interface SocialState {
  following: Set<string>
  followersCount: Record<string, number>
  feedItems: any[]
  feedLoading: boolean

  loadFollowing: (addr: string) => Promise<void>
  follow: (addr: string) => Promise<void>
  unfollow: (addr: string) => Promise<void>
  loadFeed: (before?: number) => Promise<void>
  addFeedItem: (item: any) => void
}

export const useSocialStore = create<SocialState>((set, get) => ({
  following: new Set<string>(),
  followersCount: {},
  feedItems: [],
  feedLoading: false,

  loadFollowing: async (addr: string) => {
    try {
      const data = await getFollowing(addr)
      const addresses = (data.following ?? []).map((f) => f.address.toLowerCase())
      set({ following: new Set(addresses) })
    } catch {
      // silently fail
    }
  },

  follow: async (addr: string) => {
    const normalized = addr.toLowerCase()
    try {
      await followUser(normalized)
      set((state) => {
        const next = new Set(state.following)
        next.add(normalized)
        return { following: next }
      })
    } catch {
      // silently fail
    }
  },

  unfollow: async (addr: string) => {
    const normalized = addr.toLowerCase()
    try {
      await unfollowUser(normalized)
      set((state) => {
        const next = new Set(state.following)
        next.delete(normalized)
        return { following: next }
      })
    } catch {
      // silently fail
    }
  },

  loadFeed: async (before?: number) => {
    set({ feedLoading: true })
    try {
      const data = await getTradingFeed(before)
      const items = data.feed ?? []
      if (before) {
        set((state) => ({ feedItems: [...state.feedItems, ...items], feedLoading: false }))
      } else {
        set({ feedItems: items, feedLoading: false })
      }
    } catch {
      set({ feedLoading: false })
    }
  },

  addFeedItem: (item: any) => {
    set((state) => ({ feedItems: [item, ...state.feedItems] }))
  },
}))
