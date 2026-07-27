import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./monitor.txt"
import { Log } from "../util/log"
import { Bus } from "@/bus"
import { NotificationEvent } from "@/notification/events"
import { ToolBoolean, ToolNumber } from "./schema"
import { BashTool } from "./bash"
import { BackgroundShell } from "./bash-background"

const log = Log.create({ service: "tool.monitor" })

const MAX_LINES_PER_SECOND = 100
const DEFAULT_TIMEOUT_MS = 300_000

function compileFilter(pattern: string | undefined): RegExp | undefined {
  if (pattern === undefined) return undefined
  try {
    return new RegExp(pattern)
  } catch {
    throw new Error(`Invalid filter regex: ${pattern}`)
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
    // Validate before BashTool can spawn. In particular, an invalid filter
    // must never leave behind an untracked process.
    const filterRe = compileFilter(params.filter)

    const persistent = params.persistent === true
    const timeoutMs = persistent ? undefined : (params.timeout_ms ?? DEFAULT_TIMEOUT_MS)

    // Reuse the hardened bash launcher instead of maintaining a second shell
    // execution path. This gives monitors the same path/network isolation,
    // environment sanitization, destructive-command confirmation, OS sandbox,
    // kill_shell support, and session cleanup as background bash commands.
    const bash = await BashTool.init()
    const bashResult = await bash.execute(
      {
        command: params.command,
        description: params.description,
        run_in_background: true,
      },
      {
        ...ctx,
        ask: (request) =>
          ctx.ask(
            request.permission === "bash"
              ? {
                  ...request,
                  permission: "monitor",
                  metadata: { ...request.metadata, description: params.description },
                }
              : request,
          ),
      },
    )
    const background = (bashResult.metadata as { background?: { shellID?: string; pid?: number | null } }).background
    const shellID = background?.shellID
    if (!shellID) {
      throw new Error("Monitor command did not start a background shell.")
    }

    let linesEmitted = 0
    let lineCount = 0
    let windowStart = Date.now()
    const partial: Record<BackgroundShell.OutputStream, string> = {
      stdout: "",
      stderr: "",
    }

    const emitLine = (line: string) => {
      const trimmed = line.trimEnd()
      if (!trimmed || (filterRe && !filterRe.test(trimmed))) return
      const now = Date.now()
      if (now - windowStart >= 1000) {
        windowStart = now
        lineCount = 0
      }
      lineCount += 1
      if (lineCount > MAX_LINES_PER_SECOND) return
      linesEmitted += 1
      try {
        Bus.publishDetached(NotificationEvent.MonitorLine, {
          monitorID: shellID,
          line: trimmed,
          description: params.description,
        })
      } catch (error) {
        log.warn("monitor line publish failed", {
          id: shellID,
          error: error instanceof Error ? error.message : error,
        })
      }
    }

    const appendOutput = (stream: BackgroundShell.OutputStream, text: string) => {
      partial[stream] += text
      const lines = partial[stream].split("\n")
      partial[stream] = lines.pop() ?? ""
      for (const line of lines) emitLine(line)
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    let finished = false
    const unsubscribe = BackgroundShell.observe(shellID, ctx.sessionID, {
      onOutput: appendOutput,
      onExit: (info) => {
        finished = true
        if (timer) clearTimeout(timer)
        for (const stream of ["stdout", "stderr"] as const) {
          if (partial[stream].trimEnd()) emitLine(partial[stream])
          partial[stream] = ""
        }
        try {
          Bus.publishDetached(NotificationEvent.MonitorExit, {
            monitorID: shellID,
            description: params.description,
            exitCode: info.exitCode,
          })
        } catch (error) {
          log.warn("monitor exit publish failed", {
            id: shellID,
            error: error instanceof Error ? error.message : error,
          })
        }
        log.info("monitor finished", {
          id: shellID,
          status: info.status,
          exitCode: info.exitCode,
          linesEmitted,
        })
      },
    })
    if (!unsubscribe) {
      await BackgroundShell.kill(shellID, ctx.sessionID).catch(() => undefined)
      throw new Error(`Monitor shell "${shellID}" could not be observed.`)
    }

    if (!finished && timeoutMs) {
      timer = setTimeout(() => {
        void BackgroundShell.kill(shellID, ctx.sessionID).catch((error) => {
          log.warn("monitor timeout cleanup failed", {
            id: shellID,
            error: error instanceof Error ? error.message : error,
          })
        })
      }, timeoutMs)
      timer.unref?.()
    }

    const output =
      `Monitor started with shell ID: ${shellID}\n` +
      `Description: ${params.description}\n` +
      (filterRe ? `Filter: ${params.filter}\n` : "") +
      (persistent ? `Mode: persistent (runs until session ends or kill_shell)\n` : `Timeout: ${timeoutMs}ms\n`) +
      `Lines will be delivered as notifications. Use kill_shell with "${shellID}" to stop.`

    return {
      title: params.description,
      metadata: {
        monitorID: shellID,
        shellID,
        pid: background?.pid ?? null,
        persistent,
        timeoutMs: timeoutMs ?? null,
      },
      output,
    }
  },
})
