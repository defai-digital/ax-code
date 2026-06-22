"use strict"

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

const REDACTED = "[redacted]"
const REDACT_KEY_RE = /authorization|cookie|password|secret|token|key/i

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function sanitizeDetails(value, depth = 0) {
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

function createStartupDiagnostics(options = {}) {
  const bootId = options.bootId || crypto.randomUUID()
  const startedAtEpochMs = Date.now()
  const source = options.source || "electron-main"
  const logPath = options.logPath
  const maxEvents = options.maxEvents || 256
  const events = []
  const seenMilestones = new Set()

  function appendLog(event) {
    if (!logPath) return
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true })
      fs.appendFile(logPath, `[startup] ${JSON.stringify(event)}\n`, () => {})
    } catch {}
  }

  function normalizeEvent(name, details = {}, eventOptions = {}) {
    if (typeof name !== "string" || name.trim().length === 0) return null
    const atEpochMs = Number.isFinite(eventOptions.atEpochMs) ? eventOptions.atEpochMs : Date.now()
    return {
      name: name.trim(),
      source:
        typeof eventOptions.source === "string" && eventOptions.source.trim().length > 0
          ? eventOptions.source.trim()
          : source,
      atEpochMs,
      sinceStartMs: Math.max(0, Math.round(atEpochMs - startedAtEpochMs)),
      details: sanitizeDetails(details),
    }
  }

  function record(name, details = {}, eventOptions = {}) {
    const event = normalizeEvent(name, details, eventOptions)
    if (!event) return null
    events.push(event)
    seenMilestones.add(event.name)
    while (events.length > maxEvents) events.shift()
    appendLog(event)
    return event
  }

  function markOnce(name, details = {}, eventOptions = {}) {
    const milestone = eventOptions.milestone || name
    if (seenMilestones.has(milestone)) return null
    const event = record(name, details, eventOptions)
    if (event) seenMilestones.add(milestone)
    return event
  }

  function snapshot() {
    return {
      bootId,
      startedAtEpochMs,
      startedAt: new Date(startedAtEpochMs).toISOString(),
      generatedAtEpochMs: Date.now(),
      events: [...events],
    }
  }

  return {
    bootId,
    record,
    markOnce,
    snapshot,
    logPath,
  }
}

module.exports = {
  createStartupDiagnostics,
}
