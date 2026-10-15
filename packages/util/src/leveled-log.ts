// Minimal leveled logger shared by @ax-code/ax-code-intel and
// @ax-code/ax-code-reason. Those packages must not depend on the core logging
// stack, so entries go to stderr by default and a host routes them into its own
// logger through the package's public `setLogSink` facade (core does that in
// src/lsp-glue.ts and src/dre-glue.ts).
//
// One runtime per package: the sink is per-instance state, so intel and reason
// each hold their own instead of sharing a module-level sink.

export namespace LeveledLog {
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

  export type Runtime = {
    setSink(next: Sink | undefined): void
    create(input: { service: string }, tags?: Record<string, string>): Logger
  }

  const levelRank: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

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

  /** `levelEnv` names the environment variable that raises or lowers the stderr threshold. */
  export function createRuntime(options: { levelEnv: string }): Runtime {
    let sink: Sink | undefined

    function threshold(): number {
      const configured = process.env[options.levelEnv]?.toUpperCase()
      if (configured === "DEBUG") return levelRank.debug
      if (configured === "WARN") return levelRank.warn
      if (configured === "ERROR") return levelRank.error
      return levelRank.info
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

    function create(input: { service: string }, tags: Record<string, string> = {}): Logger {
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

    return {
      setSink: (next) => {
        sink = next
      },
      create,
    }
  }
}
