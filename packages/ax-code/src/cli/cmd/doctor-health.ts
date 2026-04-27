import path from "path"
import fs from "fs/promises"

export type DoctorCheck = {
  name: string
  status: "ok" | "warn" | "fail"
  detail: string
}

const READ_ONLY_AX_CODE_PATTERNS = [/(\s|^)doctor(\s|$)/, /(\s|^)--version(\s|$)/]
const RECENT_LOG_WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_RECENT_LOG_FILES = 5

function isReadOnlyAxCodeCommand(command: string) {
  return READ_ONLY_AX_CODE_PATTERNS.some((pattern) => pattern.test(command))
}

function isLogFile(name: string) {
  return name.endsWith(".log")
}

export async function getRunningInstancesCheck(
  input: {
    currentPid?: number
    run?: (command: string[]) => Promise<string>
  } = {},
): Promise<DoctorCheck | undefined> {
  const currentPid = input.currentPid ?? process.pid
  const run = input.run ?? defaultRun

  let raw = ""
  try {
    raw = await run(["pgrep", "-a", "-x", "ax-code"])
  } catch {
    return undefined
  }

  const others = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const firstSpace = line.indexOf(" ")
      if (firstSpace === -1) return { pid: Number(line), command: "" }
      return {
        pid: Number(line.slice(0, firstSpace)),
        command: line.slice(firstSpace + 1),
      }
    })
    .filter((item) => Number.isFinite(item.pid) && item.pid !== currentPid)
    .filter((item) => !isReadOnlyAxCodeCommand(item.command))

  if (others.length === 0) {
    return { name: "Running instances", status: "ok", detail: "No other ax-code processes" }
  }

  return {
    name: "Running instances",
    status: "warn",
    detail:
      `${others.length} other ax-code process(es) found — this may block startup or cause port conflicts. ` +
      `PIDs: ${others.map((item) => item.pid).join(", ")}. Run: killall ax-code`,
  }
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

  const logFiles = (await readdir(input.logDir).catch(() => []))
    .filter(isLogFile)
    .map((name) => path.join(input.logDir, name))

  const withStats = await Promise.all(
    logFiles.map(async (target) => ({
      target,
      mtimeMs: await stat(target)
        .then((result) => result.mtimeMs)
        .catch(() => 0),
    })),
  )

  const recent = withStats
    .filter((entry) => entry.mtimeMs > 0 && now - entry.mtimeMs <= RECENT_LOG_WINDOW_MS)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_RECENT_LOG_FILES)

  if (recent.length === 0) {
    return [
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

  for (const entry of recent) {
    const content = await readFile(entry.target).catch(() => "")
    const lines = content.split("\n").filter(Boolean)
    const errors = lines.filter((line) => line.startsWith("ERROR"))
    const warns = lines.filter((line) => line.startsWith("WARN"))
    totalErrors += errors.length
    totalWarns += warns.length

    if (errors.length > 0 && latestRecentErrors.length === 0) {
      latestRecentErrors = errors.slice(-3)
    }

    for (const line of errors) {
      const lower = line.toLowerCase()
      if (
        lower.includes("tui") ||
        lower.includes("renderer") ||
        lower.includes("worker") ||
        lower.includes("jsx") ||
        lower.includes("react") ||
        lower.includes("unhandled") ||
        lower.includes("crash")
      ) {
        tuiErrors.push(`[${path.basename(entry.target)}] ${line.slice(0, 160)}`)
      }
    }
  }

  const checks: DoctorCheck[] = [
    {
      name: "Recent logs",
      status: totalErrors > 10 ? "warn" : "ok",
      detail: `${recent.length} file(s) checked from the last 24h — ${totalErrors} errors, ${totalWarns} warnings`,
    },
  ]

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
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  })
  return await new Response(proc.stdout).text()
}
