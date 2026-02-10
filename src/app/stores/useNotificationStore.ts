import { create } from 'zustand'
import {
  fetchNotifications as apiFetchNotifications,
  markNotificationRead as apiMarkRead,
  markAllNotificationsRead as apiMarkAllRead,
  fetchUnreadCount as apiFetchUnreadCount,
} from '@/app/services/api'

export interface Notification {
  id: string
  type: 'trade' | 'market' | 'system'
  title: string
  message: string
  timestamp: number
  read: boolean
}

interface NotificationState {
  notifications: Notification[]
  loading: boolean
  addNotification: (type: Notification['type'], title: string, message: string) => void
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  unreadCount: () => number
  loadFromServer: () => Promise<void>
  refreshUnreadCount: () => Promise<void>
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  loading: false,

  addNotification: (type, title, message) => {
    const notification: Notification = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type,
      title,
      message,
      timestamp: Date.now(),
      read: false,
    }
    set((state) => ({
      notifications: [notification, ...state.notifications].slice(0, 50),
    }))
  },

  markAsRead: (id) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    }))
    // Sync to backend (fire-and-forget)
    apiMarkRead(id).catch(() => {})
  },

  markAllAsRead: () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    }))
    // Sync to backend (fire-and-forget)
    apiMarkAllRead().catch(() => {})
  },

  unreadCount: () => {
    return get().notifications.filter((n) => !n.read).length
  },

  loadFromServer: async () => {
    set({ loading: true })
    try {
      const data = await apiFetchNotifications()
      const notifications = data.notifications ?? []
      set({ notifications: notifications.slice(0, 50) })
    } catch {
      // Keep existing notifications if server is unavailable
    } finally {
      set({ loading: false })
    }
  },

  refreshUnreadCount: async () => {
    try {
      const data = await apiFetchUnreadCount()
      // If the server has a different unread count, reload notifications
      const localUnread = get().notifications.filter((n) => !n.read).length
      if (data.count !== localUnread) {
        get().loadFromServer()
      }
    } catch {
      // Silently fail
    }
  },
}))
