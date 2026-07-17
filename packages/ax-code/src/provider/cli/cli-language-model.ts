import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider"
import { Process } from "../../util/process"
import { Env } from "../../util/env"
import { promptToText } from "./prompt"
import { materializeCliAttachments } from "./attachments"
import type { CliOutputParser } from "./parser"
import { buffer } from "node:stream/consumers"
import { StringDecoder } from "node:string_decoder"
import { toErrorMessage } from "@/util/error-message"
import { Log } from "@/util/log"
import { ScopedFlag } from "@/flag/scoped"
import { Token } from "@/util/token"
import { markEstimatedUsage } from "../usage"
import { Shell } from "@/shell/shell"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "provider.cli-language-model" })

export interface CliLanguageModelConfig {
  providerID: string
  modelID: string
  binary: string
  args: string[]
  parser: CliOutputParser
  promptMode: "stdin" | "arg" | "positional"
  promptFlag?: string
  providerEnvKeys?: readonly string[]
}

function formatCliDetail(stdout: Buffer, stderr: Buffer) {
  const err = stderr.toString().trim()
  const out = stdout.toString().trim()
  if (err && out) return `stderr: ${err}\nstdout: ${out}`
  return err || out
}

function formatCliFailure(code: number, stdout: Buffer, stderr: Buffer) {
  const detail = formatCliDetail(stdout, stderr)
  return detail ? `CLI exited with code ${code}: ${detail.slice(0, 500)}` : `CLI exited with code ${code}`
}

function formatCliTimeout(stdout: Buffer, stderr: Buffer) {
  const base = `CLI process timed out after ${CLI_TIMEOUT_MS / 1000}s`
  const detail = formatCliDetail(stdout, stderr)
  return detail ? `${base}: ${detail.slice(0, 1000)}` : base
}

function rawFallbackText(output: string) {
  const text = output.replace(/\r?\n$/, "")
  return text.trim() ? text : ""
}

const CLI_TIMEOUT_MS = 300_000 // 5 minutes

export function cliEnv(providerEnvKeys: readonly string[] = [], providerID?: string) {
  const env: Record<string, string> = {
    ...Env.withCliProviderKeys(Env.sanitize()),
    TERM: "dumb",
    NO_COLOR: "1",
  }
  // Qoder runs its command tool through $SHELL. A login Bash shell can load
  // unrelated user profile scripts or fail before the requested command runs.
  if (providerID === "qoder-cli" && process.platform !== "win32") env.SHELL = "/bin/sh"
  for (const key of providerEnvKeys) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

function autonomousCliArgs(providerID: string): string[] {
  if (!ScopedFlag.autonomous()) return []
  if (providerID === "claude-code") return ["--dangerously-skip-permissions"]
  if (providerID === "gemini-cli") return ["--approval-mode", "yolo"]
  if (providerID === "qoder-cli") return ["--permission-mode", "auto"]
  // Kimi Code CLI: -p is already non-interactive; --yolo auto-approves tools.
  if (providerID === "kimi-cli") return ["--yolo"]
  return []
}

export function buildCliCommand(config: CliLanguageModelConfig, prompt: string) {
  const cmd = [config.binary, ...config.args, ...autonomousCliArgs(config.providerID)]
  if (config.modelID !== config.providerID) cmd.push("--model", config.modelID)
  if (config.promptMode === "arg") cmd.push(config.promptFlag ?? "-p", prompt)
  if (config.promptMode === "positional") cmd.push(prompt)
  return cmd
}

function estimatedUsage(input: string, output: string): LanguageModelV3Usage {
  const inputTokens = Token.estimate(input)
  const outputTokens = Token.estimate(output)
  return markEstimatedUsage({
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
  })
}

function readAbortError(signal: AbortSignal): Error {
  const reason = signal.reason
  if (reason instanceof Error) return reason
  if (typeof reason === "string") return new DOMException(reason, "AbortError")
  return new DOMException("This operation was aborted", "AbortError")
}

function currentInstanceDirectory(): string | undefined {
  try {
    return Instance.directory
  } catch {
    return undefined
  }
}

export class CliLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const
  readonly provider: string
  readonly modelId: string
  readonly supportedUrls: Record<string, RegExp[]> = {}

  constructor(private config: CliLanguageModelConfig) {
    this.provider = config.providerID
    this.modelId = config.modelID
  }

  private buildCmd(prompt: string) {
    return buildCliCommand(this.config, prompt)
  }

  private useStdin() {
    return this.config.promptMode === "stdin"
  }

  private setupProcessAbort(proc: Process.Child, signal: AbortSignal | undefined, logLabel: string) {
    let _isAborted = false
    let _killPromise = Promise.resolve<void>(undefined)
    let _abortError: Error = new DOMException("This operation was aborted", "AbortError")
    if (signal) _abortError = readAbortError(signal)
    let _killed = false

    const kill = (): Promise<void> => {
      if (_killed) return _killPromise
      _killed = true
      _killPromise = Shell.killTree(proc, {
        exited: () => proc.exitCode !== null || proc.signalCode !== null,
      }).catch((error) => {
        log.warn(`failed to terminate ${logLabel}`, { error: toErrorMessage(error) })
      })
      return _killPromise
    }

    const onAbort = () => {
      _isAborted = true
      _abortError = readAbortError(signal!)
      kill()
    }

    signal?.addEventListener("abort", onAbort, { once: true })
    const removeAbortListener = () => signal?.removeEventListener("abort", onAbort)
    void proc.exited.then(removeAbortListener, removeAbortListener)

    return {
      get isAborted() {
        return _isAborted
      },
      get abortError() {
        return _abortError
      },
      get killPromise() {
        return _killPromise
      },
      kill,
    }
  }

  async doGenerate(options: LanguageModelV3CallOptions) {
    if (options.abortSignal?.aborted) throw readAbortError(options.abortSignal)

    const attachments = await materializeCliAttachments(options.prompt)
    const text = promptToText(options.prompt, {
      providerID: this.config.providerID,
      attachments: attachments.refs,
    })
    const proc = Process.spawn(this.buildCmd(text), {
      cwd: currentInstanceDirectory(),
      stdin: this.useStdin() ? "pipe" : "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: cliEnv(this.config.providerEnvKeys, this.config.providerID),
    })
    const abort = this.setupProcessAbort(proc, options.abortSignal, "cli generate")
    // Remove materialized attachment temp files once the process exits
    // (success, error, or kill). cleanup() never rejects.
    proc.exited.then(
      () => attachments.cleanup(),
      () => attachments.cleanup(),
    )

    if (this.useStdin()) {
      if (!proc.stdin) throw new Error("CLI process stdin not available")
      // Await drain for large prompts. ChildProcess.stdin.write returns
      // false when the buffer is full; without waiting, .end() can ship
      // before the tail of a >64KB prompt has been flushed and macOS
      // sometimes EOFs the child mid-prompt, surfacing as "model returned
      // nothing" with no error. Strict `=== false` check so non-Writable
      // test mocks (write() returning undefined) don't enter the drain
      // path and fail on the absence of .once.
      const stdin = proc.stdin
      const wrote = stdin.write(text)
      if (wrote === false && typeof (stdin as { once?: unknown }).once === "function") {
        await new Promise<void>((resolve) => stdin.once("drain", resolve))
      }
      stdin.end()
    }
    if (!proc.stdout || !proc.stderr) throw new Error("CLI process output not available")

    let timeoutTimer: ReturnType<typeof setTimeout>
    proc.exited.catch((err) => {
      log.debug("cli process exited with error", {
        error: toErrorMessage(err),
      })
    })
    const timeout = new Promise<never>(
      (_, reject) =>
        (timeoutTimer = setTimeout(() => {
          abort.kill()
          reject(new Error(`CLI process timed out after ${CLI_TIMEOUT_MS / 1000}s`))
        }, CLI_TIMEOUT_MS)),
    )
    const result = Promise.all([proc.exited, buffer(proc.stdout), buffer(proc.stderr)])
    result.catch((err) => {
      log.warn("cli language model result collection failed", {
        error: toErrorMessage(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
    })
    let code: number, stdout: Buffer, stderr: Buffer
    try {
      ;[code, stdout, stderr] = await Promise.race([
        result,
        timeout.catch(async (error) => {
          await abort.kill()
          throw error
        }),
      ])
    } finally {
      clearTimeout(timeoutTimer!)
      await abort.killPromise
    }
    if (abort.isAborted) throw abort.abortError
    if (code !== 0) {
      throw new Error(formatCliFailure(code, stdout, stderr))
    }

    const parsed = this.config.parser.parseComplete(stdout.toString())

    return {
      content: [{ type: "text" as const, text: parsed.text }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: estimatedUsage(text, parsed.text),
      warnings: [],
    }
  }

  async doStream(options: LanguageModelV3CallOptions) {
    if (options.abortSignal?.aborted) throw readAbortError(options.abortSignal)

    const attachments = await materializeCliAttachments(options.prompt)
    const text = promptToText(options.prompt, {
      providerID: this.config.providerID,
      attachments: attachments.refs,
    })
    const proc = Process.spawn(this.buildCmd(text), {
      cwd: currentInstanceDirectory(),
      stdin: this.useStdin() ? "pipe" : "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: cliEnv(this.config.providerEnvKeys, this.config.providerID),
    })
    const abort = this.setupProcessAbort(proc, options.abortSignal, "cli stream")
    // Remove materialized attachment temp files once the process exits
    // (success, error, or kill). cleanup() never rejects.
    proc.exited.then(
      () => attachments.cleanup(),
      () => attachments.cleanup(),
    )

    if (this.useStdin()) {
      if (!proc.stdin) throw new Error("CLI process stdin not available")
      // Await drain for large prompts. ChildProcess.stdin.write returns
      // false when the buffer is full; without waiting, .end() can ship
      // before the tail of a >64KB prompt has been flushed and macOS
      // sometimes EOFs the child mid-prompt, surfacing as "model returned
      // nothing" with no error. Strict `=== false` check so non-Writable
      // test mocks (write() returning undefined) don't enter the drain
      // path and fail on the absence of .once.
      const stdin = proc.stdin
      const wrote = stdin.write(text)
      if (wrote === false && typeof (stdin as { once?: unknown }).once === "function") {
        await new Promise<void>((resolve) => stdin.once("drain", resolve))
      }
      stdin.end()
    }
    if (!proc.stdout || !proc.stderr) throw new Error("CLI process output not available")

    const parser = this.config.parser
    const textId = "cli-0"

    let done = false
    let timer: ReturnType<typeof setTimeout>
    let cancelStreaming: (() => void) | undefined

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        const closed = () => done || controller.desiredSize === null
        let cleanedUp = false
        let onStdoutData: ((chunk: Buffer) => void) | undefined
        let onStdoutError: ((err: Error) => void) | undefined
        let onStdoutEnd: (() => void) | undefined
        let onStderrData: ((chunk: Buffer) => void) | undefined
        let onStderrError: ((err: Error) => void) | undefined
        let onStderrEnd: (() => void) | undefined

        const cleanupListeners = () => {
          if (cleanedUp) return
          cleanedUp = true
          if (proc.stdout) {
            if (onStdoutData) proc.stdout.off("data", onStdoutData)
            if (onStdoutError) proc.stdout.off("error", onStdoutError)
            if (onStdoutEnd) proc.stdout.off("end", onStdoutEnd)
          }
          if (proc.stderr) {
            if (onStderrData) proc.stderr.off("data", onStderrData)
            if (onStderrError) proc.stderr.off("error", onStderrError)
            if (onStderrEnd) proc.stderr.off("end", onStderrEnd)
          }
        }
        const safeClose = () => {
          if (done) return
          done = true
          cleanupListeners()
          clearTimeout(timer)
          controller.close()
        }
        const safeAbort = () => {
          done = true
          cleanupListeners()
          clearTimeout(timer)
          abort.kill()
        }

        const onTimeout = () => {
          void (async () => {
            await abort.kill()
            if (closed()) return
            fail(new Error(formatCliTimeout(Buffer.from(raw.join("")), Buffer.concat(stderrRaw))))
          })()
        }
        const onFail = (error: unknown) => {
          if (closed()) return
          endText()
          controller.enqueue({ type: "error", error })
          safeClose()
        }

        let remainder = ""
        let emitted = false
        let textOpen = true
        let stdoutEnded = false
        let stderrEnded = false
        let exitCode: number | undefined
        const raw: string[] = []
        const output: string[] = []
        const stderrRaw: Buffer[] = []
        const stdoutDecoder = new StringDecoder("utf8")
        const endText = () => {
          if (!textOpen || closed()) return
          controller.enqueue({ type: "text-end", id: textId })
          textOpen = false
        }
        const fail = (error: unknown) => {
          if (closed()) return
          onFail(error)
        }
        // Tolerate parser throws on malformed JSON lines. External CLI
        // tools (claude-code/gemini-cli/codex-cli) can emit anything, and
        // a synchronous throw in this data callback used to escape the
        // stdout.on("data") handler and tear down the host process —
        // stdout.on("error") only catches transport errors, not synchronous
        // throws.
        const safeParse = (line: string): ReturnType<typeof parser.parseStreamLine> | null => {
          try {
            return parser.parseStreamLine(line)
          } catch (err) {
            log.warn("CLI provider parseStreamLine failed", {
              error: toErrorMessage(err),
              line: line.length > 200 ? line.slice(0, 200) + "…" : line,
            })
            return null
          }
        }
        const processStdoutText = (textChunk: string) => {
          if (!textChunk || closed()) return
          raw.push(textChunk)
          const text = remainder + textChunk
          const lines = text.split("\n")
          remainder = lines.pop() ?? ""
          for (const line of lines) {
            if (!line.trim()) continue
            const delta = safeParse(line)
            if (delta) {
              emitted = true
              output.push(delta)
              controller.enqueue({ type: "text-delta", id: textId, delta })
            }
          }
        }
        timer = setTimeout(() => {
          onTimeout()
        }, CLI_TIMEOUT_MS)

        controller.enqueue({ type: "stream-start", warnings: [] })
        controller.enqueue({ type: "text-start", id: textId })

        const flushOutput = () => {
          processStdoutText(stdoutDecoder.end())
          if (remainder.trim()) {
            const delta = safeParse(remainder)
            if (delta) {
              emitted = true
              output.push(delta)
              controller.enqueue({ type: "text-delta", id: textId, delta })
            }
          }
          // Stream parsers intentionally ignore control and error events. Let
          // the complete parser surface structured errors first, then retain
          // non-empty plain stdout when that parser has no text to return.
          const rawOutput = raw.join("")
          const complete = parser.parseComplete(rawOutput)
          const fallback = complete.text || rawFallbackText(rawOutput)
          if (!emitted && fallback) {
            output.push(fallback)
            controller.enqueue({ type: "text-delta", id: textId, delta: fallback })
          }
        }
        const finishSuccess = () => {
          if (!stdoutEnded || exitCode === undefined || exitCode !== 0 || closed()) return
          endText()
          controller.enqueue({
            type: "finish",
            usage: estimatedUsage(text, output.join("")),
            finishReason: { unified: "stop", raw: undefined },
          })
          safeClose()
        }
        const finishFailure = () => {
          if (!stdoutEnded || !stderrEnded || exitCode === undefined || exitCode === 0 || closed()) return
          fail(
            abort.isAborted
              ? abort.abortError
              : new Error(formatCliFailure(exitCode, Buffer.from(raw.join("")), Buffer.concat(stderrRaw))),
          )
        }
        if (!proc.stdout || !proc.stderr) {
          controller.enqueue({ type: "error", error: new Error("CLI process output not available") })
          safeClose()
          return
        }
        const stdout = proc.stdout
        const stderr = proc.stderr
        onStderrData = (chunk: Buffer) => {
          stderrRaw.push(chunk)
        }
        onStderrError = (err: Error) => {
          clearTimeout(timer)
          abort.kill()
          if (closed()) return
          fail(abort.isAborted ? abort.abortError : err)
        }
        onStderrEnd = () => {
          if (closed()) return
          stderrEnded = true
          finishFailure()
        }
        onStdoutData = (chunk: Buffer) => {
          if (closed()) return
          processStdoutText(stdoutDecoder.write(chunk))
        }
        onStdoutEnd = () => {
          if (closed()) return
          stdoutEnded = true
          try {
            flushOutput()
          } catch (error) {
            fail(error)
            return
          }
          finishSuccess()
          finishFailure()
        }
        onStdoutError = (err: Error) => {
          clearTimeout(timer)
          abort.kill()
          if (closed()) return
          fail(abort.isAborted ? abort.abortError : err)
        }

        stderr.on("data", onStderrData)
        stderr.on("error", onStderrError)
        stderr.on("end", onStderrEnd)
        stdout.on("data", onStdoutData)
        stdout.on("end", onStdoutEnd)
        stdout.on("error", onStdoutError)

        cancelStreaming = safeAbort
        proc.exited
          .then((code) => {
            if (closed()) return
            exitCode = code
            if (code !== 0) {
              finishFailure()
              return
            }
            finishSuccess()
          })
          .catch((err) => {
            clearTimeout(timer)
            if (closed()) return
            fail(abort.isAborted ? abort.abortError : (err ?? new Error("CLI process killed by signal")))
          })
      },
      cancel() {
        done = true
        cancelStreaming?.()
        if (timer) clearTimeout(timer)
        return abort.kill()
      },
    })

    return { stream }
  }
}
