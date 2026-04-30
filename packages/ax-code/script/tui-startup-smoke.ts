#!/usr/bin/env bun
import fs from "fs"
import os from "os"
import path from "path"

const TUI_STARTUP_SUCCESS_EVENT = "tui.startup.appMounted"
const TUI_STARTUP_REQUIRED_EVENTS = [
  "tui.backendReady",
  "tui.appImportReady",
  "tui.startup.renderDispatched",
  TUI_STARTUP_SUCCESS_EVENT,
]
const TUI_STARTUP_FAILURE_EVENTS = new Set([
  "fatal",
  "cli.uncaughtException",
  "cli.unhandledRejection",
  "tui.backendHandshakeFailed",
  "tui.workerHandshakeFailed",
  "tui.appImportFailed",
  "tui.threadError",
  "worker.uncaughtException",
  "worker.unhandledRejection",
])

type ProcessEvent = {
  eventType?: string
  data?: unknown
}

export type TuiStartupSmokeOptions = {
  bin: string
  cwd: string
  debugBaseDir: string
  homeDir: string
  backendTransport?: "worker" | "process"
  timeoutMs?: number
  label?: string
}

function positiveIntegerEnv(names: string[], fallback: number) {
  for (const name of names) {
    const value = process.env[name]
    if (!value) continue
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }
  return fallback
}

function stringEnv(input: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function outputTail(output: string, limit = 4_000) {
  return output
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .slice(-limit)
}

function resolveCommand(command: string) {
  if (path.isAbsolute(command)) return command
  if (/[\\/]/.test(command) || command.startsWith(".")) return path.resolve(command)
  return command
}

async function processEventFiles(root: string): Promise<string[]> {
  const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => [])
  const files: string[] = []

  for (const entry of entries) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await processEventFiles(file)))
      continue
    }
    if (entry.isFile() && entry.name === "process.jsonl") files.push(file)
  }

  return files
}

async function readProcessEvents(root: string): Promise<ProcessEvent[]> {
  const files = await processEventFiles(root)
  const events: ProcessEvent[] = []

  for (const file of files) {
    const text = await fs.promises.readFile(file, "utf8").catch(() => "")
    for (const line of text.split("\n")) {
      if (!line.trim()) continue
      try {
        const record = JSON.parse(line) as ProcessEvent
        events.push(record)
      } catch {
        // The process may append while the smoke is polling. Ignore a partial
        // line and pick it up on the next read.
      }
    }
  }

  return events
}

function eventNames(events: ProcessEvent[]) {
  return [...new Set(events.map((event) => event.eventType).filter((event): event is string => !!event))]
}

async function waitForTuiStartup(
  debugBaseDir: string,
  timeoutMs: number,
  exitEvent: () => { exitCode: number; signal?: string | number } | undefined,
) {
  const deadline = Date.now() + timeoutMs
  let latestEvents: ProcessEvent[] = []

  while (Date.now() < deadline) {
    latestEvents = await readProcessEvents(debugBaseDir)
    const failure = latestEvents.find((event) => event.eventType && TUI_STARTUP_FAILURE_EVENTS.has(event.eventType))
    if (failure) {
      throw new Error(`TUI startup emitted ${failure.eventType}: ${JSON.stringify(failure.data ?? {})}`)
    }
    if (latestEvents.some((event) => event.eventType === TUI_STARTUP_SUCCESS_EVENT)) return latestEvents

    const exit = exitEvent()
    if (exit) {
      throw new Error(
        `TUI exited before ${TUI_STARTUP_SUCCESS_EVENT} (exitCode=${exit.exitCode}, signal=${exit.signal ?? "none"})`,
      )
    }

    await wait(100)
  }

  const seen = eventNames(latestEvents)
  throw new Error(
    `TUI startup did not reach ${TUI_STARTUP_SUCCESS_EVENT} within ${timeoutMs}ms; seen events: ${
      seen.length ? seen.join(", ") : "none"
    }`,
  )
}

export async function runTuiStartupSmoke(input: TuiStartupSmokeOptions) {
  const timeoutMs =
    input.timeoutMs ??
    positiveIntegerEnv(["AX_CODE_TUI_STARTUP_SMOKE_TIMEOUT_MS", "AX_CODE_INSTALL_SMOKE_TUI_TIMEOUT_MS"], 20_000)
  const label = input.label ?? "tui-startup-smoke"
  await fs.promises.rm(input.debugBaseDir, { recursive: true, force: true })
  await fs.promises.mkdir(input.debugBaseDir, { recursive: true })
  await fs.promises.mkdir(input.homeDir, { recursive: true })
  await fs.promises.mkdir(input.cwd, { recursive: true })

  console.log(`${label}: running installed TUI startup smoke (timeout ${timeoutMs}ms)`)
  const { spawn } = await import("bun-pty")
  const env = stringEnv({
    ...process.env,
    HOME: input.homeDir,
    XDG_CONFIG_HOME: path.join(input.homeDir, ".config"),
    XDG_CACHE_HOME: path.join(input.homeDir, ".cache"),
    AX_CODE_DISABLE_AUTOUPDATE: "1",
    AX_CODE_DISABLE_AUTO_INDEX: "1",
    AX_CODE_DISABLE_LSP_DOWNLOAD: "1",
    AX_CODE_DISABLE_MODELS_FETCH: "1",
    AX_CODE_DISABLE_PROJECT_CONFIG: "1",
    AX_CODE_DISABLE_SHARE: "1",
    AX_CODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "1",
    AX_CODE_TUI_BACKEND_TRANSPORT: input.backendTransport,
    AX_CODE_TUI_UPGRADE_CHECK_DELAY_MS: "0",
    AX_CODE_TUI_WORKER_READY_TIMEOUT_MS: "5000",
    COLORTERM: "truecolor",
    TERM: "xterm-256color",
  })

  const pty = spawn(resolveCommand(input.bin), ["--debug", "--debug-dir", input.debugBaseDir], {
    name: "xterm-256color",
    cols: 100,
    rows: 30,
    cwd: input.cwd,
    env,
  })
  let output = ""
  let exit: { exitCode: number; signal?: string | number } | undefined
  const onData = pty.onData((chunk) => {
    output = (output + chunk).slice(-20_000)
  })
  let resolveExit: ((event: { exitCode: number; signal?: string | number }) => void) | undefined
  const exitPromise = new Promise<{ exitCode: number; signal?: string | number }>((resolve) => {
    resolveExit = resolve
  })
  const onExit = pty.onExit((event) => {
    exit = event
    resolveExit?.(event)
  })

  try {
    const events = await waitForTuiStartup(input.debugBaseDir, timeoutMs, () => exit)
    const seen = new Set(eventNames(events))
    const missing = TUI_STARTUP_REQUIRED_EVENTS.filter((event) => !seen.has(event))
    if (missing.length) {
      throw new Error(`installed TUI startup smoke missed required events: ${missing.join(", ")}`)
    }
    console.log(
      `${label}: installed TUI startup reached ${TUI_STARTUP_SUCCESS_EVENT} (${TUI_STARTUP_REQUIRED_EVENTS.join(
        " -> ",
      )})`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      [
        `installed TUI startup smoke failed: ${message}`,
        `debug logs: ${input.debugBaseDir}`,
        output ? `pty output tail:\n${outputTail(output)}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      { cause: error },
    )
  } finally {
    if (!exit) {
      try {
        pty.write("\x03")
      } catch {}
      await wait(100)
      try {
        pty.kill()
      } catch {}
      await Promise.race([exitPromise, wait(1_000)])
    }
    onData.dispose()
    onExit.dispose()
  }
}

function argValue(args: string[], name: string) {
  const idx = args.indexOf(name)
  if (idx < 0) return undefined
  return args[idx + 1]
}

async function main() {
  const args = process.argv.slice(2)
  const requestedTempRoot = argValue(args, "--temp-root") ?? process.env.AX_CODE_TUI_STARTUP_SMOKE_TEMP_ROOT
  const tempRoot = requestedTempRoot
    ? path.resolve(requestedTempRoot)
    : await fs.promises.mkdtemp(path.join(os.tmpdir(), "ax-code-tui-startup-smoke."))
  const keepTemp = args.includes("--keep-temp")
  const backendTransport = argValue(args, "--backend-transport")
  if (backendTransport !== undefined && backendTransport !== "worker" && backendTransport !== "process") {
    throw new Error(`--backend-transport must be worker or process, got ${backendTransport}`)
  }

  try {
    await runTuiStartupSmoke({
      bin: argValue(args, "--bin") ?? "ax-code",
      cwd: path.resolve(argValue(args, "--cwd") ?? path.join(tempRoot, "project")),
      debugBaseDir: path.resolve(argValue(args, "--debug-dir") ?? path.join(tempRoot, "debug")),
      homeDir: path.resolve(argValue(args, "--home-dir") ?? path.join(tempRoot, "home")),
      backendTransport,
      label: "tui-startup-smoke",
      timeoutMs: Number(argValue(args, "--timeout-ms")) || undefined,
    })
  } finally {
    if (!keepTemp && !requestedTempRoot) {
      await fs.promises.rm(tempRoot, { recursive: true, force: true })
    }
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
