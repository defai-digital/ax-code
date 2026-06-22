export type TimeFormatPreference = "auto" | "12h" | "24h"

export type ClockTimeOptions = {
  includeSeconds?: boolean
  fallback?: string
}

const isValidTimestamp = (timestamp: number): boolean => {
  return Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime())
}

const toHour12Option = (preference: TimeFormatPreference): boolean | undefined => {
  if (preference === "12h") return true
  if (preference === "24h") return false
  return undefined
}

export const formatClockTime = (
  timestamp: number | null | undefined,
  preference: TimeFormatPreference,
  options: ClockTimeOptions = {},
): string => {
  const fallback = options.fallback ?? "-"
  if (typeof timestamp !== "number" || !isValidTimestamp(timestamp)) {
    return fallback
  }

  try {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: options.includeSeconds ? "2-digit" : undefined,
      hour12: toHour12Option(preference),
    })
  } catch {
    return fallback
  }
}
