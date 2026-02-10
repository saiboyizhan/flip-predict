import { create } from 'zustand'
import type { Market, MarketCategory } from '@/app/types/market.types'
import { MOCK_MARKETS } from '@/app/data/markets'
import { fetchMarkets } from '@/app/services/api'

type SortBy = 'volume' | 'newest' | 'ending-soon' | 'popular'

interface MarketState {
  markets: Market[]
  filteredMarkets: Market[]
  selectedCategory: MarketCategory | 'all'
  searchQuery: string
  sortBy: SortBy
  apiMode: boolean

  setCategory: (category: MarketCategory | 'all') => void
  setSearch: (query: string) => void
  setSortBy: (sortBy: SortBy) => void
  getMarketById: (id: string) => Market | undefined
  updateMarketPrices: (id: string, yesPrice: number, noPrice: number, volume: number) => void
  fetchFromAPI: () => Promise<void>
}

function applyFilters(
  markets: Market[],
  category: MarketCategory | 'all',
  searchQuery: string,
  sortBy: SortBy,
): Market[] {
  let result = [...markets]

  // Filter by category
  if (category !== 'all') {
    result = result.filter(m => m.category === category)
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
  markets: MOCK_MARKETS,
  filteredMarkets: applyFilters(MOCK_MARKETS, 'all', '', 'volume'),
  selectedCategory: 'all',
  searchQuery: '',
  sortBy: 'volume',
  apiMode: false,

  setCategory: (category) => {
    const { markets, searchQuery, sortBy } = get()
    set({
      selectedCategory: category,
      filteredMarkets: applyFilters(markets, category, searchQuery, sortBy),
    })
  },

  setSearch: (query) => {
    const { markets, selectedCategory, sortBy } = get()
    set({
      searchQuery: query,
      filteredMarkets: applyFilters(markets, selectedCategory, query, sortBy),
    })
  },

  setSortBy: (sortBy) => {
    const { markets, selectedCategory, searchQuery } = get()
    set({
      sortBy,
      filteredMarkets: applyFilters(markets, selectedCategory, searchQuery, sortBy),
    })
  },

  getMarketById: (id) => {
    return get().markets.find(m => m.id === id)
  },

  updateMarketPrices: (id, yesPrice, noPrice, volume) => {
    const { markets, selectedCategory, searchQuery, sortBy } = get()
    const updated = markets.map(m =>
      m.id === id ? { ...m, yesPrice, noPrice, volume } : m,
    )
    set({
      markets: updated,
      filteredMarkets: applyFilters(updated, selectedCategory, searchQuery, sortBy),
    })
  },

  fetchFromAPI: async () => {
    try {
      const apiMarkets = await fetchMarkets()
      const { selectedCategory, searchQuery, sortBy } = get()
      set({
        markets: apiMarkets,
        filteredMarkets: applyFilters(apiMarkets, selectedCategory, searchQuery, sortBy),
        apiMode: true,
      })
    } catch {
      // API not available — keep existing mock data
      set({ apiMode: false })
    }
  },
}))
