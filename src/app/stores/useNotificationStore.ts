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
  synced?: boolean
}

interface NotificationState {
  notifications: Notification[]
  loading: boolean
  addNotification: (
    type: Notification['type'],
    title: string,
    message: string,
    options?: Partial<Pick<Notification, 'id' | 'timestamp' | 'read' | 'synced'>>
  ) => void
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  unreadCount: () => number
  loadFromServer: () => Promise<void>
  refreshUnreadCount: () => Promise<void>
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  loading: false,

  addNotification: (type, title, message, options) => {
    const notification: Notification = {
      id: options?.id ?? (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      type,
      title,
      message,
      timestamp: options?.timestamp ?? Date.now(),
      read: options?.read ?? false,
      synced: options?.synced ?? Boolean(options?.id),
    }
    set((state) => ({
      notifications: state.notifications.some((n) => n.id === notification.id)
        ? state.notifications.map((n) => (n.id === notification.id ? { ...n, ...notification } : n))
        : [notification, ...state.notifications].slice(0, 50),
    }))
  },

  markAsRead: (id) => {
    const target = get().notifications.find((n) => n.id === id)
    if (!target) return
    const wasRead = target.read
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    }))
    // Sync to backend only for server-sourced notifications
    if (target.synced) {
      apiMarkRead(id).catch(() => {
        // Revert to previous read state on API failure
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, read: wasRead } : n
          ),
        }))
      })
    }
  },

  markAllAsRead: () => {
    const hasSyncedUnread = get().notifications.some((n) => n.synced && !n.read)
    const previousNotifications = get().notifications
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    }))
    if (hasSyncedUnread) {
      apiMarkAllRead().catch(() => {
        // Revert to previous read states on API failure
        set({ notifications: previousNotifications })
        console.warn('[Notifications] Failed to mark all as read on server')
      })
    }
  },

  unreadCount: () => {
    return get().notifications.filter((n) => !n.read).length
  },

  loadFromServer: async () => {
    set({ loading: true })
    try {
      const data = await apiFetchNotifications()
      const notifications = data.notifications ?? []
      set({
        notifications: notifications
          .slice(0, 50)
          .map((n) => ({ ...n, synced: true })),
      })
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
