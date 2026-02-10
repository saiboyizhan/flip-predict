import { create } from 'zustand'
import { loginWithWallet } from '@/app/services/auth'
import { setToken, getToken, clearToken } from '@/app/services/api'

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
  token: getToken(),
  isAuthenticated: !!getToken(),

  connect: (address) =>
    set({
      address,
      isConnected: true,
      displayName: `${address.slice(0, 6)}...${address.slice(-4)}`,
      balance: 10000, // Mock initial balance
    }),

  disconnect: () => {
    clearToken()
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
    const token = getToken()
    set({ token, isAuthenticated: !!token })
  },
}))
