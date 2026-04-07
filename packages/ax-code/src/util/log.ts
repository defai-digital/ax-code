import path from "path"
import fs from "fs/promises"
import { createWriteStream } from "fs"
import pino from "pino"
import { Global } from "../global"
import z from "zod"
import { Glob } from "./glob"

// Pino instance — initialized lazily via init(). Before init, logs go to stderr.
let pinoLogger: pino.Logger = pino({ level: "debug" }, pino.destination(2)) // fd 2 = stderr

export namespace Log {
  export const Level = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).meta({ ref: "LogLevel", description: "Log level" })
  export type Level = z.infer<typeof Level>

  const levelPriority: Record<Level, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  }

  let level: Level = "INFO"

  function shouldLog(input: Level): boolean {
    return levelPriority[input] >= levelPriority[level]
  }

  export type Logger = {
    debug(message?: unknown, extra?: Record<string, unknown>): void
    info(message?: unknown, extra?: Record<string, unknown>): void
    error(message?: unknown, extra?: Record<string, unknown>): void
    warn(message?: unknown, extra?: Record<string, unknown>): void
    tag(key: string, value: string): Logger
    clone(): Logger
    time(
      message: string,
      extra?: Record<string, unknown>,
    ): {
      stop(): void
      [Symbol.dispose](): void
    }
  }

  const loggers = new Map<string, Logger>()

  export const Default = create({ service: "default" })

  export interface Options {
    print: boolean
    dev?: boolean
    level?: Level
  }

  let logpath = ""
  export function file() {
    return logpath
  }
  let currentStream: ReturnType<typeof createWriteStream> | undefined
  // Low-level write used by every logger method. Must never throw or
  // return a rejected promise — the logger call sites invoke `write`
  // without awaiting, so a rejection would become an unhandled promise
  // rejection and pollute test output / crash on `unhandledRejection`.
  let write: (msg: string) => number | Promise<number> = (msg) => {
    process.stderr.write(msg)
    return msg.length
  }

  export async function init(options: Options) {
    if (options.level) level = options.level
    // Update Pino log level to match
    const pinoLevel = level === "DEBUG" ? "debug" : level === "INFO" ? "info" : level === "WARN" ? "warn" : "error"
    pinoLogger.level = pinoLevel
    cleanup(Global.Path.log)
    if (options.print) return
    logpath = path.join(
      Global.Path.log,
      options.dev ? "dev.log" : new Date().toISOString().split(".")[0].replace(/:/g, "") + ".log",
    )
    await fs.truncate(logpath).catch(() => {})
    // Drain and close the previous stream before opening a new one.
    // Without this, every init() (e.g. after a worker reload) leaks
    // a file descriptor AND loses any log lines still in the old
    // stream's buffer. Await the finish event so pending writes
    // actually flush to disk before the stream is dropped.
    if (currentStream) {
      const prev = currentStream
      await new Promise<void>((resolve) => {
        prev.end(() => resolve())
      }).catch(() => {})
    }
    const stream = createWriteStream(logpath, { flags: "a" })
    // Attach an error handler so a delayed stream error (disk full,
    // NFS disconnect, FD closed underneath us) doesn't crash the
    // process via Node's default unhandled 'error' behavior. Fall
    // back to stderr so diagnostics keep flowing.
    stream.on("error", (err) => {
      process.stderr.write(`log stream error: ${err.message}\n`)
      write = (msg) => {
        process.stderr.write(msg)
        return msg.length
      }
    })
    currentStream = stream
    // Re-create Pino with file destination for JSON structured logging
    pinoLogger = pino({ level: pinoLevel }, pino.destination({ dest: logpath, append: true, sync: false }))
    write = (msg: string) => {
      // Fast path: if the stream was already ended (by a concurrent
      // re-init, or by Node during shutdown) don't even attempt the
      // write — `writable` is false on ended streams and attempting
      // `.write()` would emit ERR_STREAM_WRITE_AFTER_END. Fall back
      // to stderr so the message still lands somewhere.
      if (!stream.writable) {
        process.stderr.write(msg)
        return msg.length
      }
      return new Promise<number>((resolve) => {
        stream.write(msg, (err) => {
          if (err) {
            // Swallow: callers don't await, so a rejection would be
            // unhandled. Write-after-end is the common case during
            // worker reload and test teardown; log the message to
            // stderr as a fallback.
            process.stderr.write(msg)
            resolve(msg.length)
            return
          }
          resolve(msg.length)
        })
      })
    }
  }

  async function cleanup(dir: string) {
    const files = await Glob.scan("????-??-??T??????.log", {
      cwd: dir,
      absolute: true,
      include: "file",
    })
    if (files.length <= 5) return

    const filesToDelete = files.slice(0, -5)
    await Promise.all(filesToDelete.map((file) => fs.unlink(file).catch(() => {})))
  }

  function formatError(error: Error, depth = 0): string {
    const result = error.message
    return error.cause instanceof Error && depth < 10
      ? result + " Caused by: " + formatError(error.cause, depth + 1)
      : result
  }

  let last = Date.now()
  export function create(tags?: Record<string, any>) {
    tags = tags || {}

    const service = tags["service"]
    if (service && typeof service === "string") {
      const cached = loggers.get(service)
      if (cached) {
        return cached
      }
    }

    function build(message: unknown, extra?: Record<string, unknown>) {
      const prefix = Object.entries({
        ...tags,
        ...extra,
      })
        .filter(([_, value]) => value !== undefined && value !== null)
        .map(([key, value]) => {
          const prefix = `${key}=`
          if (value instanceof Error) return prefix + formatError(value)
          if (typeof value === "object") return prefix + JSON.stringify(value)
          return prefix + value
        })
        .join(" ")
      const next = new Date()
      const diff = next.getTime() - last
      last = next.getTime()
      return [next.toISOString().split(".")[0], "+" + diff + "ms", prefix, message].filter(Boolean).join(" ") + "\n"
    }
    const child = pinoLogger.child(tags || {})
    const result: Logger = {
      debug(message?: unknown, extra?: Record<string, unknown>) {
        if (shouldLog("DEBUG")) {
          write("DEBUG " + build(message, extra))
          child.debug(extra || {}, String(message ?? ""))
        }
      },
      info(message?: unknown, extra?: Record<string, unknown>) {
        if (shouldLog("INFO")) {
          write("INFO  " + build(message, extra))
          child.info(extra || {}, String(message ?? ""))
        }
      },
      error(message?: unknown, extra?: Record<string, unknown>) {
        if (shouldLog("ERROR")) {
          write("ERROR " + build(message, extra))
          child.error(extra || {}, String(message ?? ""))
        }
      },
      warn(message?: unknown, extra?: Record<string, unknown>) {
        if (shouldLog("WARN")) {
          write("WARN  " + build(message, extra))
          child.warn(extra || {}, String(message ?? ""))
        }
      },
      tag(key: string, value: string) {
        tags = { ...tags, [key]: value }
        return result
      },
      clone() {
        return Log.create({ ...tags })
      },
      time(message: string, extra?: Record<string, any>) {
        const now = Date.now()
        result.info(message, { status: "started", ...extra })
        function stop() {
          result.info(message, {
            status: "completed",
            duration: Date.now() - now,
            ...extra,
          })
        }
        return {
          stop,
          [Symbol.dispose]() {
            stop()
          },
        }
      },
    }

    if (service && typeof service === "string") {
      loggers.set(service, result)
    }

    return result
  }
}
