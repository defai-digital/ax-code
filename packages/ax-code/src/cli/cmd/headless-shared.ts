import path from "node:path"
import type { Argv } from "yargs"
import { bootstrap } from "../bootstrap"
import { internalBaseUrl, isInternalHostname } from "@/util/internal-url"
import { buildAttachAuthHeaders } from "../attach-auth"
import { DEFAULT_SERVER_PORT } from "@/constants/server"
import { assertLoopbackHttpUrl } from "@/util/listen-security"
import { parseIdleTimeoutMs } from "./idle-timeout"
import type { HeadlessEventSink } from "@/runtime/headless"

// Shared plumbing for the headless CLI entry points (headless-run,
// goal resume): working-directory resolution, the attach/local backend
// selection, the inactivity abort guard, and the console event sinks.
// Runtime and server modules stay behind dynamic imports so plain CLI
// startup does not pay for them.

type FetchHandler = (request: Request) => Response | Promise<Response>

function assertInternalUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Internal fetch rejected: unsupported protocol ${url.protocol}`)
  }
  if (!isInternalHostname(url.hostname)) throw new Error(`Internal fetch rejected: ${url.hostname}`)
}

export function createInternalFetch(handler: FetchHandler, headers?: Record<string, string>): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    assertInternalUrl(new URL(request.url))
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        if (!request.headers.has(key)) request.headers.set(key, value)
      }
    }
    return handler(request)
  }) as typeof globalThis.fetch
}

/** Backend options shared by headless-run and goal resume. */
export function headlessBackendOptions<T>(yargs: Argv<T>) {
  return yargs
    .option("attach", {
      describe: `attach to a running ax-code server, e.g. http://localhost:${DEFAULT_SERVER_PORT}`,
      type: "string",
    })
    .option("password", {
      describe: "basic auth password for --attach; defaults to AX_CODE_SERVER_PASSWORD",
      type: "string",
    })
    .option("autonomous", {
      describe: "auto-answer permission/question prompts through the headless effect policy",
      type: "boolean",
      default: true,
    })
    .option("idle-timeout-ms", {
      describe:
        "abort if the headless session emits no events for this long (inactivity timeout — a busy long run keeps resetting it); set 0 to disable",
      type: "number",
      default: 10 * 60 * 1000,
      coerce: parseIdleTimeoutMs,
    })
    .option("event-log", {
      describe: "also write raw headless JSONL events to this file",
      type: "string",
    })
}

/**
 * Resolve the working directory for a headless run. With --attach the dir is
 * passed through unresolved (the server owns path semantics); otherwise a
 * relative --dir is resolved against the caller's cwd and chdir'd into.
 * `target` is the directory the local bootstrap should use.
 */
export function resolveHeadlessWorkdir(
  args: { attach?: string; dir?: string },
  callerCwd: string,
): { directory: string | undefined; target: string } {
  const directory = (() => {
    if (args.attach) return args.dir
    if (!args.dir) return callerCwd
    // @scan-suppress security_scan - The local CLI caller explicitly selects the working directory; arbitrary directories are supported.
    const next = path.resolve(callerCwd, args.dir)
    process.chdir(next)
    return process.cwd()
  })()
  return { directory, target: directory ?? callerCwd }
}

export type HeadlessIdleAbort = {
  abort: AbortController
  onSignal: (signal?: NodeJS.Signals) => void
  arm: () => void
  stop: () => void
  timeoutMs: number | undefined
  readonly timedOut: boolean
  readonly interruptedBy: NodeJS.Signals | undefined
}

/** Conventional 128+signal exit code when a SIGINT/SIGTERM ended the run. */
export function headlessInterruptExitCode(idle: HeadlessIdleAbort): number | undefined {
  if (idle.interruptedBy === "SIGINT") return 130
  if (idle.interruptedBy === "SIGTERM") return 143
  return undefined
}

/**
 * Abort controller plus an inactivity timer, re-armed on every event: a
 * productive multi-hour run (Super-Long, goals) streams events continuously
 * and must not be killed at a fixed deadline, while a genuinely hung session
 * (e.g. a permission ask nobody can answer) goes silent and still aborts.
 */
export function createHeadlessIdleAbort(idleTimeoutMs: number | undefined): HeadlessIdleAbort {
  const abort = new AbortController()
  let interruptedBy: NodeJS.Signals | undefined
  const onSignal = (signal?: NodeJS.Signals) => {
    interruptedBy = interruptedBy ?? signal ?? "SIGINT"
    abort.abort()
  }
  const timeoutMs =
    typeof idleTimeoutMs === "number" && Number.isFinite(idleTimeoutMs) && idleTimeoutMs > 0 ? idleTimeoutMs : undefined
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    if (!timeoutMs) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      timedOut = true
      abort.abort()
    }, timeoutMs)
    timer.unref?.()
  }
  arm()
  return {
    abort,
    onSignal,
    arm,
    timeoutMs,
    stop() {
      if (timer) clearTimeout(timer)
      timer = undefined
    },
    get timedOut() {
      return timedOut
    },
    get interruptedBy() {
      return interruptedBy
    },
  }
}

/** JSONL stdout sink, plus a file sink when --event-log names a path. */
export async function createHeadlessConsoleEventSinks(
  eventLog: string | undefined,
  callerCwd: string,
): Promise<HeadlessEventSink> {
  const { createHeadlessCompositeEventSink, createHeadlessJsonlEventSink } = await import("@/runtime/headless")
  const sinks: HeadlessEventSink[] = [
    createHeadlessJsonlEventSink((line) => {
      process.stdout.write(line)
    }),
  ]
  if (eventLog && eventLog !== "-") {
    const { createHeadlessJsonlFileEventSink } = await import("@/runtime/headless/event-sink-node")
    sinks.push(await createHeadlessJsonlFileEventSink(eventLog, callerCwd))
  }
  return createHeadlessCompositeEventSink(sinks)
}

/** Run fn with SIGINT/SIGTERM wired to the abort guard; always cleans up. */
export async function withHeadlessGuards(idle: HeadlessIdleAbort, fn: () => Promise<void>): Promise<void> {
  process.on("SIGINT", idle.onSignal)
  process.on("SIGTERM", idle.onSignal)
  try {
    await fn()
  } finally {
    idle.stop()
    process.off("SIGINT", idle.onSignal)
    process.off("SIGTERM", idle.onSignal)
  }
}

/**
 * Run against an attached server (--attach, loopback-only) or a local
 * in-process server bootstrapped on the target directory.
 */
export async function withHeadlessBackend(
  args: { attach?: string; password?: string },
  target: string,
  run: (input: { baseUrl: string; fetch: typeof fetch }) => Promise<void>,
): Promise<void> {
  if (args.attach) {
    assertLoopbackHttpUrl(args.attach, "--attach URL")
    const attachUrl = new URL(args.attach)
    assertInternalUrl(attachUrl)
    const headers = buildAttachAuthHeaders(args.password)
    const fetchFn = createInternalFetch((request) => fetch(request), headers)
    await run({ baseUrl: args.attach, fetch: fetchFn })
    return
  }
  const { Server } = await import("@/server/server")
  const { ServerRuntimeAuth } = await import("@/server/runtime-auth")
  await bootstrap(target, async () => {
    const fetchFn = createInternalFetch((request) => {
      ServerRuntimeAuth.apply(request.headers)
      return Server.Default().fetch(request)
    })
    await run({ baseUrl: internalBaseUrl(), fetch: fetchFn })
  })
}
