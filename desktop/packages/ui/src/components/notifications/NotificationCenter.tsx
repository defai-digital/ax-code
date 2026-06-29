import React from "react"
import { useNotificationStore, type NotificationItem } from "@/stores/useNotificationStore"
import { useI18n } from "@/lib/i18n"
import { Icon } from "@/components/icon/Icon"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollableOverlay } from "@/components/ui/ScrollableOverlay"

const NotificationEntry: React.FC<{
  item: NotificationItem
  onMarkRead: (id: string) => void
  onRemove: (id: string) => void
}> = React.memo(function NotificationEntry({ item, onMarkRead, onRemove }) {
  const { t } = useI18n()

  React.useEffect(() => {
    if (!item.read) {
      onMarkRead(item.id)
    }
  }, [item.id, item.read, onMarkRead])

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
    if (minutes < 1) return "just now"
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }, [item.timestamp])

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
          <span className="flex-shrink-0 text-[10px] text-muted-foreground/60">{timeLabel}</span>
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
  const markAsRead = useNotificationStore((s) => s.markAsRead)
  const removeNotification = useNotificationStore((s) => s.removeNotification)

  const hasNotifications = notifications.length > 0
  const unreadCount = notifications.filter((n) => !n.read).length

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

      {/* Panel */}
      <div className="absolute right-0 top-12 z-50 flex w-80 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg">
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
                <NotificationEntry
                  key={item.id}
                  item={item}
                  onMarkRead={markAsRead}
                  onRemove={removeNotification}
                />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                <Icon name="checkbox-circle" className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-xs font-medium text-muted-foreground">{t("notificationCenter.empty")}</p>
                <p className="text-[10px] text-muted-foreground/60">{t("notificationCenter.emptyDescription")}</p>
              </div>
            )}
          </div>
        </ScrollableOverlay>
      </div>
    </>
  )
})
