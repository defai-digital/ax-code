import React from "react"
import { useNotificationStore, type NotificationItem } from "@/stores/useNotificationStore"
import { useI18n } from "@/lib/i18n"
import { Icon } from "@/components/icon/Icon"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollableOverlay } from "@/components/ui/ScrollableOverlay"

const NotificationEntry: React.FC<{
  item: NotificationItem
  onRemove: (id: string) => void
}> = React.memo(function NotificationEntry({ item, onRemove }) {
  const { t } = useI18n()

  const typeIcon = item.type === "permission" ? "shield" : item.type === "session" ? "chat-1" : "alert"
  const typeColor =
    item.type === "permission"
      ? "text-status-warning"
      : item.type === "session"
        ? "text-status-success"
        : "text-muted-foreground"

  const timeLabel = React.useMemo(() => {
    const diff = Date.now() - item.timestamp
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return t("notificationCenter.time.justNow")
    if (minutes < 60) return t("notificationCenter.time.minutesAgo", { count: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t("notificationCenter.time.hoursAgo", { count: hours })
    return t("notificationCenter.time.daysAgo", { count: Math.floor(hours / 24) })
  }, [item.timestamp, t])

  return (
    <div
      className={cn(
        "group flex gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors",
        !item.read && "bg-interactive-hover/30",
      )}
    >
      <div className={cn("mt-0.5 flex-shrink-0", typeColor)}>
        <Icon name={typeIcon} className="h-4 w-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-medium text-foreground">{item.title}</span>
          <span className="flex-shrink-0 text-[10px] text-muted-foreground">{timeLabel}</span>
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground">{item.message}</p>
        {item.type === "permission" && item.onAllow && item.onDeny && (
          <div className="mt-1.5 flex gap-2">
            <Button
              size="sm"
              variant="default"
              className="h-6 px-2 text-[10px]"
              onClick={() => {
                item.onAllow?.()
                onRemove(item.id)
              }}
            >
              {t("notificationCenter.allow")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => {
                item.onDeny?.()
                onRemove(item.id)
              }}
            >
              {t("notificationCenter.deny")}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
})

export const NotificationCenter: React.FC = React.memo(function NotificationCenter() {
  const { t } = useI18n()
  const notifications = useNotificationStore((s) => s.notifications)
  const isOpen = useNotificationStore((s) => s.isOpen)
  const setOpen = useNotificationStore((s) => s.setOpen)
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead)
  const clearAll = useNotificationStore((s) => s.clearAll)
  const removeNotification = useNotificationStore((s) => s.removeNotification)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const wasOpenRef = React.useRef(false)

  const hasNotifications = notifications.length > 0
  const unreadCount = notifications.filter((n) => !n.read).length

  // Mark everything read when the panel closes (from anywhere), not when it
  // opens — the unread badge shouldn't vanish the moment the panel appears.
  React.useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      markAllAsRead()
    }
    wasOpenRef.current = isOpen
  }, [isOpen, markAllAsRead])

  // Focus the panel on open, restore focus on close, and close on Escape.
  React.useEffect(() => {
    if (!isOpen) {
      return
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [isOpen, setOpen])

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-label={t("notificationCenter.title")}
        className="absolute right-0 top-12 z-50 flex w-80 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{t("notificationCenter.title")}</span>
            {unreadCount > 0 && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {hasNotifications && (
              <>
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-interactive-hover hover:text-foreground transition-colors"
                >
                  {t("notificationCenter.markAllRead")}
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-interactive-hover hover:text-foreground transition-colors"
                >
                  {t("notificationCenter.clearAll")}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Content */}
        <ScrollableOverlay outerClassName="max-h-96 min-h-[120px]">
          <div className="flex flex-col gap-0.5 p-2">
            {hasNotifications ? (
              notifications.map((item) => (
                <NotificationEntry key={item.id} item={item} onRemove={removeNotification} />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                <Icon name="checkbox-circle" className="h-8 w-8 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground">{t("notificationCenter.empty")}</p>
                <p className="text-[10px] text-muted-foreground">{t("notificationCenter.emptyDescription")}</p>
              </div>
            )}
          </div>
        </ScrollableOverlay>
      </div>
    </>
  )
})
