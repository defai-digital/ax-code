import path from "path"
import os from "os"
import fs from "fs/promises"
import { createWriteStream } from "fs"
import pino from "pino"
import { Global } from "../global"
import z from "zod"
import { Glob } from "./glob"
import { withTimeout } from "./timeout"

// Pino instance — only active when logging to file (not stderr).
// Avoids interleaving JSON and text on the same stream.
let pinoLogger: pino.Logger | undefined

export namespace Log {
  const LOG_INIT_IO_TIMEOUT_MS = 1500

  export const Level = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).meta({ ref: "LogLevel", description: "Log level" })
  export type Level = z.infer<typeof Level>

  const STAMPED_LOG_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{6}(?:-\d{3})?(?:-[A-Za-z0-9_-]+)*\.log$/

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
    dir?: string
    name?: string
  }

  export interface InitDeps {
    mkdir?: typeof fs.mkdir
    truncate?: typeof fs.truncate
    open?: typeof fs.open
    cleanup?: (dir: string) => Promise<void> | void
    createWriteStream?: typeof createWriteStream
    stderrWrite?: (msg: string) => unknown
    withTimeout?: typeof withTimeout
    fallbackDir?: string
    tmpDir?: () => string
    ioTimeoutMs?: number
  }

  function stamp(now = new Date()) {
    const [head, fraction = "000Z"] = now.toISOString().split(".")
    const millis = fraction.slice(0, 3)
    return `${head.replace(/:/g, "")}-${millis}`
  }

  function randomSuffix() {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 8)
  }

  export function stampedName(component: string, now = new Date(), unique = randomSuffix()) {
    return `${stamp(now)}-${component}-${unique}`
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
  //
  // Default to noop until Log.init() configures the real destination.
  // The previous default wrote to process.stderr, which leaked log
  // messages into the TUI in compatible mode (main-screen + passthrough).
  let write: (msg: string) => number | Promise<number> = (msg) => {
    return msg.length
  }

  function writeStderr(dep: InitDeps, msg: string) {
    ;(dep.stderrWrite ?? ((line: string) => process.stderr.write(line)))(msg)
  }

  async function closeCurrentStream() {
    if (!currentStream) return
    const prev = currentStream
    currentStream = undefined
    await new Promise<void>((resolve) => {
      prev.end(() => resolve())
    }).catch(() => {})
  }

  async function prepareFileLogPath(options: {
    dir: string
    filename: string
    jsonFilename: string
    dep: InitDeps
  }): Promise<{ path?: string; warning?: string }> {
    const mkdir = options.dep.mkdir ?? fs.mkdir
    const truncate = options.dep.truncate ?? fs.truncate
    const open = options.dep.open ?? fs.open
    const cleanupDir = options.dep.cleanup ?? cleanup
    const withTimeoutFn = options.dep.withTimeout ?? withTimeout
    const ioTimeoutMs = options.dep.ioTimeoutMs ?? LOG_INIT_IO_TIMEOUT_MS
    const fallbackDir = options.dep.fallbackDir ?? path.join((options.dep.tmpDir ?? os.tmpdir)(), "ax-code-log")
    const attempts = [options.dir, ...(path.resolve(fallbackDir) === path.resolve(options.dir) ? [] : [fallbackDir])]
    const failures: string[] = []

    for (const dir of attempts) {
      try {
        await withTimeoutFn(
          mkdir(dir, { recursive: true }).then(() => undefined),
          ioTimeoutMs,
          `log directory init timed out after ${ioTimeoutMs}ms`,
        )
        const next = path.join(dir, options.filename)
        await withTimeoutFn(
          truncate(next).catch(() => undefined),
          ioTimeoutMs,
          `log file init timed out after ${ioTimeoutMs}ms`,
        )
        const json = path.join(dir, options.jsonFilename)
        await withTimeoutFn(
          Promise.all(
            [next, json].map((file) =>
              open(file, "a")
                .then((handle) => handle.close())
                .then(() => undefined),
            ),
          ).then(() => undefined),
          ioTimeoutMs,
          `log file open timed out after ${ioTimeoutMs}ms`,
        )
        void Promise.resolve(cleanupDir(dir)).catch(() => {})
        if (path.resolve(dir) !== path.resolve(options.dir)) {
          return {
            path: next,
            warning: `log dir unavailable: ${options.dir}; falling back to ${dir}`,
          }
        }
        return { path: next }
      } catch (error) {
        failures.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return {
      warning: `log init falling back to stderr (${failures.join("; ")})`,
    }
  }

  export async function init(options: Options, dep: InitDeps = {}) {
    if (options.level) level = options.level
    const pinoLevel = level === "DEBUG" ? "debug" : level === "INFO" ? "info" : level === "WARN" ? "warn" : "error"
    await closeCurrentStream()
    if (options.print) {
      // Print mode: stderr only, no Pino (avoid JSON/text interleaving)
      logpath = ""
      pinoLogger = undefined
      write = (msg) => {
        writeStderr(dep, msg)
        return msg.length
      }
      return
    }
    const name = options.name
      ? `${options.name}.log`
      : options.dev
        ? "dev.log"
        : `${stampedName("runtime")}.log`
    const prepared = await prepareFileLogPath({
      dir: options.dir ?? Global.Path.log,
      filename: name,
      jsonFilename: name.replace(/\.log$/, ".json.log"),
      dep,
    })
    if (prepared.warning) writeStderr(dep, prepared.warning + "\n")
    if (!prepared.path) {
      logpath = ""
      pinoLogger = undefined
      write = (msg) => {
        writeStderr(dep, msg)
        return msg.length
      }
      return
    }
    logpath = prepared.path
    const stream = (dep.createWriteStream ?? createWriteStream)(logpath, { flags: "a" })
    // Attach an error handler so a delayed stream error (disk full,
    // NFS disconnect, FD closed underneath us) doesn't crash the
    // process via Node's default unhandled 'error' behavior. Fall
    // back to stderr so diagnostics keep flowing.
    stream.on("error", (err) => {
      process.stderr.write(`log stream error: ${err.message}\n`)
      stream.destroy()
      write = (msg) => {
        process.stderr.write(msg)
        return msg.length
      }
    })
    currentStream = stream
    // Pino writes to a separate .json.log file to avoid interleaving with text format
    const jsonLogPath = logpath.replace(/\.log$/, ".json.log")
    pinoLogger = pino({ level: pinoLevel }, pino.destination({ dest: jsonLogPath, append: true, sync: false }))
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
    const files = (await Glob.scan("*.log", {
      cwd: dir,
      absolute: true,
      include: "file",
    })).filter((file) => {
      const name = path.basename(file)
      if (name.endsWith(".json.log")) return false
      return STAMPED_LOG_PATTERN.test(name)
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
    // Pino child is created lazily — only when pinoLogger is active (file mode)
    let child: pino.Logger | undefined
    const pino_child = () => child ??= pinoLogger?.child(tags || {})
    const result: Logger = {
      debug(message?: unknown, extra?: Record<string, unknown>) {
        if (shouldLog("DEBUG")) {
          write("DEBUG " + build(message, extra))
          pino_child()?.debug(extra || {}, String(message ?? ""))
        }
      },
      info(message?: unknown, extra?: Record<string, unknown>) {
        if (shouldLog("INFO")) {
          write("INFO  " + build(message, extra))
          pino_child()?.info(extra || {}, String(message ?? ""))
        }
      },
      error(message?: unknown, extra?: Record<string, unknown>) {
        if (shouldLog("ERROR")) {
          write("ERROR " + build(message, extra))
          pino_child()?.error(extra || {}, String(message ?? ""))
        }
      },
      warn(message?: unknown, extra?: Record<string, unknown>) {
        if (shouldLog("WARN")) {
          write("WARN  " + build(message, extra))
          pino_child()?.warn(extra || {}, String(message ?? ""))
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
