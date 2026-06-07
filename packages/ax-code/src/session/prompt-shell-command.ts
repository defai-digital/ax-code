import { spawn } from "child_process"
import { Env } from "../util/env"
import { defer } from "../util/defer"
import { Log } from "../util/log"
import { Plugin } from "../plugin"
import { Instance } from "../project/instance"
import { Shell } from "@/shell/shell"
import { Config } from "@/config/config"
import { Session } from "."
import { SessionRevert } from "./revert"
import type { MessageV2 } from "./message-v2"
import type { SessionID } from "./schema"
import { agentInfo } from "./prompt-agent-model-info"
import { lastModel } from "./prompt-command-selection"
import type { ShellInput } from "./prompt-input"
import { appendShellOutputChunk, shellArgs, shellOutputMetadata } from "./prompt-shell-runtime"
import { createShellTurnMessages } from "./prompt-shell-turn"

const log = Log.create({ service: "session.prompt" })

type ShellCommandController = {
  start(sessionID: SessionID): AbortSignal | undefined
  queuedCallbacks(sessionID: SessionID): unknown[]
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

  using _ = defer(() => {
    // If no queued callbacks, cancel (the default)
    const callbacks = controller.queuedCallbacks(input.sessionID)
    if (callbacks.length === 0) {
      controller.cancel(input.sessionID)
    } else {
      // Otherwise, trigger the session loop to process queued items
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
  const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
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

  // Default shell timeout to prevent hung commands from blocking forever
  const SHELL_TIMEOUT = 300_000 // 5 minutes
  const shellTimer = setTimeout(() => {
    if (!exited) {
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

  const abortTimeoutHandler = () => {
    abortTimer = setTimeout(() => {
      if (!exited) {
        rejectPromise?.(new Error("Shell abort timed out while waiting for process to exit"))
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
      aborted = true
      await kill()
    }
    if (abort.aborted && !exited) {
      abortTimeoutHandler()
    }
    await waitForExit
  } finally {
    clearShellCommandTimers()
    clearShellCommandListeners()
  }

  if (aborted) {
    shellOutput = {
      ...shellOutput,
      output: shellOutput.output + "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n"),
    }
  }
  await pending
  msg.time.completed = Date.now()
  await Session.updateMessage(msg)
  if (part.state.status === "running") {
    const error =
      exitSignal === null ? `Process exited with code ${exitCode}` : `Process exited with signal ${exitSignal}`
    part.state =
      exitCode !== 0 && !aborted
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
  return { info: msg, parts: [part] }
}
