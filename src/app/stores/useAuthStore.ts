import { create } from 'zustand'
import { loginWithWallet } from '@/app/services/auth'
import { setToken, getToken, clearToken, fetchBalance } from '@/app/services/api'
import { useTradeStore } from './useTradeStore'
import { usePortfolioStore } from './usePortfolioStore'
import { useAgentStore } from './useAgentStore'

/** Decode JWT payload and check if expired (client-side only, no verification) */
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.exp * 1000 < Date.now()
  } catch {
    return true
  }
}

function getTokenAdminFlag(token: string | null): boolean {
  if (!token) return false
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as { isAdmin?: unknown }
    return payload.isAdmin === true
  } catch {
    return false
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
  isAdmin: boolean

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
  token: (() => { const t = getValidToken(); return t; })(),
  isAuthenticated: !!getValidToken(),
  isAdmin: (() => {
    const t = getValidToken()
    return getTokenAdminFlag(t)
  })(),

  connect: (address) => {
    set({
      address,
      isConnected: true,
      displayName: `${address.slice(0, 6)}...${address.slice(-4)}`,
      balance: 0,
    })
    // Fetch real balance from backend (guard against stale closure after disconnect)
    fetchBalance(address)
      .then((data) => {
        if (get().address === address) set({ balance: data.available })
      })
      .catch(() => {
        // API not available — keep balance at 0
      })
  },

  disconnect: () => {
    clearToken()

    // Clear trade, portfolio, and agent stores on disconnect (H8)
    useTradeStore.getState().reset()
    usePortfolioStore.setState({ positions: [], orders: [] })
    useAgentStore.getState().reset()

    set({
      address: null,
      isConnected: false,
      displayName: '',
      balance: 0,
      token: null,
      isAuthenticated: false,
      isAdmin: false,
    })
  },

  setBalance: (balance) => set({ balance }),

  setDisplayName: (name) => set({ displayName: name }),

  login: async (address, signMessageAsync) => {
    try {
      const loginResult = await loginWithWallet(address, async (message: string) => {
        return await signMessageAsync({ message })
      })
      if (loginResult.success) {
        const token = getToken()
        // Also populate address/isConnected/displayName so other pages
        // (Portfolio, Profile, etc.) that read useAuthStore.address work correctly.
        set({
          token,
          isAuthenticated: true,
          isAdmin: loginResult.isAdmin,
          address,
          isConnected: true,
          displayName: `${address.slice(0, 6)}...${address.slice(-4)}`,
        })
        // Fetch real balance from backend (guard against stale closure after disconnect)
        fetchBalance(address)
          .then((data) => {
            if (get().address === address) set({ balance: data.available })
          })
          .catch(() => {
            // API not available — keep balance at 0
          })
        // Fetch user's agents, prompt mint if none (guard against disconnect)
        useAgentStore.getState().fetchMyAgents().then(() => {
          if (get().address !== address) return
          const agentState = useAgentStore.getState()
          if (!agentState.hasAgent) {
            agentState.setShowMintModal(true)
          }
        })
        return true
      }
      return false
    } catch {
      return false
    }
  },

  logout: () => {
    clearToken()
    set({ token: null, isAuthenticated: false, isAdmin: false })
  },

  restoreToken: () => {
    const token = getValidToken()
    set({ token, isAuthenticated: !!token, isAdmin: getTokenAdminFlag(token) })
    // If authenticated, fetch agents and prompt mint if none
    if (token) {
      useAgentStore.getState().fetchMyAgents().then(() => {
        const agentState = useAgentStore.getState()
        if (!agentState.hasAgent) {
          agentState.setShowMintModal(true)
        }
      })
    }
  },
}))
