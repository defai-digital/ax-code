const REDACTED = "[REDACTED]"
const SECRET_KEY =
  /(?:(?:api|access).?key|secret|password|passphrase|token(?:[_-]?(?:id|value))?$|authorization|cookie|credential|private.?key|^key$|^access$|^refresh$)/i
const PRIVATE_CONTAINER = /^(?:headers|env|environment|command|commands)$/i

function redactUrls(text: string): string {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (candidate) => {
    try {
      const url = new URL(candidate)
      if (!url.username && !url.password && !url.search && !url.hash) return candidate
      if (url.username || url.password) {
        url.username = REDACTED
        url.password = ""
      }
      // Custom providers can name credential parameters arbitrarily. Keep
      // parameter names for diagnosis, but never publish their values.
      // The local set and URL are bounded by one input string and discarded after redaction.
      for (const key of new Set(url.searchParams.keys())) url.searchParams.set(key, REDACTED)
      if (url.hash) url.hash = REDACTED
      return url.toString()
    } catch {
      // A malformed URL may still contain credentials; do not echo it back.
      return REDACTED
    }
  })
}

/** A detached diagnostic view, never a mutation of the effective config. */
export function redactConfig(value: unknown): unknown {
  if (typeof value === "string") return redactUrls(value)
  if (Array.isArray(value)) return value.map(redactConfig)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) || PRIVATE_CONTAINER.test(key) ? REDACTED : redactConfig(item),
    ]),
  )
}
