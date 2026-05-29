import { startHeadlessBackend, type HeadlessBackendHandle, type HeadlessBackendOptions } from "@ax-code/sdk/headless"
import type { DesktopBackendPlan } from "./sidecar-plan"
import { loadDesktopSidecarEnvironment } from "./shell-env"

export type DesktopBackendStatus = "idle" | "starting" | "running" | "failed" | "closed"

export type DesktopBackendLogLine = {
  stream: "stdout" | "stderr" | "system"
  line: string
  time: number
}

export type DesktopBackendConnection = {
  url: string
  headers: Record<string, string>
  mode: DesktopBackendPlan["mode"]
  loopbackOnly: boolean
  generatedAuth: boolean
  directory?: string
}

export type DesktopBackendDiagnostics = {
  status: DesktopBackendStatus
  mode?: DesktopBackendPlan["mode"]
  url?: string
  loopbackOnly?: boolean
  generatedAuth?: boolean
  startedAt?: number
  stoppedAt?: number
  error?: string
  logs: DesktopBackendLogLine[]
}

export type StartHeadlessBackend = (options: HeadlessBackendOptions) => Promise<HeadlessBackendHandle>
export type DesktopBackendFetch = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>

export type DesktopBackendManagerOptions = {
  startBackend?: StartHeadlessBackend
  fetch?: DesktopBackendFetch
  attachHealthTimeoutMs?: number
  now?: () => number
  maxLogLines?: number
  sidecarEnv?: () => Record<string, string> | undefined
}

const DEFAULT_ATTACH_HEALTH_TIMEOUT_MS = 10_000

type OpenedDesktopBackend = {
  connection: DesktopBackendConnection
  handle?: HeadlessBackendHandle
  logLine: string
}

export class DesktopBackendManager {
  private readonly startBackend: StartHeadlessBackend
  private readonly fetch: DesktopBackendFetch
  private readonly attachHealthTimeoutMs: number
  private readonly now: () => number
  private readonly maxLogLines: number
  private readonly sidecarEnv: () => Record<string, string> | undefined
  private status: DesktopBackendStatus = "idle"
  private mode: DesktopBackendPlan["mode"] | undefined
  private handle: HeadlessBackendHandle | undefined
  private connection: DesktopBackendConnection | undefined
  private startedAt: number | undefined
  private stoppedAt: number | undefined
  private error: string | undefined
  private logs: DesktopBackendLogLine[] = []

  constructor(options: DesktopBackendManagerOptions = {}) {
    this.startBackend = options.startBackend ?? startHeadlessBackend
    this.fetch = options.fetch ?? fetch
    this.attachHealthTimeoutMs = positiveFiniteNumber(options.attachHealthTimeoutMs) ?? DEFAULT_ATTACH_HEALTH_TIMEOUT_MS
    this.now = options.now ?? Date.now
    this.maxLogLines = options.maxLogLines ?? 400
    this.sidecarEnv = options.sidecarEnv ?? loadDesktopSidecarEnvironment
  }

  async connect(plan: DesktopBackendPlan): Promise<DesktopBackendConnection> {
    if (this.status === "starting") throw new Error("AX Code backend is already starting")
    if (this.status === "running") throw new Error("AX Code backend is already connected")

    this.status = "starting"
    this.mode = plan.mode
    this.error = undefined
    this.stoppedAt = undefined
    this.startedAt = this.now()
    this.pushLog("system", `backend ${plan.mode} requested`)

    try {
      const opened = await this.openConnection(plan)
      this.applyOpenedConnection(opened)
      return opened.connection
    } catch (cause) {
      this.status = "failed"
      this.error = cause instanceof Error ? cause.message : String(cause)
      this.pushLog("system", `backend ${plan.mode} failed: ${this.error}`)
      throw cause
    }
  }

  async reconnect(plan: DesktopBackendPlan): Promise<DesktopBackendConnection> {
    if (this.status === "starting") throw new Error("AX Code backend is already starting")
    if (this.status !== "running" || !this.connection) return this.connect(plan)

    const previous = {
      handle: this.handle,
      connection: this.connection,
      mode: this.mode,
      startedAt: this.startedAt,
    }

    this.status = "starting"
    this.mode = plan.mode
    this.error = undefined
    this.stoppedAt = undefined
    this.startedAt = this.now()
    this.pushLog("system", `backend ${plan.mode} requested`)

    let opened: OpenedDesktopBackend
    try {
      opened = await this.openConnection(plan)
    } catch (cause) {
      this.handle = previous.handle
      this.connection = previous.connection
      this.mode = previous.mode
      this.startedAt = previous.startedAt
      this.status = "running"
      this.error = cause instanceof Error ? cause.message : String(cause)
      this.pushLog("system", `backend ${plan.mode} failed: ${this.error}`)
      throw cause
    }

    try {
      await this.closeOpenedConnection(previous)
    } catch (cause) {
      await this.closeOpenedConnection(opened).catch((cleanupCause) => {
        const cleanupError = cleanupCause instanceof Error ? cleanupCause.message : String(cleanupCause)
        this.pushLog("system", `new backend cleanup failed: ${cleanupError}`)
      })
      this.handle = previous.handle
      this.connection = previous.connection
      this.mode = previous.mode
      this.startedAt = previous.startedAt
      this.status = "running"
      this.error = cause instanceof Error ? cause.message : String(cause)
      this.pushLog("system", `backend close failed: ${this.error}`)
      throw cause
    }

    this.applyOpenedConnection(opened)
    return opened.connection
  }

  recordStartupFailure(mode: DesktopBackendPlan["mode"], cause: unknown) {
    this.handle = undefined
    this.connection = undefined
    this.mode = mode
    this.status = "failed"
    this.error = cause instanceof Error ? cause.message : String(cause)
    this.startedAt = this.startedAt ?? this.now()
    this.stoppedAt = this.now()
    this.pushLog("system", `backend ${mode} failed: ${this.error}`)
  }

  getConnection(): DesktopBackendConnection | undefined {
    if (!this.connection) return undefined
    return {
      ...this.connection,
      headers: { ...this.connection.headers },
    }
  }

  diagnostics(): DesktopBackendDiagnostics {
    return {
      status: this.status,
      mode: this.mode,
      url: this.connection?.url,
      loopbackOnly: this.connection?.loopbackOnly,
      generatedAuth: this.connection?.generatedAuth,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      error: this.error,
      logs: [...this.logs],
    }
  }

  exportLogs() {
    return this.logs.map((log) => `${new Date(log.time).toISOString()} [${log.stream}] ${log.line}`).join("\n")
  }

  recordSystemLog(line: string) {
    this.pushLog("system", line)
  }

  async close() {
    const current = {
      handle: this.handle,
      connection: this.connection,
    }
    this.handle = undefined
    this.connection = undefined
    this.stoppedAt = this.now()

    try {
      await this.closeOpenedConnection(current)
      this.error = undefined
      this.status = "closed"
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause)
      this.status = "failed"
      this.pushLog("system", `backend close failed: ${this.error}`)
      throw cause
    }
  }

  private pushLog(stream: DesktopBackendLogLine["stream"], line: string) {
    this.logs.push({ stream, line, time: this.now() })
    if (this.logs.length > this.maxLogLines) this.logs.splice(0, this.logs.length - this.maxLogLines)
  }

  private async openConnection(plan: DesktopBackendPlan): Promise<OpenedDesktopBackend> {
    if (plan.mode === "attach") {
      await assertAttachHealth({
        baseUrl: plan.baseUrl,
        headers: plan.headers,
        fetch: this.fetch,
        timeoutMs: this.attachHealthTimeoutMs,
      })
      return {
        connection: {
          url: plan.baseUrl,
          headers: plan.headers,
          mode: "attach",
          loopbackOnly: plan.loopbackOnly,
          generatedAuth: plan.generatedAuth,
        },
        logLine: `attached to ${plan.baseUrl}`,
      }
    }

    const handle = await this.startBackend({
      ...plan.options,
      env: {
        ...this.sidecarEnv(),
        ...plan.options.env,
      },
      onStdout: (line) => {
        this.pushLog("stdout", line)
        plan.options.onStdout?.(line)
      },
      onStderr: (line) => {
        this.pushLog("stderr", line)
        plan.options.onStderr?.(line)
      },
    })
    return {
      handle,
      connection: {
        url: handle.url,
        headers: handle.headers,
        mode: "start",
        loopbackOnly: plan.loopbackOnly,
        generatedAuth: plan.generatedAuth,
        directory: plan.options.directory,
      },
      logLine: `started backend at ${handle.url}`,
    }
  }

  private applyOpenedConnection(opened: OpenedDesktopBackend) {
    this.handle = opened.handle
    this.connection = opened.connection
    this.mode = opened.connection.mode
    this.status = "running"
    this.error = undefined
    this.pushLog("system", opened.logLine)
  }

  private async closeOpenedConnection(opened: {
    connection?: DesktopBackendConnection
    handle?: HeadlessBackendHandle
  }) {
    if (opened.handle) {
      await opened.handle.close()
      this.pushLog("system", "backend sidecar closed")
    } else if (opened.connection?.mode === "attach") {
      this.pushLog("system", "detached from backend")
    }
  }
}

async function assertAttachHealth(input: {
  baseUrl: string
  headers: Record<string, string>
  fetch: DesktopBackendFetch
  timeoutMs: number
}) {
  let response: Response
  try {
    response = await fetchAttachHealth({
      fetch: input.fetch,
      url: new URL("/global/health", input.baseUrl),
      headers: input.headers,
      timeoutMs: input.timeoutMs,
    })
  } catch (cause) {
    const detail = cause instanceof Error && cause.message ? `: ${cause.message}` : ""
    throw new Error(`Unable to reach attached AX Code backend${detail}`, { cause })
  }

  if (!response.ok) {
    const detail = response.status === 401 || response.status === 403 ? " Check attach authentication." : ""
    throw new Error(`Attached AX Code backend health check failed (${response.status}).${detail}`)
  }
}

async function fetchAttachHealth(input: {
  fetch: DesktopBackendFetch
  url: URL
  headers: Record<string, string>
  timeoutMs: number
}) {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const request = Promise.resolve(
    input.fetch(input.url, {
      method: "GET",
      headers: input.headers,
      signal: controller.signal,
    }),
  )
  const deadline = new Promise<Response>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error(`Attached AX Code backend health check timed out after ${input.timeoutMs}ms.`))
    }, input.timeoutMs)
  })
  try {
    return await Promise.race([request, deadline])
  } catch (cause) {
    if (timedOut) throw new Error(`Attached AX Code backend health check timed out after ${input.timeoutMs}ms.`)
    throw cause
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function positiveFiniteNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}
