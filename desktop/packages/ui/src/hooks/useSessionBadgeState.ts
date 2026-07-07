import React from "react"
import type { SessionStatus } from "@ax-code/sdk/v2/client"
import type { PermissionRequest } from "@/types/permission"
import type { QuestionRequest } from "@/types/question"
import { useSessionHasError } from "@/sync/notification-store"
import { useSessionRunEndedAt } from "@/sync/run-state-store"

export type SessionBadgeState =
  | "idle"
  | "running"
  | "waiting_for_input"
  | "done_with_uncommitted"
  | "error"
  | "unread"

export function computeSessionBadgeState(args: {
  status: SessionStatus | undefined
  permissions: readonly PermissionRequest[]
  questions: readonly QuestionRequest[]
  ranWithUncommitted: boolean
  hasError: boolean
  hasUnreadAttention: boolean
}): SessionBadgeState {
  const { status, permissions, questions, ranWithUncommitted, hasError, hasUnreadAttention } = args

  if (permissions.length > 0 || questions.length > 0) return "waiting_for_input"

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
    questions: readonly QuestionRequest[]
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
        questions: options.questions,
        ranWithUncommitted,
        hasError,
        hasUnreadAttention: options.hasUnreadAttention,
      }),
    [
      options.status,
      options.permissions,
      options.questions,
      ranWithUncommitted,
      hasError,
      options.hasUnreadAttention,
    ],
  )
}
