import React from "react"
import { useSessionUIStore } from "@/sync/session-ui-store"
import { useUIStore } from "@/stores/useUIStore"
import { useAttentionStore } from "@/stores/useAttentionStore"
import { useSessionPermissions, useAllLiveSessions, usePendingPermissionSessionIds } from "@/sync/sync-context"
import { getRegisteredRuntimeAPIs } from "@/contexts/runtimeAPIRegistry"
import { isDesktopShell } from "@/lib/desktop"
import { setDesktopBadgeCount } from "@/lib/desktopNative"
import { useI18n } from "@/lib/i18n"
import type { NotificationPayload } from "@/lib/api/types"

const PERMISSION_NOTIFY_DEBOUNCE_MS = 2000

const isAppFocused = (): boolean => {
  if (typeof document === "undefined") return true
  return document.visibilityState === "visible" && document.hasFocus()
}

const isViewingSession = (sessionId: string): boolean =>
  isAppFocused() && useSessionUIStore.getState().currentSessionId === sessionId

function SessionPermissionWatcher({
  sessionId,
  sessionTitle,
  sessionDirectory,
}: {
  sessionId: string
  sessionTitle?: string
  sessionDirectory?: string
}): null {
  const { t } = useI18n()
  const permissions = useSessionPermissions(sessionId)
  const notifyOnPermission = useUIStore((s) => s.notifyOnPermission)
  const nativeNotificationsEnabled = useUIStore((s) => s.nativeNotificationsEnabled)
  // Subscribed (not just read imperatively) so the effect re-evaluates when
  // the user navigates away from a session with a still-pending request.
  const currentSessionId = useSessionUIStore((s) => s.currentSessionId)

  const hasPermissions = permissions.length > 0
  const enabled = notifyOnPermission && nativeNotificationsEnabled
  const notifiedRef = React.useRef(false)

  React.useEffect(() => {
    if (!hasPermissions) {
      notifiedRef.current = false
      return
    }
    if (notifiedRef.current || !enabled) return
    if (isAppFocused() && currentSessionId === sessionId) return

    const timer = setTimeout(() => {
      // Re-check at fire time: the user may have focused the session during
      // the debounce window.
      if (isViewingSession(sessionId)) return
      notifiedRef.current = true
      const payload: NotificationPayload & { sessionId?: string; directory?: string } = {
        title: t("notifications.permission.title"),
        body: sessionTitle
          ? t("notifications.permission.bodyWithTitle", { title: sessionTitle })
          : t("notifications.permission.body"),
        tag: `permission:${sessionId}`,
        sessionId,
        ...(sessionDirectory ? { directory: sessionDirectory } : {}),
      }
      const apis = getRegisteredRuntimeAPIs()
      void apis?.notifications?.notifyAgentCompletion(payload)
    }, PERMISSION_NOTIFY_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [sessionId, sessionTitle, hasPermissions, enabled, currentSessionId, sessionDirectory, t])

  return null
}

/**
 * Mirrors the waiting-for-approval session count to the dock/taskbar badge
 * (desktop shells) and the attention store (window-title fallback on web).
 */
function AttentionBadgeSync(): null {
  const count = usePendingPermissionSessionIds().size
  const setPendingApprovalCount = useAttentionStore((s) => s.setPendingApprovalCount)

  React.useEffect(() => {
    setPendingApprovalCount(count)
    if (isDesktopShell()) {
      void setDesktopBadgeCount(count)
    }
  }, [count, setPendingApprovalCount])

  React.useEffect(
    () => () => {
      useAttentionStore.getState().setPendingApprovalCount(0)
      if (isDesktopShell()) {
        void setDesktopBadgeCount(0)
      }
    },
    [],
  )

  return null
}

/**
 * Renders one invisible watcher per live session; each fires a native
 * notification when its session waits on a permission request and the user
 * is not already looking at it. Must be mounted inside SyncProvider.
 */
export function PermissionNotifications(): React.ReactNode {
  const sessions = useAllLiveSessions()

  return (
    <>
      <AttentionBadgeSync />
      {sessions.map((session) => (
        <SessionPermissionWatcher
          key={session.id}
          sessionId={session.id}
          sessionTitle={session.title}
          sessionDirectory={(session as { directory?: string | null }).directory ?? undefined}
        />
      ))}
    </>
  )
}
