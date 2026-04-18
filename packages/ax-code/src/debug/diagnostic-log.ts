import fs from "fs/promises"
import { appendFileSync } from "fs"
import path from "path"
import os from "os"
import type { ReplayEvent } from "@/replay/event"

type ConfigureOptions = {
  enabled: boolean
  dir?: string
  includeContent?: boolean
  manifest?: {
    component?: string
    version?: string
    pid?: number
    argv?: string[]
    cwd?: string
  }
}

type RecordMeta = {
  id?: string
  sequence?: number
  time?: number
}

type State = {
  enabled: boolean
  dir: string
  eventsPath: string
  processPath: string
  includeContent: boolean
}

const encoder = new TextEncoder()
const SENSITIVE_LOG_KEYS = new Set([
  "apiKey",
  "authorization",
  "body",
  "content",
  "headers",
  "input",
  "messages",
  "output",
  "prompt",
  "requestBodyValues",
  "responseBody",
  "text",
])
let state: State | undefined
let writeQueue = Promise.resolve()
let processDiagnosticsInstalled = false

export namespace DiagnosticLog {
  export function enabled() {
    return state?.enabled ?? false
  }

  export function dir() {
    return state?.dir
  }

  export async function configure(options: ConfigureOptions) {
    if (!options.enabled || !options.dir) {
      state = undefined
      return
    }

    const dir = path.resolve(options.dir)
    const ready = await fs
      .mkdir(dir, { recursive: true })
      .then(() => true)
      .catch(() => false)
    if (!ready) {
      state = undefined
      return
    }

    state = {
      enabled: true,
      dir,
      eventsPath: path.join(dir, "events.jsonl"),
      processPath: path.join(dir, "process.jsonl"),
      includeContent: options.includeContent === true,
    }

    const manifest = {
      schemaVersion: 1,
      kind: "ax-code-debug-log",
      createdAt: new Date().toISOString(),
      component: options.manifest?.component ?? "main",
      version: options.manifest?.version,
      pid: options.manifest?.pid ?? process.pid,
      cwd: options.includeContent ? options.manifest?.cwd : redactPath(options.manifest?.cwd),
      args: redactArgs(options.manifest?.argv ?? [], state.includeContent),
      includeContent: state.includeContent,
      files: {
        events: "events.jsonl",
        process: "process.jsonl",
      },
    }

    const component = safeFilenamePart(manifest.component)
    const manifestContent = JSON.stringify(manifest, null, 2) + "\n"
    await Promise.all([
      fs.writeFile(path.join(dir, `manifest-${component}-${manifest.pid}.json`), manifestContent),
      fs.writeFile(path.join(dir, `manifest-latest-${component}.json`), manifestContent),
      fs.writeFile(path.join(dir, "manifest-latest.json"), manifestContent),
    ]).catch(() => {})
    recordProcess("configured", { component: manifest.component, version: manifest.version })
  }

  export function record(event: ReplayEvent, meta: RecordMeta = {}) {
    const current = state
    if (!current?.enabled) return

    const time = meta.time ?? Date.now()
    const record = {
      schemaVersion: 1,
      kind: "replay.event",
      time: new Date(time).toISOString(),
      pid: process.pid,
      id: meta.id,
      sequence: meta.sequence,
      sessionID: event.sessionID,
      eventType: event.type,
      event: current.includeContent ? event : redactReplayEvent(event),
    }

    const line = JSON.stringify(record) + "\n"
    writeQueue = writeQueue.then(() => fs.appendFile(current.eventsPath, line)).catch(() => {})
  }

  export async function flush() {
    await writeQueue
  }

  export function recordProcess(eventType: string, data: Record<string, unknown> = {}) {
    const current = state
    if (!current?.enabled) return

    const record = {
      schemaVersion: 1,
      kind: "process.event",
      time: new Date().toISOString(),
      pid: process.pid,
      eventType,
      data: current.includeContent ? data : redactLogValue(data),
    }

    try {
      appendFileSync(current.processPath, JSON.stringify(record) + "\n")
    } catch {
      // Process diagnostics are best-effort and must never crash the app.
    }
  }

  export function installProcessDiagnostics() {
    if (processDiagnosticsInstalled) return
    processDiagnosticsInstalled = true

    process.on("uncaughtExceptionMonitor", (error, origin) => {
      recordProcess("uncaughtException", { origin, error })
    })
    process.on("unhandledRejection", (reason) => {
      recordProcess("unhandledRejection", { reason })
    })
    process.on("warning", (warning) => {
      recordProcess("warning", { warning })
    })
    process.on("exit", (code) => {
      recordProcess("exit", { code })
    })
  }

  export function redactReplayEvent(event: ReplayEvent): Record<string, unknown> {
    const base = { ...event } as Record<string, unknown>

    switch (event.type) {
      case "session.start":
        return {
          ...base,
          directory: redactPath(event.directory),
        }
      case "llm.output":
        return {
          ...base,
          parts: event.parts.map((part) => {
            if (part.type === "text" || part.type === "reasoning") {
              return {
                ...part,
                text: redactText(part.text),
              }
            }
            return {
              ...part,
              input: redactValue(part.input),
            }
          }),
        }
      case "tool.call":
        return {
          ...base,
          input: redactValue(event.input),
        }
      case "tool.result":
        return {
          ...base,
          output: redactText(event.output),
          error: redactText(event.error),
          metadata: redactLogValue(event.metadata),
        }
      case "permission.ask":
        return {
          ...base,
          patterns: {
            redacted: true,
            count: event.patterns.length,
          },
        }
      case "error":
        return {
          ...base,
          message: redactText(event.message),
        }
      default:
        return base
    }
  }

  export function redactForLog(input: unknown): unknown {
    return redactLogValue(input)
  }
}

function redactLogValue(input: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (input === null || input === undefined) return input
  if (typeof input !== "object") return input
  if (seen.has(input)) return "[Circular]"
  if (depth > 8) return "[MaxDepth]"
  seen.add(input)

  if (input instanceof Error) {
    const result: Record<string, unknown> = {
      name: input.name,
      message: input.message,
    }
    if (input.stack) result.stack = redactStack(input.stack)
    for (const key of Object.getOwnPropertyNames(input)) {
      if (key === "name" || key === "message" || key === "stack") continue
      const value = (input as unknown as Record<string, unknown>)[key]
      if (key === "url" && typeof value === "string") {
        result[key] = redactUrl(value)
        continue
      }
      result[key] = SENSITIVE_LOG_KEYS.has(key) ? redactValue(value) : redactLogValue(value, seen, depth + 1)
    }
    return result
  }

  if (Array.isArray(input)) {
    return input.slice(0, 20).map((item) => redactLogValue(item, seen, depth + 1))
  }

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(input)) {
    const value = (input as Record<string, unknown>)[key]
    if (key === "url" && typeof value === "string") {
      result[key] = redactUrl(value)
      continue
    }
    result[key] = SENSITIVE_LOG_KEYS.has(key) ? redactValue(value) : redactLogValue(value, seen, depth + 1)
  }
  return result
}

function redactArgs(args: string[], includeContent: boolean) {
  if (includeContent) return args
  let keptCommand = false
  return args.map((arg) => {
    if (arg.startsWith("-") && arg.includes("=")) return arg.replace(/=.*/, "=<arg>")
    if (arg.startsWith("-")) return arg
    if (!keptCommand) {
      keptCommand = true
      return arg
    }
    return "<arg>"
  })
}

function redactPath(input?: string) {
  if (!input) return undefined
  return {
    redacted: true,
    basename: path.basename(input),
  }
}

function redactText(input?: string) {
  if (input === undefined) return undefined
  return {
    redacted: true,
    bytes: encoder.encode(input).byteLength,
  }
}

function redactValue(input: unknown) {
  const json = safeStringify(input)
  return {
    redacted: true,
    type: Array.isArray(input) ? "array" : typeof input,
    keys: input && typeof input === "object" && !Array.isArray(input) ? Object.keys(input).sort() : undefined,
    bytes: json ? encoder.encode(json).byteLength : undefined,
  }
}

function safeStringify(input: unknown) {
  try {
    return JSON.stringify(input)
  } catch {
    return undefined
  }
}

function redactUrl(input: string) {
  try {
    const url = new URL(input)
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return input
  }
}

function safeFilenamePart(input: string) {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-")
}

function redactStack(input: string) {
  return input.replaceAll(process.cwd(), "<cwd>").replaceAll(os.homedir(), "<home>")
}
