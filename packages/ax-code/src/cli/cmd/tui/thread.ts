import { cmd } from "@/cli/cmd/cmd"
import { cliBooleanFlagValue } from "@/cli/boolean-flag"
import { Rpc } from "@/util/rpc"
import { type rpc } from "./worker"
import { createRequire } from "module"
import { fstatSync } from "node:fs"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { UI } from "@/cli/ui"
import { Log } from "@/util/log"
import { withTimeout } from "@/util/timeout"
import { withNetworkOptions, resolveNetworkOptions } from "@/cli/network"
import { Filesystem } from "@/util/filesystem"
import type { Event } from "@ax-code/sdk/v2"
import type { EventSource } from "./context/sdk"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { TUI_MODE_CHOICES, applyTuiEngineMode, isExperimentalTuiEngine, resolveEffectiveTuiEngine } from "./engine"
import { runNativeTui } from "./native-supervisor"
import { ensureShellEnv } from "@/runtime/shell-env"
import { TuiConfig } from "@/config/tui"
import { Instance } from "@/project/instance"
import { writeHeapSnapshot } from "v8"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { internalBaseUrl } from "@/util/internal-url"
import type { StreamConnectionStatus } from "./util/resilient-stream"
import { runtimeMode } from "@/installation/runtime-mode"
import { spawn } from "node:child_process"
import { flushTuiStdout, resetTuiTerminalState } from "./terminal-cleanup"
import { parseIntegerEnv } from "./util/env"
import { formatWorkerLoadError } from "./util/log-error"
import { parseTuiJsonPayload } from "./util/json"
import { hasExplicitNetworkBindFlag } from "./util/network-flags"
import { registerTuiCrashHandlers, registerTuiProcessHandler } from "./util/lifecycle"
import { readOptionalJsonState } from "./util/optional-json-state"
import { toErrorMessage } from "@/util/error-message"
import { Shell } from "@/shell/shell"
import {
  nextTuiStartupUpgradeCheckState,
  shouldRunTuiStartupUpgradeCheck,
  type TuiStartupUpgradeCheckState,
} from "./upgrade-check-view-model"

declare global {
  const AX_CODE_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>
const log = Log.create({ service: "tui.thread" })
const require = createRequire(import.meta.url)
// Node resolves relative `--import` specifiers against the cwd it starts in.
// The TUI command later changes cwd to the selected project before it creates
// the backend subprocess, so preserve the original base while it is available.
const processStartupCwd = process.cwd()

export const DEFAULT_TUI_WORKER_READY_TIMEOUT_MS = 10_000
export const DEFAULT_TUI_UPGRADE_CHECK_DELAY_MS = 30_000
export const DEFAULT_TUI_UPGRADE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000
export const DEFAULT_TUI_BACKEND_SHUTDOWN_TIMEOUT_MS = 5_000
export const DEFAULT_TUI_BACKEND_TERMINATE_GRACE_MS = 1_000

export type BackendTransport = "worker" | "process"
type RpcWireTarget = {
  postMessage: (data: string) => void | null
  onmessage: ((ev: MessageEvent<any>) => any) | null
  // See `Rpc.MessageTarget.onWireDeath` — process-stdio transport calls
  // this on broken stdin / EPIPE / child exit so the RPC client can
  // fast-fail every pending call instead of waiting the full
  // RPC_TIMEOUT_MS each.
  onWireDeath?: (() => void) | null
  wireClosed?: boolean
}

type BackendRuntime = {
  mode: BackendTransport
  target: string
  pid?: number
  wire: RpcWireTarget
  terminate: () => Promise<void>
}

export function tuiWorkerReadyTimeoutMs(env: Record<string, string | undefined> = process.env) {
  return parseIntegerEnv({
    env,
    name: "AX_CODE_TUI_WORKER_READY_TIMEOUT_MS",
    fallback: DEFAULT_TUI_WORKER_READY_TIMEOUT_MS,
    min: 1,
  })
}

export function tuiBackendTransport(
  env: Record<string, string | undefined> = process.env,
  runtime: { hasBun?: boolean; mode?: string } = {
    hasBun: Boolean(process.versions.bun),
    mode: process.versions.bun ? runtimeMode() : "node-source",
  },
): BackendTransport {
  const requested = env.AX_CODE_TUI_BACKEND_TRANSPORT
  // The process backend works on every runtime, so an explicit request is always
  // honored. Worker mode needs Bun's global `Worker` and a loadable worker entry,
  // neither of which exists under Node (the node-bundled dist ships no worker
  // bundle), so a requested (or default) "worker" transport is only honored on
  // the Bun source/dev runtime; everything else (Node, Bun-compiled) falls back
  // to the process backend rather than ReferenceError on `new Worker`.
  if (requested === "process") return "process"
  return runtime.hasBun && runtime.mode !== "compiled" ? "worker" : "process"
}

export function tuiUpgradeCheckDelayMs(env: Record<string, string | undefined> = process.env) {
  return parseIntegerEnv({
    env,
    name: "AX_CODE_TUI_UPGRADE_CHECK_DELAY_MS",
    fallback: DEFAULT_TUI_UPGRADE_CHECK_DELAY_MS,
    min: 0,
  })
}

export function tuiUpgradeCheckIntervalMs(env: Record<string, string | undefined> = process.env) {
  return parseIntegerEnv({
    env,
    name: "AX_CODE_TUI_UPGRADE_CHECK_INTERVAL_MS",
    fallback: DEFAULT_TUI_UPGRADE_CHECK_INTERVAL_MS,
    min: 0,
  })
}

export function tsxLoaderImportSpecifier() {
  return pathToFileURL(require.resolve("tsx")).href
}

export function resolveBackendImportSpecifier(specifier: string, startupCwd = processStartupCwd) {
  if (specifier.startsWith("file:")) return specifier
  return path.isAbsolute(specifier) ? specifier : path.resolve(startupCwd, specifier)
}

function tuiUpgradeCheckStatePath() {
  return path.join(Global.Path.state, "upgrade-check.json")
}

async function shouldRunStartupUpgradeCheck() {
  const intervalMs = tuiUpgradeCheckIntervalMs()
  const statePath = tuiUpgradeCheckStatePath()
  const nowMs = Date.now()
  const persisted = await readOptionalJsonState<TuiStartupUpgradeCheckState>(statePath)
  if (persisted.status === "invalid") {
    log.debug("skipping startup upgrade check because state failed to load", {
      statePath,
      error: persisted.error,
    })
    return false
  }
  const shouldRun = shouldRunTuiStartupUpgradeCheck({
    state: persisted.status === "found" ? persisted.value : undefined,
    currentVersion: Installation.VERSION,
    nowMs,
    intervalMs,
  })
  if (!shouldRun) return false

  await Filesystem.writeJson(
    statePath,
    nextTuiStartupUpgradeCheckState({
      currentVersion: Installation.VERSION,
      nowMs,
    }),
  ).catch((error) => {
    log.debug("failed to persist upgrade check state", {
      statePath,
      error,
    })
  })
  return true
}

function backendProcessCommand() {
  if (runtimeMode() === "compiled") {
    return {
      command: process.execPath,
      args: ["tui-backend", "--stdio"],
      label: `${process.execPath} tui-backend --stdio`,
    }
  }

  const entry = process.argv[1]
  if (!entry) throw new Error("Cannot start TUI backend process: missing CLI entrypoint")
  const resolvedEntry = path.isAbsolute(entry) ? entry : path.resolve(process.cwd(), entry)
  // A source run executes a `.ts` entry, which plain `node` cannot load — forward
  // the tsx loader. A node-bundled run executes a `.js` entry and needs nothing.
  // Also forward the solid-loader (tsconfig path aliases, .tsx JSX transform,
  // text-asset imports, Bun→Node module rebinding). Bun resolved tsconfig paths
  // natively; on Node + tsx the solid-loader's resolve hook is required.
  let loaderArgs: string[] = []
  if (/\.[cm]?tsx?$/.test(resolvedEntry)) {
    loaderArgs = ["--import", tsxLoaderImportSpecifier()]
    // Forward the solid-loader if the parent process uses it. Convert relative
    // paths to absolute so the child process resolves correctly regardless of
    // its CWD.
    for (let i = 0; i < process.execArgv.length; i++) {
      const arg = process.execArgv[i]
      if (arg === "--import" && process.execArgv[i + 1]?.includes("solid-loader")) {
        const loaderPath = process.execArgv[i + 1]
        loaderArgs.push("--import", resolveBackendImportSpecifier(loaderPath))
        break
      }
      if (arg.startsWith("--import=") && arg.includes("solid-loader")) {
        const loaderPath = arg.slice("--import=".length)
        loaderArgs.push("--import", resolveBackendImportSpecifier(loaderPath))
        break
      }
    }
  }
  const args = [...loaderArgs, "--conditions=browser", resolvedEntry, "tui-backend", "--stdio"]
  return {
    command: process.execPath,
    args,
    label: `${process.execPath} ${args.join(" ")}`,
  }
}

function isBackendProtocolMessage(line: string) {
  const parsed = parseTuiJsonPayload(line)
  if (!parsed || typeof parsed !== "object") return false
  const type = (parsed as { type?: unknown }).type
  return type === "rpc.result" || type === "rpc.error" || type === "rpc.event"
}

export function createProcessWire(child: any, target: string): RpcWireTarget {
  const wire: RpcWireTarget = {
    onmessage: null,
    onWireDeath: null,
    wireClosed: false,
    postMessage(data) {
      const stdin = child.stdin
      if (!stdin || stdin.destroyed) {
        // Pipe is gone (child exited / stdin closed). Fire onWireDeath
        // so the RPC client fast-fails every pending call instead of
        // waiting the full 60s `RPC_TIMEOUT_MS` each. Idempotent —
        // null'd handlers below mean a second death event is a no-op.
        DiagnosticLog.recordProcess("tui.backendStdinUnavailable", { target })
        notifyWireDeath()
        return
      }
      try {
        stdin.write(data + "\n")
      } catch (error) {
        DiagnosticLog.recordProcess("tui.backendStdinWriteFailed", { target, error })
        Log.Default.warn("TUI backend stdin write failed", {
          target,
          error: toErrorMessage(error),
        })
        notifyWireDeath()
      }
    },
  }
  // The backend can exit before a write discovers the broken stdin pipe.
  // Notify the RPC client from the child lifecycle too, so startup and
  // in-flight requests fail immediately instead of waiting for timeouts.
  const notifyWireDeath = () => {
    if (wire.wireClosed) return
    wire.wireClosed = true
    const onWireDeath = wire.onWireDeath
    wire.onmessage = null
    wire.onWireDeath = null
    onWireDeath?.()
  }
  // Stream-level "error" events (EPIPE, broken pipe on SIGKILL, etc.)
  // crash the parent process if no listener is attached. These pipes
  // exist only in process transport — the worker transport's
  // MessageChannel cannot emit such errors. Swallow + log here so a
  // backend crash is reported as a graceful "backend exited" rather
  // than tearing down the thread.
  child.stdin?.on("error", (error: unknown) => {
    DiagnosticLog.recordProcess("tui.backendStdinStreamError", { target, error })
    Log.Default.warn("TUI backend stdin stream error", {
      target,
      error: toErrorMessage(error),
    })
    notifyWireDeath()
  })
  // `exit` is emitted for a running backend that stops. `error` covers a
  // spawn failure where no exit event is guaranteed. The helper is idempotent.
  child.on?.("exit", notifyWireDeath)
  child.on?.("error", notifyWireDeath)
  child.stdout?.on("error", (error: unknown) => {
    DiagnosticLog.recordProcess("tui.backendStdoutStreamError", { target, error })
    Log.Default.warn("TUI backend stdout stream error", {
      target,
      error: toErrorMessage(error),
    })
  })
  child.stderr?.on("error", (error: unknown) => {
    DiagnosticLog.recordProcess("tui.backendStderrStreamError", { target, error })
    Log.Default.warn("TUI backend stderr stream error", {
      target,
      error: toErrorMessage(error),
    })
  })
  let buffer = ""
  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: unknown) => {
    buffer += String(chunk)
    while (true) {
      const index = buffer.indexOf("\n")
      if (index < 0) break
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (!line.trim()) continue
      if (!isBackendProtocolMessage(line)) {
        DiagnosticLog.recordProcess("tui.backendProtocolNoise", {
          target,
          length: line.length,
        })
        Log.Default.warn("TUI backend process wrote non-protocol stdout", {
          target,
          length: line.length,
        })
        continue
      }
      wire.onmessage?.({ data: line } as MessageEvent<any>)
    }
  })
  child.stderr?.setEncoding("utf8")
  child.stderr?.on("data", (chunk: unknown) => {
    const text = String(chunk).trim()
    if (!text) return
    DiagnosticLog.recordProcess("tui.backendProcessStderr", { text })
    Log.Default.warn("TUI backend process stderr", { text })
  })
  return wire
}

async function createBackendRuntime(input: {
  mode: BackendTransport
  workerTarget?: URL | string
  processCommand?: ReturnType<typeof backendProcessCommand>
  env: Record<string, string>
  cwd: string
}): Promise<BackendRuntime> {
  if (input.mode === "worker") {
    if (!input.workerTarget) throw new Error("Worker backend selected without a worker target")
    // Reached only under the Bun source/dev runtime (see tuiBackendTransport):
    // Bun provides a global `Worker` and can load the worker entry directly. The
    // ambient DOM `WorkerOptions` lib type lacks `env`, so cast.
    const worker = new Worker(input.workerTarget, { env: input.env } as unknown as WorkerOptions)
    return {
      mode: "worker",
      target: String(input.workerTarget),
      wire: worker as unknown as RpcWireTarget,
      terminate: async () => {
        worker.terminate()
      },
    }
  }

  const command = input.processCommand ?? backendProcessCommand()
  const child = spawn(command.command, command.args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ["pipe", "pipe", "pipe"],
  }) as any
  let terminating = false
  let exited = false
  let resolveExited: () => void = () => {}
  const exitedPromise = new Promise<void>((resolve) => {
    resolveExited = resolve
  })
  child.on("error", (error: unknown) => {
    DiagnosticLog.recordProcess("tui.backendProcessError", { error, target: command.label })
    Log.Default.error("TUI backend process failed", {
      error: toErrorMessage(error),
      target: command.label,
    })
  })
  child.on("exit", (code: number | null, signal: string | null) => {
    exited = true
    resolveExited()
    if (terminating) return
    DiagnosticLog.recordProcess("tui.backendProcessExited", { code, signal, target: command.label })
    Log.Default.warn("TUI backend process exited", { code, signal, target: command.label })
  })
  const waitForExit = async (timeoutMs: number) => {
    const timeout = new Promise<"timeout">((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), timeoutMs)
      timer.unref?.()
    })
    return Promise.race([exitedPromise.then(() => "exited" as const), timeout])
  }
  return {
    mode: "process",
    target: command.label,
    pid: child.pid,
    wire: createProcessWire(child, command.label),
    terminate: async () => {
      terminating = true
      DiagnosticLog.recordProcess("tui.backendProcessTerminateStarted", {
        target: command.label,
        pid: child.pid,
      })
      try {
        child.stdin?.end()
        DiagnosticLog.recordProcess("tui.backendProcessStdinClosed", {
          target: command.label,
          pid: child.pid,
        })
      } catch (error) {
        DiagnosticLog.recordProcess("tui.backendProcessStdinCloseFailed", {
          target: command.label,
          pid: child.pid,
          error,
        })
      }
      const hasExited = () => exited || child.exitCode !== null || child.signalCode !== null
      const terminateProcess = () =>
        Shell.killTree(child, {
          exited: () => hasExited(),
        })
          .then(() => {
            DiagnosticLog.recordProcess("tui.backendProcessKilled", {
              target: command.label,
              pid: child.pid,
            })
          })
          .catch((error) => {
            DiagnosticLog.recordProcess("tui.backendProcessKillFailed", {
              target: command.label,
              pid: child.pid,
              error,
            })
          })

      await terminateProcess()
      if ((await waitForExit(DEFAULT_TUI_BACKEND_TERMINATE_GRACE_MS)) === "timeout" && !exited) {
        await terminateProcess()
        await waitForExit(DEFAULT_TUI_BACKEND_TERMINATE_GRACE_MS)
      }
      DiagnosticLog.recordProcess("tui.backendProcessTerminateCompleted", {
        target: command.label,
        pid: child.pid,
        exited,
      })
    },
  }
}

function createWorkerFetch(client: RpcClient): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body ? await request.text() : undefined
    const result = await client.call("fetch", {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    })
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

function createEventSource(client: RpcClient): EventSource {
  let lastStatus: StreamConnectionStatus | undefined
  const statusListeners = new Set<(status: StreamConnectionStatus) => void>()
  client.on<StreamConnectionStatus>("event.status", (status) => {
    lastStatus = status
    for (const handler of statusListeners) handler(status)
  })
  void client
    .call("eventStatus", undefined)
    .then((status) => {
      if (!status) return
      lastStatus = status
      for (const handler of statusListeners) handler(status)
    })
    .catch(() => undefined)

  return {
    on: (handler) => client.on<Event>("event", handler),
    onStatus: (handler) => {
      if (lastStatus) handler(lastStatus)
      statusListeners.add(handler)
      return () => {
        statusListeners.delete(handler)
      }
    },
    status: () => lastStatus,
    setWorkspace: (workspaceID) => {
      void client.call("setWorkspace", { workspaceID }).catch((error) => {
        log.warn("failed to set workspace", { workspaceID, error })
        DiagnosticLog.recordProcess("tui.setWorkspaceFailed", { workspaceID, error })
      })
    },
  }
}

async function target() {
  if (typeof AX_CODE_WORKER_PATH !== "undefined") return AX_CODE_WORKER_PATH
  // Compiled-binary layout (legacy fallback): worker is at cli/cmd/tui/worker.js
  // relative to the entry point. Kept for backwards compatibility with builds
  // that emit the source-tree directory shape.
  const dist = new URL("./cli/cmd/tui/worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(dist))) return dist
  // Legacy flat bundle layout: worker.js sits next to the bundled index.js.
  // Probe this before the source/dev .ts fallback so old source-bundle installs
  // do not crash with a ModuleNotFound on worker.ts.
  const flat = new URL("./worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(flat))) return flat
  // Source/dev layout: worker.ts is the sibling source file under src/.
  // Bun's runtime can load .ts directly, so this is the contributor path.
  return new URL("./worker.ts", import.meta.url)
}

export const DEFAULT_TUI_STDIN_PIPE_QUIET_WINDOW_MS = 300

type StdinLike = {
  on(event: "data", listener: (chunk: Buffer) => void): unknown
  on(event: "end", listener: () => void): unknown
  on(event: "error", listener: (error: Error) => void): unknown
  off(event: string, listener: (...args: any[]) => void): unknown
  pause?: () => unknown
}

function stdinIsRegularFile(fd = 0): boolean {
  try {
    return fstatSync(fd).isFile()
  } catch {
    // fstat can fail for exotic descriptors; treat as "not a regular file"
    // so the pipe quiet-window fallback applies and startup never hangs.
    return false
  }
}

// Read piped (non-TTY) stdin without hanging the TUI on an open producer.
// A regular file (`ax-code < file`) reliably delivers `end`, so we read it
// fully. A pipe/FIFO (`tail -f x | ax-code`, `ax-code < fifo`) may stay open
// forever and never emit `end`; awaiting it (the previous behavior) blocked
// startup before anything rendered. For pipes we collect whatever is buffered
// and resolve after a short quiet window with no further data, then pause the
// stream so the still-open fd doesn't keep feeding the renderer's own stdin.
export function readNonTtyStdin(
  input: {
    stdin?: StdinLike
    isRegularFile?: boolean
    quietWindowMs?: number
  } = {},
): Promise<string> {
  const stdin = input.stdin ?? (process.stdin as unknown as StdinLike)
  const isRegularFile = input.isRegularFile ?? stdinIsRegularFile()
  const quietWindowMs = input.quietWindowMs ?? DEFAULT_TUI_STDIN_PIPE_QUIET_WINDOW_MS
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false
    let quietTimer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (quietTimer) clearTimeout(quietTimer)
      stdin.off("data", onData)
      stdin.off("end", onEnd)
      stdin.off("error", onError)
    }
    const finish = (pause: boolean) => {
      if (settled) return
      settled = true
      cleanup()
      if (pause) stdin.pause?.()
      resolve(Buffer.concat(chunks).toString("utf8"))
    }
    const armQuietTimer = () => {
      if (isRegularFile) return
      if (quietTimer) clearTimeout(quietTimer)
      quietTimer = setTimeout(() => finish(true), quietWindowMs)
      quietTimer.unref?.()
    }
    const onData = (chunk: Buffer) => {
      chunks.push(chunk)
      // Regular files EOF on their own; only pipes need the quiet-window reset.
      armQuietTimer()
    }
    const onEnd = () => finish(false)
    const onError = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    stdin.on("data", onData)
    stdin.on("end", onEnd)
    stdin.on("error", onError)
    // A pipe that is open but idle (e.g. `ax-code < fifo` with no writer yet)
    // emits neither `data` nor `end`; arm the quiet window up front so startup
    // still proceeds. Regular files are left to their `end`/`error` events.
    armQuietTimer()
  })
}

async function input(value?: string) {
  const piped = process.stdin.isTTY ? undefined : await readNonTtyStdin()
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start ax-code tui",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .positional("project", {
        type: "string",
        describe: "path to start ax-code in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("tui-mode", {
        type: "string",
        choices: TUI_MODE_CHOICES as unknown as string[],
        // Hidden: Zig/OpenTUI is the supported production engine. Native is a
        // separate Rust/Ratatui UI kept behind a dogfood escape hatch.
        hidden: true,
        describe: "[experimental] TUI engine override (supported: zig; native is Rust/Ratatui)",
      }),
  handler: async (args) => {
    // Keep ENABLE_PROCESSED_INPUT cleared even if other code flips it.
    // (Important when running under `bun run` wrappers on Windows.)
    const unguard = win32InstallCtrlCGuard()
    try {
      // Must be the very first thing — disables CTRL_C_EVENT before any Worker
      // spawn or async work so the OS cannot kill the process group.
      win32DisableProcessedInput()

      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exitCode = 1
        return
      }
      // Shell env fills missing keys only. Await it before selecting the UI so
      // AX_CODE_TUI_ENGINE from a shell profile is visible. Selection also
      // disables the retired OpenTUI Rust/yoga overlay before any UI import.
      await ensureShellEnv()
      // Must run before the OpenTUI renderer is resolved and before any child
      // inherits the environment.
      const tuiModeFlag = args["tui-mode"] as string | undefined
      const tuiMode = applyTuiEngineMode(tuiModeFlag)
      DiagnosticLog.recordProcess("tui.threadStarted", {
        args: process.argv.slice(2),
        tuiMode,
        tuiModeFlag: tuiModeFlag ?? null,
        tuiModeExperimental: isExperimentalTuiEngine(tuiMode),
        tuiModeResolved: resolveEffectiveTuiEngine(),
      })

      // Resolve relative --project paths from the caller's original cwd, then
      // use the real cwd after chdir so the thread and worker share the same
      // directory key. Filesystem.callerCwd() handles the --cwd offset.
      const root = Filesystem.resolve(Filesystem.callerCwd())
      const next = args.project
        ? Filesystem.resolve(path.isAbsolute(args.project) ? args.project : path.join(root, args.project))
        : root
      try {
        process.chdir(next)
      } catch {
        UI.error("Failed to change directory to " + next)
        // Match the sibling failure paths (readiness handshake, thread error,
        // app-import failure): a chdir failure is a hard startup error, so the
        // process must exit non-zero rather than reporting success.
        process.exitCode = 1
        return
      }
      const cwd = Filesystem.resolve(process.cwd())

      if (tuiMode === "native") {
        const prompt = await input(args.prompt)
        DiagnosticLog.recordProcess("tui.nativeStarted", { directory: cwd })
        try {
          const result = await runNativeTui({
            cwd,
            prompt,
            session: args.session,
            continue: args.continue,
            fork: args.fork,
            model: args.model,
            agent: args.agent,
          })
          DiagnosticLog.recordProcess("tui.nativeExited", result)
          process.exitCode = result.code
        } catch (error) {
          DiagnosticLog.recordProcess("tui.nativeFailed", { error })
          UI.error(`Native Rust TUI failed to start: ${toErrorMessage(error)}`)
          process.exitCode = 1
        }
        return
      }

      const backendTransport = tuiBackendTransport()
      const file = backendTransport === "worker" ? await target() : undefined
      const processCommand = backendTransport === "process" ? backendProcessCommand() : undefined
      DiagnosticLog.recordProcess("tui.backendTargetResolved", {
        mode: backendTransport,
        target: file ? String(file) : processCommand?.label,
        runtimeMode: runtimeMode(),
      })
      // Sibling event under the worker-era name. Kept alongside
      // backendTargetResolved for observability backwards compat — the
      // other backend/worker event pairs (Spawned, Ready, HandshakeFailed)
      // already emit both names, and dashboards / log-watchers tuned to
      // the older `tui.worker*` taxonomy continue to fire here.
      DiagnosticLog.recordProcess("tui.workerTargetResolved", {
        mode: backendTransport,
        target: file ? String(file) : processCommand?.label,
        runtimeMode: runtimeMode(),
      })

      // TRUST BOUNDARY: the TUI backend (worker/process) is a trusted peer that
      // runs the same ax-code code as this thread — not model-controlled input —
      // so it gets the FULL process env. Do NOT pass `Env.sanitize()` here: it
      // strips /KEY|SECRET|TOKEN|.../ names, which silently dropped env-provided
      // provider API keys (`ANTHROPIC_API_KEY=… ax-code`) from the backend's
      // provider loader — always broken on Windows and never recovered in worker
      // mode (see finding #7). Secrets are re-stripped via `Env.sanitize()` at
      // every model-controlled spawn point *inside* the backend (tool/bash-impl.ts,
      // pty/index.ts, mcp/impl.ts, session/prompt-shell-command.ts), so they never
      // leak from the backend into an LLM-driven shell.
      const backendEnv: Record<string, string | undefined> = { ...process.env }
      if (cliBooleanFlagValue(process.argv, "--print-logs") === true) backendEnv.AX_CODE_PRINT_LOGS = "1"
      const backend = await createBackendRuntime({
        mode: backendTransport,
        workerTarget: file,
        processCommand,
        cwd,
        env: Object.fromEntries(Object.entries(backendEnv).filter((e): e is [string, string] => e[1] !== undefined)),
      })
      DiagnosticLog.recordProcess("tui.backendSpawned", {
        mode: backend.mode,
        target: backend.target,
        pid: backend.pid,
      })
      DiagnosticLog.recordProcess("tui.workerSpawned", { mode: backend.mode, target: backend.target, pid: backend.pid })
      if (backend.mode === "worker") {
        const worker = backend.wire as unknown as Worker
        worker.onerror = (e) => {
          DiagnosticLog.recordProcess("tui.workerError", { error: e, target: backend.target })
          Log.Default.error(e)
          UI.error(formatWorkerLoadError(backend.target, e))
          // Attempt graceful backend termination before exit so the child
          // process (if any) is cleaned up and the terminal state is restored.
          backend
            .terminate()
            .catch((err) => {
              log.warn("failed to terminate backend after worker error", { error: toErrorMessage(err) })
            })
            .finally(() => {
              process.exit(1)
            })
        }
        worker.onmessageerror = (e) => {
          DiagnosticLog.recordProcess("tui.workerMessageError", { error: e })
          Log.Default.error(e)
        }
      }

      const client = Rpc.client<typeof rpc>(backend.wire)
      const workerReadyTimeoutMs = tuiWorkerReadyTimeoutMs()
      DiagnosticLog.recordProcess("tui.backendHandshakeStarted", {
        mode: backend.mode,
        target: backend.target,
        pid: backend.pid,
        timeoutMs: workerReadyTimeoutMs,
      })
      const workerReady = await withTimeout(
        client.call("health", undefined),
        workerReadyTimeoutMs,
        `TUI backend did not become ready after ${workerReadyTimeoutMs}ms`,
      ).catch(async (error) => {
        DiagnosticLog.recordProcess("tui.backendHandshakeFailed", {
          error,
          mode: backend.mode,
          target: backend.target,
          pid: backend.pid,
          timeoutMs: workerReadyTimeoutMs,
        })
        DiagnosticLog.recordProcess("tui.workerHandshakeFailed", {
          error,
          mode: backend.mode,
          target: backend.target,
          pid: backend.pid,
          timeoutMs: workerReadyTimeoutMs,
        })
        Log.Default.error("TUI backend failed readiness handshake", {
          error: toErrorMessage(error),
          mode: backend.mode,
          target: backend.target,
          pid: backend.pid,
          timeoutMs: workerReadyTimeoutMs,
        })
        UI.error(
          [
            "TUI backend did not become ready.",
            "This usually points to backend transport startup, OpenTUI preload, or runtime packaging.",
            "Run with --debug --print-logs and inspect process.jsonl around tui.backendHandshakeFailed.",
          ].join("\n"),
        )
        await backend.terminate()
        process.exitCode = 1
        return undefined
      })
      if (!workerReady) return
      DiagnosticLog.recordProcess("tui.backendReady", {
        ...workerReady,
        mode: backend.mode,
        target: backend.target,
        pid: backend.pid,
        timeoutMs: workerReadyTimeoutMs,
      })
      DiagnosticLog.recordProcess("tui.workerReady", {
        ...workerReady,
        mode: backend.mode,
        target: backend.target,
        pid: backend.pid,
        timeoutMs: workerReadyTimeoutMs,
      })
      const internalEvents = createEventSource(client)
      let threadErrorExitScheduled = false
      const error = (e: unknown) => {
        DiagnosticLog.recordProcess("tui.threadError", { error: e })
        Log.Default.error(e)
        process.exitCode = 1
        resetTuiTerminalState()
        if (threadErrorExitScheduled) return
        threadErrorExitScheduled = true
        const timer = setTimeout(() => process.exit(1), 100)
        timer.unref?.()
        void flushTuiStdout().finally(() => {
          clearTimeout(timer)
          process.exit(1)
        })
      }
      const reload = () => {
        client.call("reload", undefined).catch((err) => {
          Log.Default.warn("backend reload failed", {
            error: toErrorMessage(err),
          })
        })
      }
      const unregisterProcessHandlers = [
        registerTuiCrashHandlers(error, { namePrefix: "thread" }),
        registerTuiProcessHandler("SIGUSR2", reload, { name: "thread-sigusr2-reload" }),
      ]

      let stopped = false
      const stop = async () => {
        if (stopped) return
        stopped = true
        for (const unregister of unregisterProcessHandlers) unregister()
        await withTimeout(client.call("shutdown", undefined), DEFAULT_TUI_BACKEND_SHUTDOWN_TIMEOUT_MS).catch(
          (error) => {
            Log.Default.warn("backend shutdown failed", {
              error: toErrorMessage(error),
            })
          },
        )
        await backend.terminate()
      }

      const prompt = await input(args.prompt)
      const config = await Instance.provide({
        directory: cwd,
        fn: () => TuiConfig.get(),
      })

      const network = await resolveNetworkOptions(args)
      const external =
        hasExplicitNetworkBindFlag() || network.mdns || network.port !== 0 || network.hostname !== "127.0.0.1"

      const transport = external
        ? {
            url: (await client.call("server", network)).url,
            fetch: undefined,
            events: undefined,
          }
        : {
            url: internalBaseUrl(),
            fetch: createWorkerFetch(client),
            events: internalEvents,
          }
      DiagnosticLog.recordProcess("tui.threadTransportSelected", {
        mode: external ? "external" : "internal",
        url: transport.url,
      })

      const upgradeDelayMs = tuiUpgradeCheckDelayMs()
      // Upgrade checks are non-critical and can touch installation/network
      // surfaces. Keep them away from the first interactive turn, especially
      // in packaged installs where the TUI shares a stdio backend with prompt
      // submission.
      const upgradeTimer =
        upgradeDelayMs === 0
          ? undefined
          : setTimeout(() => {
              shouldRunStartupUpgradeCheck()
                .then((shouldRun) => {
                  if (!shouldRun) return
                  return client.call("checkUpgrade", { directory: cwd })
                })
                .catch((error) => {
                  log.debug("upgrade check request failed", {
                    directory: cwd,
                    error,
                  })
                })
            }, upgradeDelayMs)
      upgradeTimer?.unref?.()

      try {
        const appImportStartedAt = performance.now()
        DiagnosticLog.recordProcess("tui.appImportStarted", {})
        const app = await import("./app").catch((error) => {
          const elapsedMs = Math.round(performance.now() - appImportStartedAt)
          DiagnosticLog.recordProcess("tui.appImportFailed", {
            error,
            elapsedMs,
          })
          Log.Default.error("TUI app import failed", {
            error: toErrorMessage(error),
            elapsedMs,
          })
          UI.error(
            [
              "TUI app failed to load.",
              "This usually points to OpenTUI/Solid module startup or bundled-runtime packaging.",
              "Run with --debug --print-logs and inspect process.jsonl around tui.appImportFailed.",
            ].join("\n"),
          )
          process.exitCode = 1
          return undefined
        })
        if (!app) return
        DiagnosticLog.recordProcess("tui.appImportReady", {
          elapsedMs: Math.round(performance.now() - appImportStartedAt),
        })
        const { tui } = app
        await tui({
          url: transport.url,
          async onSnapshot() {
            const tuiSnapshot = writeHeapSnapshot("tui.heapsnapshot")
            const server = await client.call("snapshot", undefined)
            return [tuiSnapshot, server]
          },
          config,
          directory: cwd,
          fetch: transport.fetch,
          events: transport.events,
          args: {
            continue: args.continue,
            sessionID: args.session,
            agent: args.agent,
            model: args.model,
            prompt,
            fork: args.fork,
          },
        })
      } finally {
        if (upgradeTimer) clearTimeout(upgradeTimer)
        await stop()
      }
    } finally {
      unguard?.()
    }
    await flushTuiStdout()
    process.exit(0)
  },
})
