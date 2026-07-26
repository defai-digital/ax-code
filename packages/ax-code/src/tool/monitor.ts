import z from "zod"
import { spawn } from "child_process"
import { StringDecoder } from "string_decoder"
import { Tool } from "./tool"
import DESCRIPTION from "./monitor.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Bus } from "@/bus"
import { NotificationEvent } from "@/notification/events"
import { Shell } from "@/shell/shell"
import { ToolBoolean, ToolNumber } from "./schema"

const log = Log.create({ service: "tool.monitor" })

const MAX_MONITORS_PER_SESSION = 8
const MAX_LINES_PER_SECOND = 100
const DEFAULT_TIMEOUT_MS = 300_000

export namespace MonitorRegistry {
  export type Status = "running" | "completed" | "failed" | "killed"

  export interface Info {
    id: string
    sessionID: string
    command: string
    description: string
    status: Status
    exitCode: number | null
    startedAt: number
    endedAt: number | null
    linesEmitted: number
  }

  interface Entry extends Info {
    pid: number | null
    killRequested: boolean
    timer?: ReturnType<typeof setTimeout>
    lineCount: number
    windowStart: number
  }

  const monitors = new Map<string, Entry>()
  let counter = 0

  export function assertCapacity(sessionID: string) {
    const active = [...monitors.values()].filter((m) => m.sessionID === sessionID && m.status === "running")
    if (active.length >= MAX_MONITORS_PER_SESSION) {
      throw new Error(
        `Too many running monitors (${active.length}). ` +
          `Use kill_shell to stop ones you no longer need, or wait for them to finish.`,
      )
    }
  }

  export function register(input: {
    sessionID: string
    command: string
    description: string
    pid: number | null
    timer?: ReturnType<typeof setTimeout>
  }): Info {
    assertCapacity(input.sessionID)
    counter += 1
    const id = `monitor_${counter}`
    const entry: Entry = {
      id,
      sessionID: input.sessionID,
      command: input.command,
      description: input.description,
      status: "running",
      exitCode: null,
      startedAt: Date.now(),
      endedAt: null,
      linesEmitted: 0,
      pid: input.pid,
      killRequested: false,
      timer: input.timer,
      lineCount: 0,
      windowStart: Date.now(),
    }
    monitors.set(id, entry)
    log.info("monitor started", { id, pid: input.pid, sessionID: input.sessionID })
    return toInfo(entry)
  }

  export function shouldEmit(entry: Entry): boolean {
    const now = Date.now()
    if (now - entry.windowStart >= 1000) {
      entry.windowStart = now
      entry.lineCount = 0
    }
    entry.lineCount++
    return entry.lineCount <= MAX_LINES_PER_SECOND
  }

  export function emitLine(entry: Entry, line: string) {
    if (!shouldEmit(entry)) return
    entry.linesEmitted++
    try {
      Bus.publishDetached(NotificationEvent.MonitorLine, {
        monitorID: entry.id,
        line,
        description: entry.description,
      })
    } catch (error) {
      log.warn("monitor line publish failed", { id: entry.id, error: error instanceof Error ? error.message : error })
    }
  }

  export function finish(id: string, status: Status, exitCode: number | null) {
    const entry = monitors.get(id)
    if (!entry || entry.status !== "running") return
    entry.status = status
    entry.exitCode = exitCode
    entry.endedAt = Date.now()
    if (entry.timer) clearTimeout(entry.timer)
    try {
      Bus.publishDetached(NotificationEvent.MonitorExit, {
        monitorID: entry.id,
        description: entry.description,
        exitCode,
      })
    } catch (error) {
      log.warn("monitor exit publish failed", { id, error: error instanceof Error ? error.message : error })
    }
    log.info("monitor finished", { id, status, exitCode })
  }

  export function get(id: string): Entry | undefined {
    return monitors.get(id)
  }

  export function kill(id: string): boolean {
    const entry = monitors.get(id)
    if (!entry || entry.status !== "running" || !entry.pid) return false
    entry.killRequested = true
    try {
      process.kill(-entry.pid, "SIGTERM")
    } catch {
      try {
        process.kill(entry.pid, "SIGTERM")
      } catch {}
    }
    return true
  }

  export function killForSession(sessionID: string) {
    for (const entry of monitors.values()) {
      if (entry.sessionID === sessionID && entry.status === "running") {
        kill(entry.id)
      }
    }
  }

  function toInfo(entry: Entry): Info {
    return {
      id: entry.id,
      sessionID: entry.sessionID,
      command: entry.command,
      description: entry.description,
      status: entry.status,
      exitCode: entry.exitCode,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      linesEmitted: entry.linesEmitted,
    }
  }
}

export const MonitorTool = Tool.define("monitor", {
  description: DESCRIPTION,
  parameters: z.object({
    command: z.string().describe("Shell command or script. Each stdout line is an event; exit ends the watch."),
    description: z
      .string()
      .max(200)
      .describe("Short human-readable description of what you are monitoring (shown in notifications)."),
    filter: z
      .string()
      .optional()
      .describe("Optional regex pattern. Only lines matching this pattern are emitted as events."),
    timeout_ms: ToolNumber(z.number().min(1000).max(600_000))
      .optional()
      .describe("Kill the monitor after this deadline in milliseconds. Default 300000 (5 minutes)."),
    persistent: ToolBoolean.optional().describe(
      "Run for the lifetime of the session instead of a timeout. Default false.",
    ),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "monitor",
      patterns: [params.command],
      always: [],
      metadata: { description: params.description },
    })

    MonitorRegistry.assertCapacity(ctx.sessionID)

    const cwd = Instance.directory
    const shell = process.env["SHELL"] ?? "/bin/sh"
    const proc = spawn(params.command, {
      shell,
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      windowsHide: process.platform === "win32",
    })

    let filterRe: RegExp | undefined
    if (params.filter) {
      try {
        filterRe = new RegExp(params.filter)
      } catch {
        throw new Error(`Invalid filter regex: ${params.filter}`)
      }
    }

    const persistent = params.persistent === true
    const timeoutMs = persistent ? undefined : (params.timeout_ms ?? DEFAULT_TIMEOUT_MS)

    let timer: ReturnType<typeof setTimeout> | undefined
    if (timeoutMs) {
      timer = setTimeout(() => {
        MonitorRegistry.kill(info.id)
      }, timeoutMs)
      timer.unref?.()
    }

    const info = MonitorRegistry.register({
      sessionID: ctx.sessionID,
      command: params.command,
      description: params.description,
      pid: proc.pid ?? null,
      timer,
    })

    const decoder = new StringDecoder("utf8")
    let partial = ""

    const processLine = (line: string) => {
      const trimmed = line.trimEnd()
      if (!trimmed) return
      if (filterRe && !filterRe.test(trimmed)) return
      const entry = MonitorRegistry.get(info.id)
      if (entry) MonitorRegistry.emitLine(entry, trimmed)
    }

    proc.stdout?.on("data", (chunk: Buffer) => {
      partial += decoder.write(chunk)
      const lines = partial.split("\n")
      partial = lines.pop() ?? ""
      for (const line of lines) processLine(line)
    })

    proc.stderr?.on("data", (chunk: Buffer) => {
      partial += decoder.write(chunk)
      const lines = partial.split("\n")
      partial = lines.pop() ?? ""
      for (const line of lines) processLine(line)
    })

    proc.once("close", () => {
      if (partial.trimEnd()) processLine(partial)
      partial = ""
      const status = proc.exitCode === 0 ? "completed" : "failed"
      MonitorRegistry.finish(info.id, status, proc.exitCode)
    })

    proc.once("error", (error) => {
      log.warn("monitor spawn error", { id: info.id, error: error.message })
      MonitorRegistry.finish(info.id, "failed", null)
    })

    const output =
      `Monitor started with ID: ${info.id}\n` +
      `Description: ${params.description}\n` +
      (filterRe ? `Filter: ${params.filter}\n` : "") +
      (persistent ? `Mode: persistent (runs until session ends or kill_shell)\n` : `Timeout: ${timeoutMs}ms\n`) +
      `Lines will be delivered as notifications. Use kill_shell with "${info.id}" to stop.`

    return {
      title: params.description,
      metadata: {
        monitorID: info.id,
        pid: proc.pid ?? null,
        persistent,
        timeoutMs: timeoutMs ?? null,
      },
      output,
    }
  },
})
