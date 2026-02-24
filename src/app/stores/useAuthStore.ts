import { create } from 'zustand'
import { loginWithWallet } from '@/app/services/auth'
import { setToken, getToken, clearToken, fetchBalance } from '@/app/services/api'
import { useTradeStore } from './useTradeStore'
import { usePortfolioStore } from './usePortfolioStore'
import { useAgentStore } from './useAgentStore'
import { useSocialStore } from './useSocialStore'
import { useUserStore } from './useUserStore'
import { disconnectWS } from '@/app/services/ws'

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
  login: (address: string, signMessageAsync: (args: { message: string }) => Promise<string>) => Promise<{ success: boolean; error?: string }>
  logout: () => void
  restoreToken: () => void
}

/** Extract address from JWT payload (client-side, no verification) */
function getTokenAddress(token: string | null): string | null {
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as { address?: string }
    return payload.address ?? null
  } catch {
    return null
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  address: (() => { const t = getValidToken(); return getTokenAddress(t); })(),
  balance: 0,
  displayName: (() => { const a = getTokenAddress(getValidToken()); return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : ''; })(),
  isConnected: !!getTokenAddress(getValidToken()),
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
      .catch((e) => {
        console.warn('[Auth] Failed to fetch balance on connect:', e.message)
      })
  },

  disconnect: () => {
    clearToken()

    // Clear trade, portfolio, and agent stores on disconnect (H8)
    useTradeStore.getState().reset()
    usePortfolioStore.setState({ positions: [], orders: [] })
    useAgentStore.getState().reset()

    // Reset social and user stores on logout
    useSocialStore.getState().reset()
    useUserStore.getState().reset()

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
          .catch((e) => {
            console.warn('[Auth] Failed to fetch balance after login:', e.message)
          })
        // Fetch user's agents (no forced popup)
        useAgentStore.getState().fetchMyAgents()
        return { success: true }
      }
      return { success: false, error: loginResult.error }
    } catch {
      return { success: false, error: 'unknown' }
    }
  },

  logout: () => {
    clearToken()
    // Disconnect WebSocket to prevent receiving notifications for logged-out user
    disconnectWS()
    set({ token: null, isAuthenticated: false, isAdmin: false })
  },

  restoreToken: () => {
    const token = getValidToken()
    const update: Partial<AuthState> = { token, isAuthenticated: !!token, isAdmin: getTokenAdminFlag(token) }
    // Restore address from JWT payload so portfolio/profile pages work after refresh
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1])) as { address?: string }
        if (payload.address) {
          update.address = payload.address
          update.isConnected = true
          update.displayName = `${payload.address.slice(0, 6)}...${payload.address.slice(-4)}`
        }
      } catch { /* ignore malformed token */ }
    }
    set(update)
    // If authenticated, fetch agents (no forced popup)
    if (token) {
      useAgentStore.getState().fetchMyAgents()
    }
  },
}))
