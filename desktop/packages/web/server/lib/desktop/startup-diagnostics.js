import crypto from "node:crypto"

const REDACTED = "[redacted]"
const REDACT_KEY_RE = /authorization|cookie|password|secret|token|key/i

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
const asNonEmptyString = (value) => {
  const normalized = typeof value === "string" ? value.trim() : ""
  return normalized.length > 0 ? normalized : null
}

const sanitizeDetails = (value, depth = 0) => {
  if (value === null || value === undefined) return value
  if (depth > 3) return "[truncated]"
  if (typeof value === "string") {
    return value.length > 240 ? `${value.slice(0, 240)}...` : value
  }
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeDetails(entry, depth + 1))
  }
  if (!isPlainObject(value)) return String(value)

  const result = {}
  for (const [key, entry] of Object.entries(value)) {
    result[key] = REDACT_KEY_RE.test(key) ? REDACTED : sanitizeDetails(entry, depth + 1)
  }
  return result
}

const normalizeEvent = (event, fallbackSource, startedAtEpochMs, now) => {
  const name = isPlainObject(event) ? asNonEmptyString(event.name) : null
  if (!name) {
    return null
  }

  const atEpochMs = Number.isFinite(event.atEpochMs) ? event.atEpochMs : now()
  const source = asNonEmptyString(event.source) || fallbackSource

  return {
    name,
    source,
    atEpochMs,
    sinceStartMs: Math.max(0, Math.round(atEpochMs - startedAtEpochMs)),
    details: sanitizeDetails(event.details ?? {}),
  }
}

export const createStartupDiagnosticsRuntime = (options = {}) => {
  const {
    initialSnapshot = null,
    maxEvents = 256,
    now = () => Date.now(),
    source = "web-server",
    onEvent = null,
  } = options

  const startedAtEpochMs = Number.isFinite(initialSnapshot?.startedAtEpochMs) ? initialSnapshot.startedAtEpochMs : now()
  const bootId = asNonEmptyString(initialSnapshot?.bootId) || crypto.randomUUID()

  const events = []
  const seenMilestones = new Set()

  const pushEvent = (event, notify = true) => {
    events.push(event)
    seenMilestones.add(event.name)
    while (events.length > maxEvents) {
      events.shift()
    }
    if (notify && typeof onEvent === "function") {
      try {
        onEvent(event)
      } catch {}
    }
    return event
  }

  if (Array.isArray(initialSnapshot?.events)) {
    for (const candidate of initialSnapshot.events) {
      const event = normalizeEvent(candidate, source, startedAtEpochMs, now)
      if (event) pushEvent(event, false)
    }
  }

  const record = (name, details = {}, eventOptions = {}) => {
    if (!asNonEmptyString(name)) return null
    const event = normalizeEvent(
      {
        name,
        source: eventOptions.source || source,
        atEpochMs: eventOptions.atEpochMs,
        details,
      },
      source,
      startedAtEpochMs,
      now,
    )
    return event ? pushEvent(event, eventOptions.notify !== false) : null
  }

  const markOnce = (name, details = {}, eventOptions = {}) => {
    const milestone = eventOptions.milestone || name
    if (seenMilestones.has(milestone)) return null
    const event = record(name, details, eventOptions)
    if (event) seenMilestones.add(milestone)
    return event
  }

  const mergeSnapshot = (snapshot, eventOptions = {}) => {
    if (!Array.isArray(snapshot?.events)) return
    for (const candidate of snapshot.events) {
      const event = normalizeEvent(candidate, eventOptions.source || source, startedAtEpochMs, now)
      if (event && !seenMilestones.has(event.name)) {
        pushEvent(event, eventOptions.notify !== false)
      }
    }
  }

  const snapshot = (extra = {}) => ({
    bootId,
    startedAtEpochMs,
    startedAt: new Date(startedAtEpochMs).toISOString(),
    generatedAtEpochMs: now(),
    events: [...events],
    ...extra,
  })

  return {
    bootId,
    record,
    markOnce,
    mergeSnapshot,
    snapshot,
  }
}
