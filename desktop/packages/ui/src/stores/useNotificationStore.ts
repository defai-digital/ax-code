import { create } from "zustand"

export type NotificationType = "permission" | "session" | "system"

export type NotificationItem = {
  id: string
  type: NotificationType
  title: string
  message: string
  timestamp: number
  read: boolean
  /** For permission notifications */
  sessionId?: string
  requestId?: string
  toolName?: string
  /** Action callbacks stored as refs (not serialized) */
  onAllow?: () => void
  onDeny?: () => void
}

type NotificationState = {
  notifications: NotificationItem[]
  isOpen: boolean
}

type NotificationActions = {
  addNotification: (item: Omit<NotificationItem, "id" | "timestamp" | "read">) => string
  removeNotification: (id: string) => void
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  clearAll: () => void
  setOpen: (open: boolean) => void
  toggleOpen: () => void
  getUnreadCount: () => number
}

let notificationCounter = 0

export const useNotificationStore = create<NotificationState & NotificationActions>()((set, get) => ({
  notifications: [],
  isOpen: false,

  addNotification: (item) => {
    const id = `notification-${++notificationCounter}-${Date.now()}`
    const notification: NotificationItem = {
      ...item,
      id,
      timestamp: Date.now(),
      read: false,
    }
    set((state) => ({
      notifications: [notification, ...state.notifications].slice(0, 100),
    }))
    return id
  },

  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }))
  },

  markAsRead: (id) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      ),
    }))
  },

  markAllAsRead: () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    }))
  },

  clearAll: () => {
    set({ notifications: [] })
  },

  setOpen: (open) => {
    set({ isOpen: open })
  },

  toggleOpen: () => {
    set((state) => ({ isOpen: !state.isOpen }))
  },

  getUnreadCount: () => {
    return get().notifications.filter((n) => !n.read).length
  },
}))
