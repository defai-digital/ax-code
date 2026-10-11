import { spawn } from "child_process"
import { Env } from "../../util/env"
import { defer } from "../../util/defer"
import { Log } from "../../util/log"
import { toErrorMessage } from "../../util/error-message"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import { Shell } from "@/shell/shell"
import { Config } from "@/config/config"
import { Session } from ".."
import { SessionRevert } from "../revert"
import type { MessageV2 } from "../message-v2"
import type { SessionID } from "../schema"
import { agentInfo } from "./prompt-agent-model-info"
import { agentModel, lastModel, requestedModel } from "./prompt-command-selection"
import type { ShellInput } from "./prompt-input"
import { appendShellOutputChunk, shellArgs, shellOutputMetadata } from "./prompt-shell-runtime"
import { createShellTurnMessages } from "./prompt-shell-turn"

const log = Log.create({ service: "session.prompt" })

// Default shell timeout to prevent hung commands from blocking forever.
const DEFAULT_SHELL_TIMEOUT_MS = 300_000 // 5 minutes
let shellTimeoutMs = DEFAULT_SHELL_TIMEOUT_MS

/** Test hook: shorten the shell timeout; pass undefined to restore the default. */
export function setShellTimeoutForTests(ms?: number) {
  shellTimeoutMs = ms ?? DEFAULT_SHELL_TIMEOUT_MS
}

function describeTimeout(ms: number) {
  return ms % 60_000 === 0 ? `${ms / 60_000} minutes` : `${ms / 1000} seconds`
}

type ShellCommandController = {
  start(sessionID: SessionID): AbortSignal | undefined
  queuedCallbacks(sessionID: SessionID): unknown[]
  markIdle?(sessionID: SessionID): void
  prepareHandoff?(sessionID: SessionID): void
  cancel(sessionID: SessionID): Promise<unknown>
  resumeLoop(input: { sessionID: SessionID; resume_existing: true }): Promise<MessageV2.WithParts>
}

export async function executeShellCommand(
  input: ShellInput,
  controller: ShellCommandController,
): Promise<MessageV2.WithParts | undefined> {
  const abort = controller.start(input.sessionID)
  if (!abort) {
    throw new Session.BusyError(input.sessionID)
  }

  await using _ = defer(async () => {
    controller.prepareHandoff?.(input.sessionID)
    // If no queued callbacks, cancel (the default)
    const callbacks = controller.queuedCallbacks(input.sessionID)
    if (callbacks.length === 0) {
      // Detached disposal: an unawaited rejection here would surface as an
      // unhandled rejection after the shell command has already returned.
      await controller.cancel(input.sessionID).catch((error) => {
        log.warn("shell command cleanup cancel failed", {
          command: "session.prompt.shell",
          status: "error",
          errorCode: "SHELL_CLEANUP_CANCEL_FAILED",
          sessionID: input.sessionID,
          error,
        })
      })
    } else {
      // Otherwise, trigger the session loop to process queued items
      controller.markIdle?.(input.sessionID)
      controller.resumeLoop({ sessionID: input.sessionID, resume_existing: true }).catch((error) => {
        log.error("session loop failed to resume after shell command", {
          command: "session.prompt.shell",
          status: "error",
          sessionID: input.sessionID,
          error,
        })
      })
    }
  })

  if (abort.aborted) return
  const session = await Session.get(input.sessionID)
  if (session.revert) {
    await SessionRevert.cleanup(session)
  }
  const agent = await agentInfo({ sessionID: input.sessionID, name: input.agent })
  const model =
    (input.model ? await requestedModel(input.model) : undefined) ??
    (await agentModel(agent)) ??
    (await lastModel(input.sessionID))
  const { msg, part } = await createShellTurnMessages({
    sessionID: input.sessionID,
    agent: input.agent,
    model,
    command: input.command,
  })
  const config = await Config.get()
  const shell = Shell.preferred(config.shell)
  const args = shellArgs(shell, input.command)

  const cwd = Instance.directory
  const shellEnv = await Plugin.trigger(
    "shell.env",
    { cwd, sessionID: input.sessionID, callID: part.callID },
    { env: {} },
  )
  // Strip secrets (provider keys, tokens, passwords) before forwarding
  // the environment to the session shell. Without this, an LLM-invoked
  // command like `env | curl ...` or `echo $OPENAI_API_KEY` would
  // exfiltrate the parent process credentials. See Env.sanitize.
  const proc = spawn(shell, args, {
    cwd,
    detached: process.platform !== "win32",
    windowsHide: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...Env.sanitize({
        ...process.env,
        ...shellEnv.env,
      }),
      TERM: "dumb",
    },
  })

  const OUTPUT_HARD_CAP = 10 * 1024 * 1024
  let shellOutput = {
    output: "",
    outputBytes: 0,
    outputTruncated: false,
  }
  let flushDirty = false
  let flushRunning = false
  let pending = Promise.resolve()

  const appendOutput = (chunk: Buffer | string) => {
    shellOutput = appendShellOutputChunk(shellOutput, chunk, OUTPUT_HARD_CAP)
  }

  const drainFlush = async () => {
    while (flushDirty) {
      flushDirty = false
      if (part.state.status !== "running") break
      part.state.metadata = shellOutputMetadata(shellOutput)
      await Session.updatePart(part).catch((e) =>
        log.warn("shell metadata write failed", {
          command: "session.prompt.shell",
          status: "error",
          errorCode: "METADATA_WRITE",
          error: e,
        }),
      )
    }
    flushRunning = false
  }

  const flush = () => {
    if (part.state.status !== "running") return
    flushDirty = true
    if (flushRunning) return
    flushRunning = true
    pending = drainFlush()
  }

  const onStdoutData = (chunk: Buffer | string) => {
    appendOutput(chunk)
    flush()
  }
  const onStdoutError = (error: Error) => {
    log.warn("shell stdout stream error", {
      command: "session.prompt.shell",
      status: "error",
      errorCode: "STDOUT_STREAM_ERROR",
      error,
    })
  }
  const onStderrData = (chunk: Buffer | string) => {
    appendOutput(chunk)
    flush()
  }
  const onStderrError = (error: Error) => {
    log.warn("shell stderr stream error", {
      command: "session.prompt.shell",
      status: "error",
      errorCode: "STDERR_STREAM_ERROR",
      error,
    })
  }

  proc.stdout?.on("data", onStdoutData)
  proc.stdout?.on("error", onStdoutError)
  proc.stderr?.on("data", onStderrData)
  proc.stderr?.on("error", onStderrError)

  let aborted = false
  let exited = false
  let exitCode = 0
  let exitSignal: NodeJS.Signals | number | null = null
  let rejectPromise: ((reason?: unknown) => void) | undefined

  const kill = () => Shell.killTree(proc, { exited: () => exited })

  const abortHandler = () => {
    // An abort that lands between `exit` and `close` (the stream drain) has
    // nothing left to kill; recording it would replace the real exit code
    // with a fabricated "User aborted" note and a completed status.
    if (exited) return
    aborted = true
    void kill().catch((error) => {
      log.warn("shell abort kill failed", {
        command: "session.prompt.shell",
        status: "error",
        errorCode: "SHELL_ABORT_KILL_FAILED",
        shell,
        args,
        error,
      })
    })
  }

  abort.addEventListener("abort", abortHandler, { once: true })

  const SHELL_TIMEOUT = shellTimeoutMs
  const SHELL_ABORT_TIMEOUT = "Shell abort timed out while waiting for process to exit"
  let timedOut = false
  // A process error never produces an exit code; keep its message so the part
  // names the real cause instead of a fake exit code. Before the `spawn` event
  // it is a start failure (ENOENT shell, EACCES); after it, a kill that failed.
  let spawned = false
  let procError: string | undefined
  proc.once("spawn", () => {
    spawned = true
  })
  const shellTimer = setTimeout(() => {
    // A user abort already in its kill grace window keeps its own label.
    if (!exited && !aborted) {
      timedOut = true
      log.warn("shell command timed out", {
        command: "session.prompt.shell",
        status: "error",
        errorCode: "SHELL_TIMEOUT",
        shell,
        args,
      })
      void kill().catch((error) => {
        log.warn("shell timeout kill failed", {
          command: "session.prompt.shell",
          status: "error",
          errorCode: "SHELL_TIMEOUT_KILL_FAILED",
          shell,
          args,
          error,
        })
      })
      // The kill request is best-effort. Without a bounded grace period a
      // child (or an inherited stdio pipe) that ignores it leaves waitForExit
      // pending forever, so the session stays busy instead of reporting the
      // timeout. Reuses the same 5s bound the abort path already relies on.
      abortTimeoutHandler()
    }
  }, SHELL_TIMEOUT)
  let abortTimer: ReturnType<typeof setTimeout> | undefined

  const clearShellCommandTimers = () => {
    clearTimeout(shellTimer)
    if (abortTimer) clearTimeout(abortTimer)
  }

  const clearShellCommandListeners = () => {
    abort.removeEventListener("abort", abortHandler)
    abort.removeEventListener("abort", abortTimeoutHandler)
    proc.stdout?.off("data", onStdoutData)
    proc.stderr?.off("data", onStderrData)
    proc.stdout?.off("error", onStdoutError)
    proc.stderr?.off("error", onStderrError)
  }

  function abortTimeoutHandler() {
    abortTimer = setTimeout(() => {
      if (!exited) {
        rejectPromise?.(new Error(SHELL_ABORT_TIMEOUT))
      }
    }, 5_000)
  }

  abort.addEventListener("abort", abortTimeoutHandler, { once: true })

  try {
    const waitForExit = new Promise<void>((resolve, reject) => {
      rejectPromise = reject
      proc.once("exit", (code, signal) => {
        exited = true
        exitSignal = signal ?? null
        exitCode = signal == null ? (code ?? 0) : 1
        // Background processes spawned by the command inherit the pipe FDs,
        // keeping them open so 'close' never fires. Destroy streams after one
        // I/O cycle to drain the kernel buffer, then 'close' fires regardless.
        setImmediate(() => {
          proc.stdout?.destroy()
          proc.stderr?.destroy()
        })
      })
      proc.once("close", (code, signal) => {
        if (!exited) {
          exited = true
          exitSignal = signal ?? null
          exitCode = signal == null ? (code ?? 0) : 1
        }
        resolve()
      })
      proc.once("error", (err) => {
        exited = true
        reject(err)
      })
    })
    if (abort.aborted && !aborted) {
      // Abort won after the line-65 check and before listeners were attached,
      // so the abort event will not fire. Arm the grace timer before killTree:
      // awaiting a hung taskkill/group-kill would skip the timer entirely and
      // leave the session busy. Matches the timeout path (void kill + timer).
      aborted = true
      abortTimeoutHandler()
      void kill().catch((error) => {
        log.warn("shell abort kill failed", {
          command: "session.prompt.shell",
          status: "error",
          errorCode: "SHELL_ABORT_KILL_FAILED",
          shell,
          args,
          error,
        })
      })
    }
    try {
      await waitForExit
    } catch (error) {
      if (error instanceof Error && error.message === SHELL_ABORT_TIMEOUT) {
        // Grace timer rejected waitForExit because killTree/process hung.
        // Persist an aborted turn instead of leaving the tool part running.
        aborted = true
      } else {
        exited = true
        exitCode = 1
        procError = toErrorMessage(error)
        log.warn(spawned ? "shell command process error" : "shell command failed to start", {
          command: "session.prompt.shell",
          status: "error",
          errorCode: spawned ? "SHELL_PROCESS_ERROR" : "SHELL_SPAWN_FAILED",
          shell,
          args,
          error,
        })
      }
    }
  } finally {
    clearShellCommandTimers()
    clearShellCommandListeners()
  }

  if (aborted || timedOut) {
    // The 5-minute timeout reuses the abort grace path to bound a hung kill, so
    // without this distinction a timed-out command was reported as a user abort.
    const note = timedOut ? `Command timed out after ${describeTimeout(SHELL_TIMEOUT)}` : "User aborted the command"
    shellOutput = {
      ...shellOutput,
      output: shellOutput.output + "\n\n" + ["<metadata>", note, "</metadata>"].join("\n"),
    }
  }
  await pending
  if (part.state.status === "running") {
    const error =
      procError !== undefined
        ? spawned
          ? `Shell process error: ${procError}`
          : `Failed to start shell ${shell}: ${procError}`
        : timedOut
          ? `Command timed out after ${describeTimeout(SHELL_TIMEOUT)}`
          : exitSignal === null
            ? `Process exited with code ${exitCode}`
            : `Process exited with signal ${exitSignal}`
    // A process error outranks the abort note: an aborted turn whose shell never
    // started (or could not be killed) must not be filed as completed. A timeout
    // is a failure whatever the kill produced: a hung kill or a shell that traps
    // the signal and exits 0 would otherwise be filed as a success.
    part.state =
      (exitCode !== 0 && !aborted) || procError !== undefined || timedOut
        ? {
            status: "error",
            time: {
              ...part.state.time,
              end: Date.now(),
            },
            input: part.state.input,
            error,
            metadata: shellOutputMetadata(shellOutput),
          }
        : {
            status: "completed",
            time: {
              ...part.state.time,
              end: Date.now(),
            },
            input: part.state.input,
            title: "",
            metadata: shellOutputMetadata(shellOutput),
            output: shellOutput.output,
          }
    await Session.updatePart(part)
  }
  msg.time.completed = Date.now()
  await Session.updateMessage(msg)
  return { info: msg, parts: [part] }
}
