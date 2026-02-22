import { create } from 'zustand'

interface TradeState {
  selectedOutcome: 'YES' | 'NO'
  amount: number
  selectedOptionId: string | null

  setOutcome: (outcome: 'YES' | 'NO') => void
  setAmount: (amount: number) => void
  setSelectedOptionId: (optionId: string | null) => void
  reset: () => void
}

export const useTradeStore = create<TradeState>((set) => ({
  selectedOutcome: 'YES',
  amount: 0,
  selectedOptionId: null,

  setOutcome: (outcome) => set({ selectedOutcome: outcome }),
  setAmount: (amount) => set({ amount: Math.max(0, amount) }),
  setSelectedOptionId: (optionId) => set({ selectedOptionId: optionId }),

  reset: () =>
    set({
      selectedOutcome: 'YES',
      amount: 0,
      selectedOptionId: null,
    }),
}))
