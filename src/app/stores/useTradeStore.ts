import { create } from 'zustand'
import i18n from '@/app/i18n'
import {
  calculateLMSRBuyPreview,
  calculateLMSRSellPreview,
} from '@/app/engine/lmsr'
import { useMarketStore } from './useMarketStore'
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
  selectedOutcome: 'YES' | 'NO'
  amount: number
  selectedOptionId: string | null

  setOutcome: (outcome: 'YES' | 'NO') => void
  setAmount: (amount: number) => void
  setSelectedOptionId: (optionId: string | null) => void
  executeAPIBuyMulti: (marketId: string, optionId: string, amount: number) => Promise<APITradeResult>
  executeAPISellMulti: (marketId: string, optionId: string, shares: number) => Promise<APISellResult>
  getLMSRPreview: (marketId: string, optionIndex: number, amount: number, mode: 'buy' | 'sell') => { shares: number; avgPrice: number; priceImpact: number; potentialProfit: number }
  reset: () => void
}

export const useTradeStore = create<TradeState>((set, get) => ({
  selectedOutcome: 'YES',
  amount: 0,
  selectedOptionId: null,

  setOutcome: (outcome) => set({ selectedOutcome: outcome }),
  setAmount: (amount) => set({ amount: Math.max(0, amount) }),
  setSelectedOptionId: (optionId) => set({ selectedOptionId: optionId }),

  // Multi-option markets still use backend API (LMSR)
  executeAPIBuyMulti: async (marketId, optionId, amount) => {
    try {
      const res = await createOrder({ marketId, amount, optionId })

      const marketData = useMarketStore.getState().getMarketById(marketId)
      if (marketData && res.newPrices && marketData.options) {
        useMarketStore.getState().updateMultiOptionPrices(marketId, res.newPrices)
      }
      useMarketStore.getState().updateMarketPrices(
        marketId,
        marketData?.yesPrice ?? 0.5,
        marketData?.noPrice ?? 0.5,
        (marketData?.volume || 0) + amount
      )

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

      const marketData = useMarketStore.getState().getMarketById(marketId)
      if (marketData && res.newPrices && marketData.options) {
        useMarketStore.getState().updateMultiOptionPrices(marketId, res.newPrices)
      }
      useMarketStore.getState().updateMarketPrices(
        marketId,
        marketData?.yesPrice ?? 0.5,
        marketData?.noPrice ?? 0.5,
        (marketData?.volume || 0) + res.amountOut
      )

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
      selectedOutcome: 'YES',
      amount: 0,
      selectedOptionId: null,
    }),
}))
