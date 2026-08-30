/**
 * Global session event fan-out (SPEC-2026-08-30, S4.4).
 *
 * The event pipeline delivers `session.created` / `session.updated` /
 * `session.deleted` for EVERY directory the runtime serves — including
 * directories that have no per-directory child store (those events used to
 * be dropped by `handleEvent`). This module is the single funnel that
 * forwards them to `useGlobalSessionsStore`, which owns the global
 * active/archived session index.
 *
 * During the dual-source transition the manual writes in
 * `session-actions.ts` / `soft-removal.ts` stay in place as OPTIMISTIC
 * writes; the event is the reconcile authority. To validate the upcoming
 * S4.5 removal of those writes, a dev-mode diff logger reports — before
 * application — whenever an event would actually change the store entry
 * (i.e. the optimistic writes did not already cover it). No-op events
 * (signature-equal, stale, pending-removal-guarded) stay silent.
 */

import type { Event } from "@ax-code/sdk/v2/client"
import type { Session } from "@ax-code/sdk/v2"
import {
  isSessionLifecycleEventType,
  planSessionLifecycleEvent,
  resolveGlobalSessionDirectory,
  useGlobalSessionsStore,
  type SessionLifecyclePlan,
} from "@/stores/useGlobalSessionsStore"

const formatDiffValue = (value: unknown): string => {
  if (value === undefined || value === null || value === "") return "<empty>"
  return String(value)
}

/** Fields mirrored by the store's session signature, rendered for the diff. */
const DIFF_FIELDS: ReadonlyArray<{ label: string; read: (session: Session) => unknown }> = [
  { label: "title", read: (session) => session.title ?? "" },
  { label: "time.created", read: (session) => session.time?.created ?? 0 },
  { label: "time.updated", read: (session) => session.time?.updated ?? 0 },
  { label: "time.archived", read: (session) => session.time?.archived ?? 0 },
  { label: "share.url", read: (session) => session.share?.url ?? "" },
  { label: "directory", read: (session) => resolveGlobalSessionDirectory(session) ?? "" },
]

/**
 * One-line description of how a planned event would change the store entry,
 * or null when the event is a no-op (nothing to log).
 */
export const describeSessionEventDiff = (plan: SessionLifecyclePlan): string | null => {
  switch (plan.kind) {
    case "delete":
      return "present -> deleted"
    case "upsert": {
      if (!plan.current) return "absent -> present"
      const changes = DIFF_FIELDS.filter((field) => field.read(plan.current!) !== field.read(plan.session)).map(
        (field) =>
          `${field.label}: ${formatDiffValue(field.read(plan.current!))} -> ${formatDiffValue(field.read(plan.session))}`,
      )
      return changes.length > 0 ? changes.join(", ") : null
    }
    default:
      // invalid / pending-removal / stale / unchanged — the store does not
      // change, so there is no divergence to report.
      return null
  }
}

/**
 * Forward one pipeline event to the global sessions store. Cheap: only
 * session lifecycle types do any work; every other event returns
 * immediately. Safe to call for all directories and all branches of
 * `handleEvent` — the store action shape-validates the payload and keeps
 * referential stability for no-op events.
 */
export const applySessionLifecycleEventToGlobalStore = (payload: Event): void => {
  const type = (payload as { type?: unknown }).type
  if (!isSessionLifecycleEventType(type)) return

  if (import.meta.env.DEV) {
    const plan = planSessionLifecycleEvent(useGlobalSessionsStore.getState(), payload)
    const summary = describeSessionEventDiff(plan)
    if (summary && plan.kind !== "invalid") {
      console.debug(`[GlobalSessions] event ${type} ${plan.session.id}: ${summary}`)
    }
  }

  useGlobalSessionsStore.getState().applySessionEvent(payload)
}
