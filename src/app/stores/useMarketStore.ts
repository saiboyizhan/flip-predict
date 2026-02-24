import { create } from 'zustand'
import type { Market, MarketCategory } from '@/app/types/market.types'
import { fetchMarkets } from '@/app/services/api'

// In-flight request tracking to prevent duplicate API calls
let fetchPromise: Promise<void> | null = null;

type SortBy = 'volume' | 'newest' | 'ending-soon' | 'popular'
export type TimeWindow = 'all' | 'today' | 'week' | 'month' | 'quarter'

interface MarketState {
  markets: Market[]
  filteredMarkets: Market[]
  selectedCategory: MarketCategory | 'all'
  searchQuery: string
  sortBy: SortBy
  timeWindow: TimeWindow
  apiMode: boolean
  error: boolean
  loading: boolean

  setCategory: (category: MarketCategory | 'all') => void
  setSearch: (query: string) => void
  setSortBy: (sortBy: SortBy) => void
  setTimeWindow: (tw: TimeWindow) => void
  getMarketById: (id: string) => Market | undefined
  updateMarketPrices: (id: string, yesPrice: number, noPrice: number, volume: number) => void
  updateMultiOptionPrices: (id: string, prices: { optionId: string; price: number }[]) => void
  fetchFromAPI: () => Promise<void>
}

function getTimeWindowEnd(tw: TimeWindow): number | null {
  if (tw === 'all') return null
  const now = Date.now()
  switch (tw) {
    case 'today':
      return now + 24 * 3600000
    case 'week':
      return now + 7 * 24 * 3600000
    case 'month':
      return now + 30 * 24 * 3600000
    case 'quarter':
      return now + 90 * 24 * 3600000
  }
}

function applyFilters(
  markets: Market[],
  category: MarketCategory | 'all',
  searchQuery: string,
  sortBy: SortBy,
  timeWindow: TimeWindow,
): Market[] {
  let result = [...markets]

  // Filter by category
  if (category !== 'all') {
    result = result.filter(m => m.category === category)
  }

  // Filter by time window (endTime falls within the window)
  const windowEnd = getTimeWindowEnd(timeWindow)
  if (windowEnd !== null) {
    const now = Date.now()
    result = result.filter(m => {
      const end = new Date(m.endTime).getTime()
      return end >= now && end <= windowEnd
    })
  }

  // Filter by search query
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase()
    result = result.filter(
      m =>
        m.title.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.tags.some(t => t.toLowerCase().includes(q)),
    )
  }

  // Sort
  switch (sortBy) {
    case 'volume':
      result.sort((a, b) => b.volume - a.volume)
      break
    case 'newest':
      result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      break
    case 'ending-soon':
      result.sort((a, b) => new Date(a.endTime).getTime() - new Date(b.endTime).getTime())
      break
    case 'popular':
      result.sort((a, b) => b.participants - a.participants)
      break
  }

  return result
}

export const useMarketStore = create<MarketState>((set, get) => ({
  markets: [],
  filteredMarkets: [],
  selectedCategory: 'all',
  searchQuery: '',
  sortBy: 'volume',
  timeWindow: 'all',
  apiMode: false,
  error: false,
  loading: false,

  setCategory: (category) => {
    const { markets, searchQuery, sortBy, timeWindow } = get()
    set({
      selectedCategory: category,
      filteredMarkets: applyFilters(markets, category, searchQuery, sortBy, timeWindow),
    })
  },

  setSearch: (query) => {
    const { markets, selectedCategory, sortBy, timeWindow } = get()
    set({
      searchQuery: query,
      filteredMarkets: applyFilters(markets, selectedCategory, query, sortBy, timeWindow),
    })
  },

  setSortBy: (sortBy) => {
    const { markets, selectedCategory, searchQuery, timeWindow } = get()
    set({
      sortBy,
      filteredMarkets: applyFilters(markets, selectedCategory, searchQuery, sortBy, timeWindow),
    })
  },

  setTimeWindow: (timeWindow) => {
    const { markets, selectedCategory, searchQuery, sortBy } = get()
    set({
      timeWindow,
      filteredMarkets: applyFilters(markets, selectedCategory, searchQuery, sortBy, timeWindow),
    })
  },

  getMarketById: (id) => {
    return get().markets.find(m => m.id === id)
  },

  updateMarketPrices: (id, yesPrice, noPrice, volume) => {
    // P0-3 fix: Use atomic setState to prevent race conditions
    set((state) => {
      const updated = state.markets.map(m =>
        m.id === id ? { ...m, yesPrice, noPrice, volume } : m,
      )
      return {
        markets: updated,
        filteredMarkets: applyFilters(updated, state.selectedCategory, state.searchQuery, state.sortBy, state.timeWindow),
      }
    })
  },

  updateMultiOptionPrices: (id, prices) => {
    // P0-3 fix: Use atomic setState to prevent race conditions
    set((state) => {
      const updated = state.markets.map(m => {
        if (m.id !== id || !m.options) return m
        const updatedOptions = m.options.map(opt => {
          const priceUpdate = prices.find(p => p.optionId === opt.id)
          return priceUpdate ? { ...opt, price: priceUpdate.price } : opt
        })
        return { ...m, options: updatedOptions }
      })
      return {
        markets: updated,
        filteredMarkets: applyFilters(updated, state.selectedCategory, state.searchQuery, state.sortBy, state.timeWindow),
      }
    })
  },

  fetchFromAPI: async () => {
    if (fetchPromise) return fetchPromise;
    fetchPromise = (async () => {
      set({ loading: true })
      try {
        const apiMarkets = await fetchMarkets()
        const { selectedCategory, searchQuery, sortBy, timeWindow } = get()
        set({
          markets: apiMarkets,
          filteredMarkets: applyFilters(apiMarkets, selectedCategory, searchQuery, sortBy, timeWindow),
          apiMode: true,
          error: false,
          loading: false,
        })
      } catch (err) {
        console.error('Failed to fetch markets:', err)
        // API failed — keep current data and expose error state
        const { markets, selectedCategory, searchQuery, sortBy, timeWindow } = get()
        set({
          markets,
          filteredMarkets: applyFilters(markets, selectedCategory, searchQuery, sortBy, timeWindow),
          apiMode: false,
          error: true,
          loading: false,
        })
      }
    })().finally(() => { fetchPromise = null; });
    return fetchPromise;
  },
}))
