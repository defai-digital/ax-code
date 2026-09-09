import path from "path"
import fs from "fs/promises"
import { parseWindowsAxCodeProcesses, WINDOWS_PROCESS_COMMAND } from "./doctor-processes"
import { parseJsonResult } from "../../util/json-value"
import { Process } from "../../util/process"

export type DoctorCheck = {
  name: string
  status: "ok" | "warn" | "fail"
  detail: string
}

// tui-backend is the TUI's own stdio backend subprocess, not a competing instance.
const READ_ONLY_AX_CODE_PATTERNS = [/(\s|^)doctor(\s|$)/, /(\s|^)--version(\s|$)/, /(\s|^)tui-backend(\s|$)/]
const RECENT_LOG_WINDOW_MS = 24 * 60 * 60 * 1000
const DEFAULT_RUN_TIMEOUT_MS = 5_000
const STACK_FIELD_PATTERN = /(?:\sstack=|"stack"\s*:)/i

function isReadOnlyAxCodeCommand(command: string) {
  return READ_ONLY_AX_CODE_PATTERNS.some((pattern) => pattern.test(command))
}

function isLogFile(name: string) {
  return name.endsWith(".log")
}

function isTuiError(line: string) {
  // Every packaged stack trace points at index-node-tui.js, including provider
  // and session errors. Only inspect the structured fields and error message so
  // that the bundle entrypoint does not turn unrelated failures into TUI crashes.
  const stackField = line.search(STACK_FIELD_PATTERN)
  const lower = line.slice(0, stackField === -1 ? undefined : stackField).toLowerCase()
  return (
    lower.includes("tui") ||
    lower.includes("renderer") ||
    lower.includes("worker") ||
    lower.includes("jsx") ||
    lower.includes("react") ||
    lower.includes("unhandled") ||
    lower.includes("crash")
  )
}

function parseDecimalPid(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined
  const pid = Number(value)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

export async function getRunningInstancesCheck(
  input: {
    currentPid?: number
    platform?: NodeJS.Platform
    run?: (command: string[]) => Promise<string>
  } = {},
): Promise<DoctorCheck | undefined> {
  const currentPid = input.currentPid ?? process.pid
  const run = input.run ?? defaultRun

  const unknown: DoctorCheck = {
    name: "Running instances",
    status: "warn",
    detail: "Unable to enumerate AX Code processes — instance count is unknown",
  }
  if ((input.platform ?? process.platform) === "win32") {
    try {
      const processes = parseWindowsAxCodeProcesses(await run(WINDOWS_PROCESS_COMMAND))
      const all = new Set(processes.map((item) => item.pid))
      const primary = processes.filter((item) => item.pid !== currentPid && !item.readOnly && !all.has(item.parent))
      return primary.length === 0
        ? { name: "Running instances", status: "ok", detail: "No other ax-code processes" }
        : {
            name: "Running instances",
            status: "warn",
            detail: `${primary.length} other ax-code process(es) found. PIDs: ${primary.map((item) => item.pid).join(", ")}. Review these instances for startup or port conflicts.`,
          }
    } catch {
      return unknown
    }
  }
  let raw = ""
  try {
    raw = await run(["pgrep", "-a", "-x", "ax-code"])
  } catch {
    return unknown
  }
  if (raw.split("\n").some((line) => line.trim() && parseDecimalPid(line.trim().split(/\s/)[0]) === undefined))
    return unknown

  const others = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const firstSpace = line.indexOf(" ")
      if (firstSpace === -1) return { pid: parseDecimalPid(line), command: "" }
      return {
        pid: parseDecimalPid(line.slice(0, firstSpace)),
        command: line.slice(firstSpace + 1),
      }
    })
    .filter((item): item is { pid: number; command: string } => item.pid !== undefined && item.pid !== currentPid)
    .filter((item) => !isReadOnlyAxCodeCommand(item.command))

  // Linux `pgrep -a` includes argv, but macOS uses `-a` for a different
  // purpose and returns PIDs only. Once process.title is set to "ax-code", the
  // TUI backend (and the source-mode launcher) cannot be identified from argv.
  // Collapse ax-code parent/child chains so one TUI is reported as one running
  // instance on both platforms.
  const pids = new Set(others.map((item) => item.pid))
  const parentPids = await Promise.all(
    others.map(async (item) => {
      try {
        const output = await run(["ps", "-o", "ppid=", "-p", String(item.pid)])
        return parseDecimalPid(output.trim())
      } catch {
        return undefined
      }
    }),
  )
  const instances = others.filter((_, index) => {
    const parentPid = parentPids[index]
    return parentPid === undefined || !pids.has(parentPid)
  })

  if (instances.length === 0) {
    return { name: "Running instances", status: "ok", detail: "No other ax-code processes" }
  }

  return {
    name: "Running instances",
    status: "warn",
    detail:
      `${instances.length} other ax-code process(es) found — this may block startup or cause port conflicts. ` +
      `PIDs: ${instances.map((item) => item.pid).join(", ")}. Run: killall ax-code`,
  }
}

type LogEvent = { severity: "error" | "warn"; summary: string; tui: boolean; mirrorKey?: string }

function logEvent(line: string): LogEvent | undefined {
  const value = parseJsonResult(line)
  if (value.ok && value.value && typeof value.value === "object" && !Array.isArray(value.value)) {
    const row = value.value as Record<string, unknown>
    const level = typeof row.level === "string" ? row.level.toLowerCase() : row.level
    const severity = [50, 60, "error", "fatal"].includes(level as string | number)
      ? "error"
      : [40, "warn", "warning"].includes(level as string | number)
        ? "warn"
        : undefined
    if (!severity) return
    const service = typeof row.service === "string" ? row.service : ""
    const message = typeof row.msg === "string" ? row.msg : typeof row.message === "string" ? row.message : ""
    const summary = `${severity.toUpperCase()} ${service ? `service=${service} ` : ""}${message}`
    return {
      severity,
      summary,
      tui: isTuiError(`${service} ${message}`),
      mirrorKey: eventKey(row.time ?? row.timestamp, severity, service, message),
    }
  }
  const match = line.match(/^(ERROR|WARN)\b/)
  if (!match) return
  const severity = match[1] === "ERROR" ? "error" : "warn"
  const fields = line.match(/^(?:ERROR|WARN)\s+(\d{4}-\d\d-\d\dT[\d:.]+Z?)\s+(?:\+\d+ms\s+)?service=(\S+)\s+(.+)$/)
  return {
    severity,
    summary: line,
    tui: isTuiError(line),
    mirrorKey: fields ? eventKey(fields[1], severity, fields[2], fields[3]) : undefined,
  }
}

function eventKey(time: unknown, severity: string, service: string, message: string) {
  if (!service || !message || (typeof time !== "string" && typeof time !== "number")) return
  const value =
    typeof time === "number" ? time : Date.parse(time.endsWith("Z") || /[+-]\d\d:\d\d$/.test(time) ? time : `${time}Z`)
  if (!Number.isFinite(value)) return
  // Text timestamps have second precision. Match only inside the same paired log files.
  return JSON.stringify([Math.floor(value / 1000), severity, service, message])
}

export async function getRecentLogsChecks(input: {
  logDir: string
  now?: number
  readFile?: (target: string) => Promise<string>
  readdir?: (target: string) => Promise<string[]>
  stat?: (target: string) => Promise<{ mtimeMs: number }>
}): Promise<DoctorCheck[]> {
  const now = input.now ?? Date.now()
  const readFile = input.readFile ?? (async (target: string) => fs.readFile(target, "utf8"))
  const readdir = input.readdir ?? (async (target: string) => fs.readdir(target))
  const stat = input.stat ?? (async (target: string) => fs.stat(target))

  let accessFailures = 0
  const logFiles = (
    await readdir(input.logDir).catch((error) => {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") accessFailures++
      return []
    })
  )
    .filter(isLogFile)
    .map((name) => path.join(input.logDir, name))

  const withStats = await Promise.all(
    logFiles.map(async (target) => ({
      target,
      mtimeMs: await stat(target)
        .then((result) => result.mtimeMs)
        .catch(() => {
          accessFailures++
          return 0
        }),
    })),
  )

  const recent = withStats
    .filter((entry) => entry.mtimeMs > 0 && now - entry.mtimeMs <= RECENT_LOG_WINDOW_MS)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  if (recent.length === 0) {
    return [
      ...(accessFailures ? [logAccessWarning(accessFailures)] : []),
      {
        name: "Recent logs",
        status: withStats.length > 0 ? "ok" : "warn",
        detail:
          withStats.length > 0
            ? "No log files modified in the last 24h — skipped historical errors"
            : "No log files found",
      },
    ]
  }

  let totalErrors = 0
  let totalWarns = 0
  const tuiErrors: string[] = []
  let latestRecentErrors: string[] = []

  const mirrors = new Map<string, [number, number]>()
  for (const entry of recent) {
    let content: string
    try {
      content = await readFile(entry.target)
    } catch {
      accessFailures++
      continue
    }
    const errors: string[] = []
    for (const line of content.split("\n")) {
      const event = logEvent(line)
      if (!event) continue
      if (event.mirrorKey) {
        const json = entry.target.endsWith(".json.log")
        const key = `${entry.target.replace(/(?:\.json)?\.log$/, "")}\0${event.mirrorKey}`
        const counts = mirrors.get(key) ?? [0, 0]
        const side = json ? 1 : 0
        counts[side]++
        mirrors.set(key, counts)
        if (counts[side] <= counts[1 - side]) continue
      }
      if (event.severity === "warn") {
        totalWarns++
        continue
      }
      totalErrors++
      errors.push(event.summary)
      if (errors.length > 3) errors.shift()
      if (event.tui) {
        tuiErrors.push(`[${path.basename(entry.target)}] ${event.summary.slice(0, 160)}`)
        if (tuiErrors.length > 3) tuiErrors.shift()
      }
    }
    if (errors.length && latestRecentErrors.length === 0) latestRecentErrors = errors.slice(-3)
  }

  const checks: DoctorCheck[] = [
    {
      name: "Recent logs",
      status: totalErrors > 10 ? "warn" : "ok",
      detail: `${recent.length} file(s) checked from the last 24h — ${totalErrors} errors, ${totalWarns} warnings`,
    },
  ]

  if (accessFailures) checks.push(logAccessWarning(accessFailures))

  if (tuiErrors.length > 0) {
    checks.push({
      name: "TUI errors in logs",
      status: "fail",
      detail: tuiErrors
        .slice(-3)
        .map((line) => line.slice(0, 160))
        .join(" | "),
    })
    return checks
  }

  if (latestRecentErrors.length > 0) {
    checks.push({
      name: "Recent errors",
      status: "warn",
      detail: latestRecentErrors.map((line) => line.slice(0, 120)).join(" | "),
    })
  }

  return checks
}

async function defaultRun(command: string[]) {
  const result = await Process.text(command, {
    timeout: DEFAULT_RUN_TIMEOUT_MS,
    nothrow: true,
  })
  if (result.code === 0) return result.text
  if (command[0] === "pgrep" && result.code === 1 && !result.stderr.toString().trim()) return ""
  throw new Error("Process enumeration failed")
}

function logAccessWarning(count: number): DoctorCheck {
  return {
    name: "Log access",
    status: "warn",
    detail: `${count} log access failure(s); error and warning counts are incomplete`,
  }
}
