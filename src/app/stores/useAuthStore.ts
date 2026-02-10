import { create } from 'zustand'
import { loginWithWallet } from '@/app/services/auth'
import { setToken, getToken, clearToken } from '@/app/services/api'
import { useTradeStore } from './useTradeStore'
import { usePortfolioStore } from './usePortfolioStore'

/** Decode JWT payload and check if expired (client-side only, no verification) */
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.exp * 1000 < Date.now()
  } catch {
    return true
  }
}

/** Return token only if it exists and is not expired; clear it otherwise */
function getValidToken(): string | null {
  const token = getToken()
  if (token && isTokenExpired(token)) {
    clearToken()
    return null
  }
  return token
}

interface AuthState {
  address: string | null
  balance: number
  displayName: string
  isConnected: boolean
  token: string | null
  isAuthenticated: boolean

  connect: (address: string) => void
  disconnect: () => void
  setBalance: (balance: number) => void
  setDisplayName: (name: string) => void
  login: (address: string, signMessageAsync: (args: { message: string }) => Promise<string>) => Promise<boolean>
  logout: () => void
  restoreToken: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  address: null,
  balance: 0,
  displayName: '',
  isConnected: false,
  token: getValidToken(),
  isAuthenticated: !!getValidToken(),

  connect: (address) =>
    set({
      address,
      isConnected: true,
      displayName: `${address.slice(0, 6)}...${address.slice(-4)}`,
      balance: 10000, // Mock initial balance
    }),

  disconnect: () => {
    clearToken()

    // Clear trade and portfolio stores on disconnect (H8)
    useTradeStore.getState().reset()
    // Portfolio store has no reset action; clear positions/orders directly via setState
    usePortfolioStore.setState({ positions: [], orders: [] })

    set({
      address: null,
      isConnected: false,
      displayName: '',
      balance: 0,
      token: null,
      isAuthenticated: false,
    })
  },

  setBalance: (balance) => set({ balance }),

  setDisplayName: (name) => set({ displayName: name }),

  login: async (address, signMessageAsync) => {
    try {
      const success = await loginWithWallet(address, async (message: string) => {
        return await signMessageAsync({ message })
      })
      if (success) {
        const token = getToken()
        set({ token, isAuthenticated: true })
        return true
      }
      return false
    } catch {
      return false
    }
  },

  logout: () => {
    clearToken()
    set({ token: null, isAuthenticated: false })
  },

  restoreToken: () => {
    const token = getValidToken()
    set({ token, isAuthenticated: !!token })
  },
}))
