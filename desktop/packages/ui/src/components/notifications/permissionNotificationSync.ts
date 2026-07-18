import type { PermissionRequest } from "@/types/permission"

export type PermissionNotificationDiff = {
  /** Live requests that have no mirrored notification yet. */
  toAdd: PermissionRequest[]
  /** Mirrored notifications whose request is no longer pending. */
  toRemove: Array<{ requestId: string; notificationId: string }>
}

/**
 * Diff the set of mirrored permission notifications (requestId → notificationId)
 * against the currently pending permission requests for a session. Requests
 * answered elsewhere (e.g. the in-chat permission card) drop out of the sync
 * array, so their mirrored notifications must be removed to keep every item in
 * the notification center actionable.
 */
export const diffPermissionNotifications = (
  seen: ReadonlyMap<string, string>,
  permissions: readonly PermissionRequest[],
): PermissionNotificationDiff => {
  const toAdd = permissions.filter((permission) => !seen.has(permission.id))
  const liveRequestIds = new Set(permissions.map((permission) => permission.id))
  const toRemove: PermissionNotificationDiff["toRemove"] = []
  for (const [requestId, notificationId] of seen) {
    if (!liveRequestIds.has(requestId)) {
      toRemove.push({ requestId, notificationId })
    }
  }
  return { toAdd, toRemove }
}
