import { relativeTimeParts } from "@/components/session/scheduledTaskRelativeTime"

export type ProjectReadiness = "ready" | "unknown"

type Translate = (key: string, params?: Record<string, string | number>) => string

/**
 * Format a project last-opened timestamp for UI (Codex-style "Last used …").
 * Returns null when there is no usable timestamp.
 */
export function formatProjectLastUsed(
  lastOpenedAt: number | undefined,
  // Accept both strict dictionary-keyed translators and plain string-key helpers.
  t: Translate | ((key: never, params?: never) => string),
  now: number = Date.now(),
): string | null {
  if (typeof lastOpenedAt !== "number" || !Number.isFinite(lastOpenedAt) || lastOpenedAt <= 0) {
    return null
  }

  const translate = t as Translate
  const parts = relativeTimeParts(lastOpenedAt, now)
  switch (parts.kind) {
    case "empty":
      return null
    case "seconds":
      return translate("projects.home.lastUsed.justNow")
    case "minutes":
      return translate("projects.home.lastUsed.minutesAgo", { count: parts.count })
    case "duration":
      return translate("projects.home.lastUsed.durationAgo", { duration: parts.body })
    default:
      return null
  }
}
