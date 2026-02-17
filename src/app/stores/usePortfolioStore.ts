import { create } from 'zustand'
import type { Position, Order } from '@/app/types/market.types'
import { fetchPortfolio } from '@/app/services/api'

export interface PositionPnL {
  unrealizedPnL: number
  pnlPercent: number
}

interface PortfolioState {
  positions: Position[]
  orders: Order[]
  lastFetchTime: number

  addPosition: (
    marketId: string,
    marketTitle: string,
    side: string,
    shares: number,
    avgCost: number,
  ) => void
  removePosition: (positionId: string) => void
  updatePositionPrice: (marketId: string, yesPrice: number, noPrice: number) => void
  getPositionPnL: (position: Position) => PositionPnL
  getTotalValue: () => number
  getTotalPnL: () => number

  addOrder: (order: Order) => void
  cancelOrder: (orderId: string) => void
  fetchFromAPI: (address: string) => Promise<void>
}

export const usePortfolioStore = create<PortfolioState>((set, get) => ({
  positions: [],
  orders: [],
  lastFetchTime: 0,

  addPosition: (marketId, marketTitle, side, shares, avgCost) => {
    // P1-6 fix: Use atomic setState to prevent race conditions when concurrent trades
    set((state) => {
      const existing = state.positions.find(
        (p) => p.marketId === marketId && p.side === side,
      )

      if (existing) {
        // Merge: weighted average cost
        const totalShares = existing.shares + shares
        const weightedCost =
          (existing.shares * existing.avgCost + shares * avgCost) / totalShares

        return {
          positions: state.positions.map((p) =>
            p.id === existing.id
              ? { ...p, shares: totalShares, avgCost: weightedCost, timestamp: Date.now() }
              : p,
          ),
        }
      } else {
        const newPosition: Position = {
          id: `pos_${marketId}_${side}_${Date.now()}`,
          marketId,
          marketTitle,
          side,
          shares,
          avgCost,
          currentPrice: avgCost,
          timestamp: Date.now(),
        }
        return { positions: [...state.positions, newPosition] }
      }
    })
  },

  removePosition: (positionId) => {
    set({
      positions: get().positions.filter((p) => p.id !== positionId),
    })
  },

  updatePositionPrice: (marketId, yesPrice, noPrice) => {
    set({
      positions: get().positions.map((p) => {
        if (p.marketId !== marketId) return p
        return {
          ...p,
          currentPrice: p.side === 'yes' ? yesPrice : noPrice,
        }
      }),
    })
  },

  getPositionPnL: (position) => {
    const totalCost = position.shares * position.avgCost
    const currentValue = position.shares * position.currentPrice
    const unrealizedPnL = currentValue - totalCost
    const pnlPercent = totalCost > 0 ? (unrealizedPnL / totalCost) * 100 : 0
    return { unrealizedPnL, pnlPercent }
  },

  getTotalValue: () => {
    return get().positions.reduce(
      (sum, p) => sum + p.shares * p.currentPrice,
      0,
    )
  },

  getTotalPnL: () => {
    const { getPositionPnL } = get()
    return get().positions.reduce(
      (sum, p) => sum + getPositionPnL(p).unrealizedPnL,
      0,
    )
  },

  addOrder: (order) => {
    set({ orders: [...get().orders, order] })
  },

  cancelOrder: (orderId) => {
    set({
      orders: get().orders.map((o) =>
        o.id === orderId ? { ...o, status: 'cancelled' as const } : o,
      ),
    })
  },

  fetchFromAPI: async (address) => {
    // Throttle: avoid rapid re-fetches within 2 seconds
    const now = Date.now()
    if (now - get().lastFetchTime < 2000) return

    try {
      const data = await fetchPortfolio(address)
      const positions: Position[] = (data.positions ?? []).map((p: any) => ({
        id: String(p.id ?? `pos_${p.market_id ?? p.marketId}_${p.side}_${Date.now()}`),
        marketId: String(p.market_id ?? p.marketId ?? ''),
        marketTitle: String(p.market_title ?? p.marketTitle ?? ''),
        side: p.side,
        shares: Number(p.shares) || 0,
        avgCost: Number(p.avg_cost ?? p.avgCost) || 0,
        currentPrice: Number(p.current_price ?? p.currentPrice ?? p.avg_cost ?? p.avgCost) || 0,
        timestamp: Number(p.timestamp ?? p.created_at) || Date.now(),
      }))
      set({ positions, lastFetchTime: now })
    } catch {
      // API not available — keep existing positions
    }
  },
}))
