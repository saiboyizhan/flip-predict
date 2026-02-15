import { create } from 'zustand'
import i18n from '@/app/i18n'
import type { Pool } from '@/app/engine/amm'
import {
  createPoolFromPrices,
  getPrice,
  calculateBuy,
  calculateSell,
  getEstimatedReturn,
} from '@/app/engine/amm'
import {
  calculateLMSRBuyPreview,
  calculateLMSRSellPreview,
  getLMSRPrices,
} from '@/app/engine/lmsr'
import { useMarketStore } from './useMarketStore'
import { usePortfolioStore } from './usePortfolioStore'
import { useNotificationStore } from './useNotificationStore'
import { useAgentStore } from './useAgentStore'
import { createOrder, sellOrder } from '@/app/services/api'

const DEFAULT_LIQUIDITY = 10000

interface APITradeResult {
  success: boolean
  shares: number
  price: number
  error?: string
}

interface APISellResult {
  success: boolean
  amountOut: number
  price: number
  error?: string
}

interface TradeState {
  pools: Record<string, Pool>
  selectedOutcome: 'YES' | 'NO'
  amount: number
  selectedOptionId: string | null

  setOutcome: (outcome: 'YES' | 'NO') => void
  setAmount: (amount: number) => void
  setSelectedOptionId: (optionId: string | null) => void
  getOrCreatePool: (marketId: string) => Pool
  executeBuy: (marketId: string, side: 'yes' | 'no', amount: number) => { success: boolean; shares: number; avgPrice: number; priceImpact: number }
  executeSell: (marketId: string, side: 'yes' | 'no', shares: number) => { success: boolean; payout: number; avgPrice: number; priceImpact: number }
  executeAPIBuy: (marketId: string, side: 'yes' | 'no', amount: number) => Promise<APITradeResult>
  executeAPISell: (marketId: string, side: 'yes' | 'no', shares: number) => Promise<APISellResult>
  executeAPIBuyMulti: (marketId: string, optionId: string, amount: number) => Promise<APITradeResult>
  executeAPISellMulti: (marketId: string, optionId: string, shares: number) => Promise<APISellResult>
  getLMSRPreview: (marketId: string, optionIndex: number, amount: number, mode: 'buy' | 'sell') => { shares: number; avgPrice: number; priceImpact: number; potentialProfit: number }
  reset: () => void
}

export const useTradeStore = create<TradeState>((set, get) => ({
  pools: {},
  selectedOutcome: 'YES',
  amount: 0,
  selectedOptionId: null,

  setOutcome: (outcome) => set({ selectedOutcome: outcome }),

  setAmount: (amount) => set({ amount: Math.max(0, amount) }),

  setSelectedOptionId: (optionId) => set({ selectedOptionId: optionId }),

  getOrCreatePool: (marketId: string) => {
    const { pools } = get()
    if (pools[marketId]) return pools[marketId]

    const market = useMarketStore.getState().getMarketById(marketId)
    const yesPrice = market ? Math.max(0.01, Math.min(0.99, market.yesPrice)) : 0.5
    const pool = createPoolFromPrices(yesPrice, DEFAULT_LIQUIDITY)

    set({ pools: { ...get().pools, [marketId]: pool } })
    return pool
  },

  executeBuy: (marketId, side, amount) => {
    if (amount <= 0) return { success: false, shares: 0, avgPrice: 0, priceImpact: 0 }

    const pool = get().getOrCreatePool(marketId)

    try {
      const result = calculateBuy(pool, side, amount)

      // Update pool state
      set({ pools: { ...get().pools, [marketId]: result.newPool } })

      // Update market prices and volume in MarketStore
      const marketState = useMarketStore.getState()
      const newYesPrice = getPrice(result.newPool, 'yes')
      const newNoPrice = getPrice(result.newPool, 'no')
      const market = marketState.getMarketById(marketId)
      const currentVolume = market ? market.volume : 0

      marketState.updateMarketPrices(marketId, newYesPrice, newNoPrice, currentVolume + amount)

      // Add position to portfolio store (merges if same market+side exists)
      const portfolioState = usePortfolioStore.getState()
      portfolioState.addPosition(marketId, market?.title || '', side, result.shares, result.avgPrice)
      portfolioState.updatePositionPrice(marketId, newYesPrice, newNoPrice)

      // Send notification
      useNotificationStore.getState().addNotification(
        'trade',
        i18n.t('tradeNotification.buySuccess'),
        i18n.t('tradeNotification.buyDesc', { shares: result.shares.toFixed(2), side: side.toUpperCase() })
      )

      return {
        success: true,
        shares: result.shares,
        avgPrice: result.avgPrice,
        priceImpact: result.priceImpact,
      }
    } catch {
      return { success: false, shares: 0, avgPrice: 0, priceImpact: 0 }
    }
  },

  executeSell: (marketId, side, shares) => {
    if (shares <= 0) return { success: false, payout: 0, avgPrice: 0, priceImpact: 0 }

    const pool = get().getOrCreatePool(marketId)

    try {
      const result = calculateSell(pool, side, shares)

      // Update pool state
      set({ pools: { ...get().pools, [marketId]: result.newPool } })

      // Update market prices in MarketStore
      const marketState = useMarketStore.getState()
      const newYesPrice = getPrice(result.newPool, 'yes')
      const newNoPrice = getPrice(result.newPool, 'no')
      const market = marketState.getMarketById(marketId)
      const currentVolume = market ? market.volume : 0

      marketState.updateMarketPrices(marketId, newYesPrice, newNoPrice, currentVolume + result.payout)

      // Send notification
      useNotificationStore.getState().addNotification(
        'trade',
        i18n.t('tradeNotification.sellSuccess'),
        i18n.t('tradeNotification.sellDesc', { shares: shares.toFixed(2), side: side.toUpperCase(), amount: result.payout.toFixed(2) })
      )

      return {
        success: true,
        payout: result.payout,
        avgPrice: result.avgPrice,
        priceImpact: result.priceImpact,
      }
    } catch {
      return { success: false, payout: 0, avgPrice: 0, priceImpact: 0 }
    }
  },

  executeAPIBuy: async (marketId, side, amount) => {
    const marketState = useMarketStore.getState()

    // If not in API mode, fallback to local AMM
    if (!marketState.apiMode) {
      const result = get().executeBuy(marketId, side, amount)
      return { success: result.success, shares: result.shares, price: result.avgPrice }
    }

    try {
      const res = await createOrder({ marketId, side, amount })

      // Re-read market state AFTER await to avoid stale data (H10)
      const freshMarketState = useMarketStore.getState()
      const market = freshMarketState.getMarketById(marketId)
      const currentVolume = market ? market.volume : 0
      freshMarketState.updateMarketPrices(marketId, res.newYesPrice, res.newNoPrice, currentVolume + amount)

      // Add position to portfolio
      const portfolioState = usePortfolioStore.getState()
      portfolioState.addPosition(marketId, market?.title || '', side, res.shares, res.price)
      portfolioState.updatePositionPrice(marketId, res.newYesPrice, res.newNoPrice)

      useNotificationStore.getState().addNotification(
        'trade',
        i18n.t('tradeNotification.buySuccess'),
        i18n.t('tradeNotification.buyDesc', { shares: res.shares.toFixed(2), side: side.toUpperCase() }),
      )

      return { success: true, shares: res.shares, price: res.price }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Trade failed, please try again'
      // Trigger mint modal if user has no agent
      if (message.includes('AGENT_REQUIRED')) {
        useAgentStore.getState().setShowMintModal(true)
        return { success: false, shares: 0, price: 0, error: 'AGENT_REQUIRED' }
      }
      return { success: false, shares: 0, price: 0, error: message }
    }
  },

  executeAPISell: async (marketId, side, shares) => {
    const marketState = useMarketStore.getState()

    if (!marketState.apiMode) {
      const result = get().executeSell(marketId, side, shares)
      return { success: result.success, amountOut: result.payout, price: result.avgPrice }
    }

    try {
      const res = await sellOrder({ marketId, side, shares })

      // Re-read market state AFTER await to avoid stale data (H10)
      const freshMarketState = useMarketStore.getState()
      const market = freshMarketState.getMarketById(marketId)
      const currentVolume = market ? market.volume : 0
      freshMarketState.updateMarketPrices(marketId, res.newYesPrice, res.newNoPrice, currentVolume + res.amountOut)

      useNotificationStore.getState().addNotification(
        'trade',
        i18n.t('tradeNotification.sellSuccess'),
        i18n.t('tradeNotification.sellDesc', { shares: shares.toFixed(2), side: side.toUpperCase(), amount: res.amountOut.toFixed(2) }),
      )

      return { success: true, amountOut: res.amountOut, price: res.price }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sell failed, please try again'
      if (message.includes('AGENT_REQUIRED')) {
        useAgentStore.getState().setShowMintModal(true)
        return { success: false, amountOut: 0, price: 0, error: 'AGENT_REQUIRED' }
      }
      return { success: false, amountOut: 0, price: 0, error: message }
    }
  },

  executeAPIBuyMulti: async (marketId, optionId, amount) => {
    try {
      const res = await createOrder({ marketId, amount, optionId })

      // Update market options prices in store
      const freshMarketState = useMarketStore.getState()
      const market = freshMarketState.getMarketById(marketId)
      if (market && res.newPrices && market.options) {
        freshMarketState.updateMultiOptionPrices(marketId, res.newPrices)
      }
      const currentVolume = market ? market.volume : 0
      freshMarketState.updateMarketPrices(marketId, market?.yesPrice ?? 0.5, market?.noPrice ?? 0.5, currentVolume + amount)

      useNotificationStore.getState().addNotification(
        'trade',
        i18n.t('tradeNotification.buySuccess'),
        i18n.t('tradeNotification.buyDesc', { shares: res.shares.toFixed(2), side: 'OPTION' }),
      )

      return { success: true, shares: res.shares, price: res.price }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Trade failed, please try again'
      if (message.includes('AGENT_REQUIRED')) {
        useAgentStore.getState().setShowMintModal(true)
        return { success: false, shares: 0, price: 0, error: 'AGENT_REQUIRED' }
      }
      return { success: false, shares: 0, price: 0, error: message }
    }
  },

  executeAPISellMulti: async (marketId, optionId, shares) => {
    try {
      const res = await sellOrder({ marketId, shares, optionId })

      const freshMarketState = useMarketStore.getState()
      const market = freshMarketState.getMarketById(marketId)
      if (market && res.newPrices && market.options) {
        freshMarketState.updateMultiOptionPrices(marketId, res.newPrices)
      }
      const currentVolume = market ? market.volume : 0
      freshMarketState.updateMarketPrices(marketId, market?.yesPrice ?? 0.5, market?.noPrice ?? 0.5, currentVolume + res.amountOut)

      useNotificationStore.getState().addNotification(
        'trade',
        i18n.t('tradeNotification.sellSuccess'),
        i18n.t('tradeNotification.sellDesc', { shares: shares.toFixed(2), side: 'OPTION', amount: res.amountOut.toFixed(2) }),
      )

      return { success: true, amountOut: res.amountOut, price: res.price }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sell failed, please try again'
      if (message.includes('AGENT_REQUIRED')) {
        useAgentStore.getState().setShowMintModal(true)
        return { success: false, amountOut: 0, price: 0, error: 'AGENT_REQUIRED' }
      }
      return { success: false, amountOut: 0, price: 0, error: message }
    }
  },

  getLMSRPreview: (marketId, optionIndex, amount, mode) => {
    const market = useMarketStore.getState().getMarketById(marketId)
    if (!market?.options || market.options.length < 2) {
      return { shares: 0, avgPrice: 0, priceImpact: 0, potentialProfit: 0 }
    }
    const reserves = market.options.map(o => o.reserve)
    const b = (market.totalLiquidity || DEFAULT_LIQUIDITY) / market.options.length

    try {
      if (mode === 'buy') {
        const preview = calculateLMSRBuyPreview(reserves, b, optionIndex, amount)
        return {
          shares: preview.sharesOut,
          avgPrice: preview.avgPrice,
          priceImpact: preview.priceImpact,
          potentialProfit: preview.sharesOut - amount,
        }
      } else {
        const preview = calculateLMSRSellPreview(reserves, b, optionIndex, amount)
        return {
          shares: amount,
          avgPrice: preview.avgPrice,
          priceImpact: preview.priceImpact,
          potentialProfit: preview.amountOut,
        }
      }
    } catch {
      return { shares: 0, avgPrice: 0, priceImpact: 0, potentialProfit: 0 }
    }
  },

  reset: () =>
    set({
      pools: {},
      selectedOutcome: 'YES',
      amount: 0,
      selectedOptionId: null,
    }),
}))

// Re-export AMM functions for use in components
export { calculateBuy, calculateSell, getEstimatedReturn, getPrice }
