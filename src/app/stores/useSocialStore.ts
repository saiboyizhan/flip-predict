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
  feedError: boolean

  loadFollowing: (addr: string) => Promise<void>
  follow: (addr: string) => Promise<void>
  unfollow: (addr: string) => Promise<void>
  loadFeed: (before?: number) => Promise<void>
  addFeedItem: (item: any) => void
  reset: () => void
}

export const useSocialStore = create<SocialState>((set, get) => ({
  following: new Set<string>(),
  followersCount: {},
  feedItems: [],
  feedLoading: false,
  feedError: false,

  loadFollowing: async (addr: string) => {
    try {
      const data = await getFollowing(addr)
      const addresses = (data.following ?? []).map((f) => f.address.toLowerCase())
      set({ following: new Set(addresses) })
    } catch (err) {
      console.warn('[Social] Failed to load following:', err instanceof Error ? err.message : err)
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
    } catch (err) {
      console.warn('[Social] Failed to follow user:', err instanceof Error ? err.message : err)
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
    } catch (err) {
      console.warn('[Social] Failed to unfollow user:', err instanceof Error ? err.message : err)
    }
  },

  loadFeed: async (before?: number) => {
    set({ feedLoading: true, feedError: false })
    try {
      const data = await getTradingFeed(before)
      const items = data.feed ?? []
      if (before) {
        set((state) => {
          const existing = state.feedItems
          const newItems = items.filter((item: any) => !existing.some((e: any) => e.id === item.id))
          const allItems = [...existing, ...newItems];
          // Keep max 50 items
          const limited = allItems.slice(0, 50);
          return { feedItems: limited, feedLoading: false, feedError: false }
        })
      } else {
        // Keep max 50 items
        const limited = items.slice(0, 50);
        set({ feedItems: limited, feedLoading: false, feedError: false })
      }
    } catch (err) {
      console.warn('[Social] Failed to load feed:', err instanceof Error ? err.message : err)
      set({ feedLoading: false, feedError: true })
    }
  },

  addFeedItem: (item: any) => {
    set((state) => {
      const newItems = [item, ...state.feedItems];
      // Keep max 50 items
      const limited = newItems.slice(0, 50);
      return { feedItems: limited };
    })
  },

  reset: () => set({ following: new Set(), feedItems: [], feedLoading: false, feedError: false }),
}))
