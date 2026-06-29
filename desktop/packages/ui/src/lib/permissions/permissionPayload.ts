const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const normalizePermissionName = (permission: unknown): string =>
  typeof permission === "string" && permission.trim() ? permission : "unknown"

export const normalizePermissionPatterns = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => normalizePermissionPatterns(entry))
      .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index)
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed ? [trimmed] : []
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)]
  }

  if (isRecord(value)) {
    const candidates = [value.pattern, value.path, value.glob, value.value, value.id]
    for (const candidate of candidates) {
      const normalized = normalizePermissionPatterns(candidate)
      if (normalized.length > 0) return normalized
    }
  }

  return []
}

export const getPermissionPatterns = (permission: { patterns?: unknown; metadata?: Record<string, unknown> }): string[] =>
  normalizePermissionPatterns(permission.patterns)

export const getPermissionAlwaysPatterns = (permission: {
  always?: unknown
  metadata?: Record<string, unknown>
}): string[] => {
  const always = normalizePermissionPatterns(permission.always)
  if (always.length > 0) return always
  return normalizePermissionPatterns(permission.metadata?.always)
}
