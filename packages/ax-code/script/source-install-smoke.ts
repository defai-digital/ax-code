#!/usr/bin/env bun
/**
 * Smoke-test the source npm distribution from the same staged tarball layout
 * that publish-source.ts creates.
 *
 * This intentionally installs the tarball into a temporary npm prefix instead
 * of running the unpacked package directly. Direct tar extraction skips npm's
 * dependency installation and postinstall steps, which makes OpenTUI native
 * package resolution look broken even though the real user install path works.
 */
import { $ } from "bun"
import fs from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import pkg from "../package.json"

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = path.resolve(dir, "../..")
const args = new Set(process.argv.slice(2))

const packageName = process.env.AX_CODE_INSTALL_SMOKE_PACKAGE ?? "@defai.digital/ax-code"
const expectedVersion = (process.env.AX_CODE_VERSION ?? pkg.version).replace(/^v/, "")
const runTuiStartupSmoke = args.has("--tui-startup-smoke")
const keepTemp = args.has("--keep-temp") || args.has("--manual-first-prompt")
const decoder = new TextDecoder()
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

function commandDisplay(command: string[]) {
  return command.map((part) => (part.includes(" ") ? JSON.stringify(part) : part)).join(" ")
}

async function fail(message: string): Promise<never> {
  console.error(`source-install-smoke: ${message}`)
  process.exit(1)
}

function decodeOutput(value: string | Uint8Array | undefined) {
  if (typeof value === "string") return value
  if (!value) return ""
  return decoder.decode(value)
}

function positiveIntegerEnv(name: string, fallback: number) {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
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

function installedPackageDir(root: string, name: string) {
  return path.join(root, "node_modules", ...name.split("/"))
}

async function collectAndMirror(stream: ReadableStream<Uint8Array> | null | undefined, write: (chunk: string) => void) {
  if (!stream) return ""

  const streamDecoder = new TextDecoder()
  const reader = stream.getReader()
  let output = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = streamDecoder.decode(value, { stream: true })
    output += chunk
    write(chunk)
  }

  const finalChunk = streamDecoder.decode()
  if (finalChunk) {
    output += finalChunk
    write(finalChunk)
  }

  return output
}

async function run(
  command: string[],
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
) {
  console.log(`source-install-smoke: running ${commandDisplay(command)}`)
  const result = Bun.spawn(command, {
    cwd: options.cwd ?? dir,
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  })

  const stdoutPromise = collectAndMirror(result.stdout, (chunk) => process.stdout.write(chunk))
  const stderrPromise = collectAndMirror(result.stderr, (chunk) => process.stderr.write(chunk))
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise =
    options.timeoutMs === undefined
      ? undefined
      : new Promise<"timeout">((resolve) => {
          timeout = setTimeout(() => {
            result.kill("SIGTERM")
            resolve("timeout")
          }, options.timeoutMs)
        })

  const exitOrTimeout = timeoutPromise ? await Promise.race([result.exited, timeoutPromise]) : await result.exited
  if (timeout) clearTimeout(timeout)

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
  if (exitOrTimeout === "timeout") {
    await fail(`${commandDisplay(command)} timed out after ${options.timeoutMs}ms`)
  }
  const exitCode = exitOrTimeout
  if (exitCode !== 0) await fail(`${commandDisplay(command)} exited with ${exitCode}`)
  return stdout + stderr
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

async function runTuiStartupGate(axCodeBin: string, options: { cwd: string; debugBaseDir: string; homeDir: string }) {
  const timeoutMs = positiveIntegerEnv("AX_CODE_INSTALL_SMOKE_TUI_TIMEOUT_MS", 20_000)
  await fs.promises.rm(options.debugBaseDir, { recursive: true, force: true })
  await fs.promises.mkdir(options.debugBaseDir, { recursive: true })
  await fs.promises.mkdir(options.homeDir, { recursive: true })

  console.log(`source-install-smoke: running installed TUI startup smoke (timeout ${timeoutMs}ms)`)
  const { spawn } = await import("bun-pty")
  const env = stringEnv({
    ...process.env,
    HOME: options.homeDir,
    XDG_CONFIG_HOME: path.join(options.homeDir, ".config"),
    XDG_CACHE_HOME: path.join(options.homeDir, ".cache"),
    AX_CODE_DISABLE_AUTOUPDATE: "1",
    AX_CODE_DISABLE_AUTO_INDEX: "1",
    AX_CODE_DISABLE_LSP_DOWNLOAD: "1",
    AX_CODE_DISABLE_MODELS_FETCH: "1",
    AX_CODE_DISABLE_PROJECT_CONFIG: "1",
    AX_CODE_DISABLE_SHARE: "1",
    AX_CODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "1",
    AX_CODE_TUI_BACKEND_TRANSPORT: "worker",
    AX_CODE_TUI_UPGRADE_CHECK_DELAY_MS: "0",
    AX_CODE_TUI_WORKER_READY_TIMEOUT_MS: "5000",
    COLORTERM: "truecolor",
    TERM: "xterm-256color",
  })

  const pty = spawn(axCodeBin, ["--debug", "--debug-dir", options.debugBaseDir], {
    name: "xterm-256color",
    cols: 100,
    rows: 30,
    cwd: options.cwd,
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
  let failureMessage: string | undefined

  try {
    const events = await waitForTuiStartup(options.debugBaseDir, timeoutMs, () => exit)
    const seen = new Set(eventNames(events))
    const missing = TUI_STARTUP_REQUIRED_EVENTS.filter((event) => !seen.has(event))
    if (missing.length) {
      throw new Error(`installed TUI startup smoke missed required events: ${missing.join(", ")}`)
    }
    console.log(
      `source-install-smoke: installed TUI startup reached ${TUI_STARTUP_SUCCESS_EVENT} (${TUI_STARTUP_REQUIRED_EVENTS.join(
        " -> ",
      )})`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failureMessage = [
      `installed TUI startup smoke failed: ${message}`,
      `debug logs: ${options.debugBaseDir}`,
      output ? `pty output tail:\n${outputTail(output)}` : undefined,
    ]
      .filter(Boolean)
      .join("\n")
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

  if (failureMessage) await fail(failureMessage)
}

const requestedTempRoot = process.env.AX_CODE_INSTALL_SMOKE_TEMP_ROOT
const tempRoot = requestedTempRoot
  ? path.resolve(requestedTempRoot)
  : await fs.promises.mkdtemp(path.join(os.tmpdir(), "ax-code-source-install-smoke."))
const installDir = path.join(tempRoot, "install")
const npmCache = path.join(tempRoot, "npm-cache")
const debugDir = path.join(tempRoot, "first-prompt-debug")
const tuiDebugDir = path.join(tempRoot, "tui-startup-debug")
const tuiHomeDir = path.join(tempRoot, "tui-home")
const tuiProjectDir = path.join(tempRoot, "tui-project")

try {
  if (requestedTempRoot) {
    await fs.promises.rm(tempRoot, { recursive: true, force: true })
  }
  await fs.promises.mkdir(tempRoot, { recursive: true })
  await fs.promises.mkdir(installDir, { recursive: true })
  await fs.promises.mkdir(npmCache, { recursive: true })
  await fs.promises.mkdir(tuiProjectDir, { recursive: true })

  await run(["bun", "run", "script/publish-source.ts"], {
    cwd: dir,
    env: {
      AX_CODE_DRY_RUN: "1",
      AX_CODE_SOURCE_PACKAGE_NAMES: packageName,
      NPM_CONFIG_CACHE: npmCache,
    },
  })

  const stageDir = path.join(dir, "dist-source", "package")
  const tarballs = (await fs.promises.readdir(stageDir)).filter((name) => name.endsWith(".tgz")).sort()
  if (tarballs.length !== 1) {
    await fail(`expected exactly one staged tarball in ${stageDir}, found ${tarballs.length}`)
  }

  const tarball = path.join(stageDir, tarballs[0]!)
  await run(
    [
      "npm",
      "install",
      tarball,
      "--prefix",
      installDir,
      "--foreground-scripts",
      "--loglevel=verbose",
      "--fetch-timeout=30000",
      "--fetch-retries=1",
    ],
    {
      cwd: dir,
      env: { NPM_CONFIG_CACHE: npmCache },
      timeoutMs: 120_000,
    },
  )

  const binName = process.platform === "win32" ? "ax-code.cmd" : "ax-code"
  const axCodeBin = path.join(installDir, "node_modules", ".bin", binName)
  const versionOutput = await run([axCodeBin, "--version"], { cwd: repoRoot })
  const version = versionOutput.trim().replace(/^v/, "")
  if (version !== expectedVersion) {
    await fail(`expected installed ax-code --version to be ${expectedVersion}, got ${versionOutput.trim()}`)
  }

  const bunPathFile = path.join(installedPackageDir(installDir, packageName), "bin", ".ax-code-bun-path")
  await fs.promises.writeFile(bunPathFile, path.join(tempRoot, "missing-bun") + "\n")
  const staleCacheVersionOutput = await run([axCodeBin, "--version"], { cwd: repoRoot })
  const staleCacheVersion = staleCacheVersionOutput.trim().replace(/^v/, "")
  if (staleCacheVersion !== expectedVersion) {
    await fail(
      `expected installed ax-code --version to fall back from a stale bun path and report ${expectedVersion}, got ${staleCacheVersionOutput.trim()}`,
    )
  }

  const doctorOutput = await run([axCodeBin, "doctor"], { cwd: repoRoot })
  if (!/Runtime: Bun .*\((bun-bundled|source)\)/.test(doctorOutput)) {
    await fail("installed ax-code doctor did not report bun-bundled/source runtime")
  }

  const handshake =
    await $`printf '{"type":"rpc.request","method":"health","id":1}\n' | ${axCodeBin} tui-backend --stdio`
      .cwd(repoRoot)
      .quiet()
      .nothrow()
  const handshakeOutput = decodeOutput(handshake.stdout) + decodeOutput(handshake.stderr)
  process.stdout.write(handshakeOutput)
  if (handshake.exitCode !== 0) {
    await fail(`installed backend stdio handshake exited with ${handshake.exitCode}`)
  }
  if (!/"type":"rpc.result".*"id":1/.test(handshakeOutput)) {
    await fail("installed backend did not return rpc health result")
  }
  if (!/"runtimeMode":"(bun-bundled|source)"/.test(handshakeOutput)) {
    await fail("installed backend did not report bun-bundled/source runtime")
  }

  if (runTuiStartupSmoke) {
    await runTuiStartupGate(axCodeBin, { cwd: tuiProjectDir, debugBaseDir: tuiDebugDir, homeDir: tuiHomeDir })
  }

  console.log("source-install-smoke: installed source package smoke passed")

  if (args.has("--manual-first-prompt")) {
    console.log("")
    console.log("Manual first-prompt gate:")
    console.log(`  ${axCodeBin} --debug --debug-dir ${debugDir} --print-logs`)
    console.log("  Type a short prompt, wait for /prompt_async and a model reply, then press Ctrl-C.")
    console.log(`  Temp install kept at ${tempRoot}`)
  }
} finally {
  if (!keepTemp) {
    await fs.promises.rm(tempRoot, { recursive: true, force: true })
  }
}
