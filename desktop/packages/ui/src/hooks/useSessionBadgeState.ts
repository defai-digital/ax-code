import React from "react"
import type { SessionStatus } from "@ax-code/sdk/v2/client"
import type { PermissionRequest } from "@/types/permission"
import { useSessionHasError } from "@/sync/notification-store"
import { useSessionRunEndedAt } from "@/sync/run-state-store"

export type SessionBadgeState =
  | "idle"
  | "running"
  | "waiting_for_permission"
  | "done_with_uncommitted"
  | "error"
  | "unread"

export function computeSessionBadgeState(args: {
  status: SessionStatus | undefined
  permissions: readonly PermissionRequest[]
  ranWithUncommitted: boolean
  hasError: boolean
  hasUnreadAttention: boolean
}): SessionBadgeState {
  const { status, permissions, ranWithUncommitted, hasError, hasUnreadAttention } = args

  if (permissions.length > 0) return "waiting_for_permission"

  const type = status?.type ?? "idle"
  if (type === "busy" || type === "retry") return "running"

  if (hasError) return "error"

  if (ranWithUncommitted) return "done_with_uncommitted"

  if (hasUnreadAttention) return "unread"

  return "idle"
}

/**
 * Canonical per-session badge state for sidebar/switcher rows. Wires the
 * error state from the notification store and scopes "done with uncommitted
 * changes" to sessions whose agent actually finished a run this app session
 * — a dirty directory alone (shared by sibling sessions) is not enough.
 */
export function useSessionBadgeState(
  sessionId: string,
  options: {
    status: SessionStatus | undefined
    permissions: readonly PermissionRequest[]
    isDirty: boolean
    hasUnreadAttention: boolean
  },
): SessionBadgeState {
  const hasError = useSessionHasError(sessionId)
  const runEndedAt = useSessionRunEndedAt(sessionId)
  const ranWithUncommitted = options.isDirty && runEndedAt !== null

  return React.useMemo(
    () =>
      computeSessionBadgeState({
        status: options.status,
        permissions: options.permissions,
        ranWithUncommitted,
        hasError,
        hasUnreadAttention: options.hasUnreadAttention,
      }),
    [options.status, options.permissions, ranWithUncommitted, hasError, options.hasUnreadAttention],
  )
}
