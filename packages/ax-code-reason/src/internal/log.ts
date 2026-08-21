// Minimal leveled logger for @ax-code/ax-code-reason.
//
// The package must not depend on the core logging stack, so this writes to
// stderr by default. Hosts can route entries into their own logger via
// Log.setSink() (the ax-code core glue routes them into its Log namespace).

export namespace Log {
  export type Extra = Record<string, unknown>
  export type Level = "debug" | "info" | "warn" | "error"

  export type Logger = {
    debug(message?: unknown, extra?: Extra): void
    info(message?: unknown, extra?: Extra): void
    warn(message?: unknown, extra?: Extra): void
    error(message?: unknown, extra?: Extra): void
    tag(key: string, value: string): Logger
    clone(): Logger
  }

  export type Sink = (level: Level, service: string, message: unknown, extra?: Extra) => void

  let sink: Sink | undefined

  export function setSink(next: Sink | undefined): void {
    sink = next
  }

  const levelRank: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

  function threshold(): number {
    const configured = process.env.AX_CODEINTEL_LOG_LEVEL?.toUpperCase()
    if (configured === "DEBUG") return levelRank.debug
    if (configured === "WARN") return levelRank.warn
    if (configured === "ERROR") return levelRank.error
    return levelRank.info
  }

  function stringify(message: unknown): string {
    if (typeof message === "string") return message
    if (message === undefined) return ""
    try {
      return JSON.stringify(message)
    } catch {
      return String(message)
    }
  }

  function safeExtra(extra: Extra): string {
    try {
      return JSON.stringify(extra)
    } catch {
      return "[unserializable]"
    }
  }

  function emit(level: Level, service: string, message: unknown, extra?: Extra): void {
    if (sink) {
      sink(level, service, message, extra)
      return
    }
    if (levelRank[level] < threshold()) return
    const text = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${service}] ${stringify(message)}${
      extra ? ` ${safeExtra(extra)}` : ""
    }`
    process.stderr.write(text + "\n")
  }

  export function create(input: { service: string }, tags: Record<string, string> = {}): Logger {
    const withTags = (extra?: Extra): Extra | undefined => {
      if (Object.keys(tags).length === 0) return extra
      return { ...tags, ...extra }
    }
    return {
      debug: (message, extra) => emit("debug", input.service, message, withTags(extra)),
      info: (message, extra) => emit("info", input.service, message, withTags(extra)),
      warn: (message, extra) => emit("warn", input.service, message, withTags(extra)),
      error: (message, extra) => emit("error", input.service, message, withTags(extra)),
      tag: (key, value) => create(input, { ...tags, [key]: value }),
      clone: () => create(input, { ...tags }),
    }
  }
}
