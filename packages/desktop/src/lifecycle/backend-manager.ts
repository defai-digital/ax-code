import { startHeadlessBackend, type HeadlessBackendHandle, type HeadlessBackendOptions } from "@ax-code/sdk/headless"
import type { DesktopBackendPlan } from "./sidecar-plan"

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

export type DesktopBackendManagerOptions = {
  startBackend?: StartHeadlessBackend
  now?: () => number
  maxLogLines?: number
}

export class DesktopBackendManager {
  private readonly startBackend: StartHeadlessBackend
  private readonly now: () => number
  private readonly maxLogLines: number
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
    this.now = options.now ?? Date.now
    this.maxLogLines = options.maxLogLines ?? 400
  }

  async connect(plan: DesktopBackendPlan): Promise<DesktopBackendConnection> {
    if (this.status === "starting") throw new Error("AX Code backend is already starting")
    if (this.status === "running") throw new Error("AX Code backend is already connected")

    this.status = plan.mode === "start" ? "starting" : "running"
    this.mode = plan.mode
    this.error = undefined
    this.stoppedAt = undefined
    this.startedAt = this.now()
    this.pushLog("system", `backend ${plan.mode} requested`)

    try {
      if (plan.mode === "attach") {
        this.connection = {
          url: plan.baseUrl,
          headers: plan.headers,
          mode: "attach",
          loopbackOnly: plan.loopbackOnly,
          generatedAuth: plan.generatedAuth,
        }
        this.pushLog("system", `attached to ${plan.baseUrl}`)
        return this.connection
      }

      const handle = await this.startBackend({
        ...plan.options,
        onStdout: (line) => {
          this.pushLog("stdout", line)
          plan.options.onStdout?.(line)
        },
        onStderr: (line) => {
          this.pushLog("stderr", line)
          plan.options.onStderr?.(line)
        },
      })
      this.handle = handle
      this.status = "running"
      this.connection = {
        url: handle.url,
        headers: handle.headers,
        mode: "start",
        loopbackOnly: plan.loopbackOnly,
        generatedAuth: plan.generatedAuth,
        directory: plan.options.directory,
      }
      this.pushLog("system", `started backend at ${handle.url}`)
      return this.connection
    } catch (cause) {
      this.status = "failed"
      this.error = cause instanceof Error ? cause.message : String(cause)
      this.pushLog("system", `backend ${plan.mode} failed: ${this.error}`)
      throw cause
    }
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

  async close() {
    const handle = this.handle
    this.handle = undefined
    this.connection = undefined
    this.stoppedAt = this.now()

    if (handle) {
      await handle.close()
      this.pushLog("system", "backend sidecar closed")
    } else if (this.status === "running" && this.mode === "attach") {
      this.pushLog("system", "detached from backend")
    }

    this.status = "closed"
  }

  private pushLog(stream: DesktopBackendLogLine["stream"], line: string) {
    this.logs.push({ stream, line, time: this.now() })
    if (this.logs.length > this.maxLogLines) this.logs.splice(0, this.logs.length - this.maxLogLines)
  }
}
