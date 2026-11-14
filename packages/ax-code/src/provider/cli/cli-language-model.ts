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
import { assertCliCommandSize, materializeCliPrompt } from "./prompt-transport"
import {
  parseCliJsonEventLine,
  stdoutHasCliJsonEvents,
  type CliOutputParser,
  type CliStreamState,
  type CliUsage,
} from "./parser"
import { StringDecoder } from "node:string_decoder"
import { toErrorMessage } from "@/util/error-message"
import { Log } from "@/util/log"
import { ScopedFlag } from "@/flag/scoped"
import { Token } from "@/util/token"
import { withTimeout } from "@/util/timeout"
import { markEstimatedUsage } from "../usage"
import { parseJsonResult } from "../../util/json-value"
import { Shell } from "@/shell/shell"
import { Instance } from "@/project/instance"
import { cliEffortArgs, cliEffortFromProviderOptions } from "./effort"
import { dshLauncherArgs, ensureDshPrivacyPatch } from "./dsh"
import { ensureKimiReadOnlyAgentFile } from "./kimi-isolation"
import { cliIsolationArgs, resolveCliIsolationMode, type CliIsolationArgs } from "./isolation"

const log = Log.create({ service: "provider.cli-language-model" })

const REJECTED_OPTIONAL_ARGS = new Map<string, Set<string>>()
const NO_REJECTED_OPTIONAL_ARGS: ReadonlySet<string> = new Set()

function rejectedOptionalArgsKey(providerID: string, binary: string): string {
  return `${providerID}\0${binary}`
}

function rememberRejectedOptionalArg(providerID: string, binary: string, flag: string): void {
  const key = rejectedOptionalArgsKey(providerID, binary)
  const rejected = REJECTED_OPTIONAL_ARGS.get(key)
  if (rejected) {
    rejected.add(flag)
    return
  }
  REJECTED_OPTIONAL_ARGS.set(key, new Set([flag]))
}

/** Optional flags already rejected by this provider binary in this process. */
export function rejectedOptionalArgsFor(providerID: string, binary: string): ReadonlySet<string> {
  return REJECTED_OPTIONAL_ARGS.get(rejectedOptionalArgsKey(providerID, binary)) ?? NO_REJECTED_OPTIONAL_ARGS
}

/** Test-only: forget which optional flags the CLIs rejected. */
export function resetRejectedOptionalCliFlags(): void {
  REJECTED_OPTIONAL_ARGS.clear()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Return the optional flag a CLI rejected, if its stderr reports an unknown
 * argument naming that flag. Covers the common clap/yargs/argparse shapes:
 * "unexpected argument '--flag'", "unknown option '--flag'",
 * "unknown option: --flag", "unrecognized option '--flag'",
 * "unknown argument --flag", and Python argparse's
 * "unrecognized arguments: ... --flag" list, where the flag may follow other
 * tokens on the same line. Also covers Go's flag package, which reports
 * "flag provided but not defined: -flag" and prints the name with a single dash
 * even when the flag was given as `--flag`, so either leading dash form matches.
 * The flag is matched case-insensitively and whole, so `--disable-reminders`
 * does not match `--disable-reminders-x`.
 */
export function rejectedOptionalCliFlag(stderr: string, optionalArgs: readonly string[]): string | undefined {
  if (!stderr) return undefined
  for (const flag of optionalArgs) {
    const wholeFlag = `(?![\\w-])`
    // clap/yargs/argparse single-argument messages, plus argparse's
    // "unrecognized arguments:" list where the flag may follow other tokens.
    const direct = new RegExp(
      `(?:unexpected argument|unknown (?:option|argument)|unrecognized option|unrecognized arguments[^\\n]*?)` +
        `\\s*[:=]?\\s*['"]?${escapeRegExp(flag)}${wholeFlag}`,
      "i",
    )
    if (direct.test(stderr)) return flag
    // Go's flag package: "flag provided but not defined: -flag" (one dash).
    const go = new RegExp(
      `flag provided but not defined:\\s*-{1,2}${escapeRegExp(flag.replace(/^-+/, ""))}${wholeFlag}`,
      "i",
    )
    if (go.test(stderr)) return flag
  }
  return undefined
}

/**
 * Internal signal that a run failed only because the installed CLI rejected an
 * optional flag. `doGenerate` catches it, records the flag, and retries once.
 */
class OptionalCliFlagRejectedError extends Error {
  constructor(
    readonly flag: string,
    message: string,
  ) {
    super(message)
    this.name = "OptionalCliFlagRejectedError"
  }
}

export interface CliLanguageModelConfig {
  providerID: string
  modelID: string
  binary: string
  args: string[]
  /** Boolean flags that may be dropped if the installed CLI does not know them. */
  optionalArgs?: string[]
  parser: CliOutputParser
  promptMode: "stdin" | "stream-json" | "arg" | "positional" | "file"
  promptFlag?: string
  workspaceArg?: string
  /** Efforts this model accepts, from the CLI's model cache; overrides the provider default list. */
  efforts?: readonly string[]
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

function formatCliNoOutput(stdout: Buffer, stderr: Buffer) {
  const detail = formatCliDetail(stdout, stderr)
  return detail
    ? `CLI exited successfully without producing assistant output: ${detail.slice(0, 1000)}`
    : "CLI exited successfully without producing assistant output"
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
// After a reliable terminal event, give the CLI a moment to exit before killing
// it. The stream has already finished, so this only cleans up the child.
const CLI_TERMINAL_GRACE_MS = 2_000

export function cliEnv(providerEnvKeys: readonly string[] = [], providerID?: string) {
  const env: Record<string, string> = {
    ...Env.withCliProviderKeys(Env.sanitize(), providerID),
    TERM: "dumb",
    NO_COLOR: "1",
  }
  // DeepSeek Harness defaults to FEEDBACK_ONLY OTel session telemetry.
  if (providerID === "dsh-cli") env.DSH_TELEMETRY_MODE = "DISABLED"
  // Provider metadata may name additional non-secret runtime variables, but
  // it must not punch through the sanitizer. In particular, project config
  // can override provider metadata and must not be able to request arbitrary
  // credentials from the parent environment.
  const requested = Object.fromEntries(providerEnvKeys.map((key) => [key, process.env[key]]))
  Object.assign(env, Env.sanitize(requested))
  return env
}

async function writeCliPrompt(
  stdin: NonNullable<ReturnType<typeof Process.spawn>["stdin"]>,
  text: string,
): Promise<void> {
  let rejectDrain: ((error: Error) => void) | undefined
  let onDrain: (() => void) | undefined
  let emittedError = false

  const clearDrain = () => {
    if (onDrain) stdin.off("drain", onDrain)
    onDrain = undefined
    rejectDrain = undefined
  }
  const onError = (error: Error) => {
    emittedError = true
    log.debug("cli provider stdin closed", { error: toErrorMessage(error) })
    const reject = rejectDrain
    clearDrain()
    reject?.(error)
  }
  const onClose = () => {
    const reject = rejectDrain
    clearDrain()
    stdin.off("error", onError)
    reject?.(new Error("CLI provider stdin closed before buffered prompt data drained"))
  }

  // Keep the listener for the stream lifetime. EPIPE may arrive after end()
  // and must never escape as an uncaught EventEmitter "error" event.
  stdin.on("error", onError)
  stdin.once("close", onClose)

  try {
    const wrote = stdin.write(text)
    if (wrote === false) {
      await new Promise<void>((resolve, reject) => {
        onDrain = () => {
          clearDrain()
          resolve()
        }
        rejectDrain = reject
        stdin.once("drain", onDrain)
      })
    }
    stdin.end()
  } catch (error) {
    // An emitted stream error is followed by `close`; leave the handler in
    // place until then so a late EPIPE cannot become uncaught. Synchronous
    // write/end failures do not have that lifecycle, so release immediately.
    if (!emittedError) {
      clearDrain()
      stdin.off("error", onError)
      stdin.off("close", onClose)
    }
    throw error
  }
}

/**
 * CLI providers have no structured-output API, so a generateObject call's
 * `responseFormat: {type: "json"}` must travel inside the prompt text —
 * without this the CLI answers in prose and the SDK's JSON parse fails
 * ("No object generated: response did not match schema") for every
 * council/arena member backed by a CLI bridge.
 */
function jsonResponseInstruction(responseFormat: LanguageModelV3CallOptions["responseFormat"]): string | undefined {
  if (responseFormat?.type !== "json") return undefined
  const schema = responseFormat.schema
    ? `\nThe JSON must validate against this JSON Schema:\n${JSON.stringify(responseFormat.schema)}`
    : ""
  return [
    "<json_output>",
    "Respond with ONLY a single valid JSON value — no prose before or after, no markdown code fences." + schema,
    "</json_output>",
  ].join("\n")
}

/**
 * Best-effort extraction of a JSON payload from CLI output. Coding CLIs
 * routinely wrap JSON in ```json fences or surround it with a sentence of
 * prose despite instructions; returning the raw text in those cases fails
 * the SDK's strict parse. Falls back to the original text when nothing
 * parseable is found so the caller's own error surfaces unchanged.
 */
export function extractJsonPayload(text: string): string {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/i)
  const candidate = (fence?.[1] ?? trimmed).trim()
  if (!candidate) return text
  if (parseJsonResult(candidate).ok) return candidate
  const start = candidate.search(/[{[]/)
  if (start === -1) return text
  const close = candidate[start] === "{" ? "}" : "]"
  const end = candidate.lastIndexOf(close)
  if (end <= start) return text
  const slice = candidate.slice(start, end + 1)
  return parseJsonResult(slice).ok ? slice : text
}

function replaceArgValue(args: string[], flag: string, value: string): string[] {
  const next = [...args]
  const index = next.indexOf(flag)
  if (index === -1) {
    next.push(flag, value)
    return next
  }
  next[index + 1] = value
  return next
}

export function buildCliCommand(
  config: CliLanguageModelConfig,
  prompt: string,
  workspaceDirectory?: string,
  effort?: string,
  isolation?: CliIsolationArgs,
) {
  // Skip optional flags this binary has already rejected in this process so a
  // retry (and every later call) omits them without paying for another failed
  // spawn. Recorded at the front so commander options still see them early.
  const rejected = rejectedOptionalArgsFor(config.providerID, config.binary)
  const optionalArgs = (config.optionalArgs ?? []).filter((arg) => !rejected.has(arg))
  // Isolation is a ceiling: the vendor CLI must never run with more access
  // than the AX session has. Resolve here so every caller (generate, stream,
  // probe) gets the same mapping; startProcess passes a prevalidated plan so
  // unsupported combinations fail before any temp file is created.
  const plan = isolation ?? cliIsolationArgs(config.providerID, resolveCliIsolationMode(), ScopedFlag.autonomous())
  const baseArgs = plan.replace ? replaceArgValue(config.args, plan.replace.flag, plan.replace.value) : config.args
  const cmd = [
    config.binary,
    ...(config.providerID === "dsh-cli" ? dshLauncherArgs() : []),
    ...baseArgs,
    ...optionalArgs,
    ...plan.args,
    ...cliEffortArgs(config.providerID, effort, config.efforts),
  ]
  if (config.workspaceArg && workspaceDirectory) cmd.push(config.workspaceArg, workspaceDirectory)
  if (config.modelID !== config.providerID) {
    cmd.push("--model", config.modelID)
  }
  if (config.promptMode === "arg") cmd.push(config.promptFlag ?? "-p", prompt)
  if (config.promptMode === "positional") cmd.push(prompt)
  // File mode receives an already-materialized path, never the prompt text.
  if (config.promptMode === "file") cmd.push(config.promptFlag ?? "--prompt-file", prompt)
  return cmd
}

function estimatedUsage(input: string, output: string): LanguageModelV3Usage {
  const inputTokens = Token.estimate(input)
  const outputTokens = Token.estimate(output)
  const usage = markEstimatedUsage({
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
  })
  // The AI SDK rebuilds usage (asLanguageModelUsage) into a fresh object,
  // dropping the non-enumerable marker on the object above; it copies `raw` by
  // reference, so mirror the marker there for the consumers that read the
  // SDK-normalized usage (processor ledger, observed window, session usage).
  // Non-enumerable so it never changes the shape callers compare or serialize.
  Object.defineProperty(usage, "raw", { value: markEstimatedUsage({}), enumerable: false, configurable: true })
  return usage
}

// Map normalized CLI usage to the V3 shape. Real usage is intentionally not
// marked estimated, so the token ledger can anchor on it.
function mapCliUsage(usage: CliUsage | undefined): LanguageModelV3Usage | undefined {
  if (!usage) return undefined
  const cacheRead = usage.cacheReadTokens ?? 0
  const cacheWrite = usage.cacheWriteTokens ?? 0
  const reasoning = usage.reasoningTokens ?? 0
  return {
    inputTokens: {
      total: usage.inputTokens,
      noCache: Math.max(0, usage.inputTokens - cacheRead - cacheWrite),
      cacheRead,
      cacheWrite,
    },
    outputTokens: {
      total: usage.outputTokens,
      text: Math.max(0, usage.outputTokens - reasoning),
      reasoning,
    },
  }
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

  private buildCmd(
    prompt: string,
    providerOptions?: LanguageModelV3CallOptions["providerOptions"],
    isolation?: CliIsolationArgs,
  ) {
    const effort = cliEffortFromProviderOptions(this.config.providerID, providerOptions, this.config.efforts)
    return buildCliCommand(this.config, prompt, currentInstanceDirectory(), effort, isolation)
  }

  private useStdin() {
    return this.config.promptMode === "stdin" || this.config.promptMode === "stream-json"
  }

  private stdinPrompt(text: string): string {
    if (this.config.promptMode !== "stream-json") return text
    return JSON.stringify({ event: "user", message: { content: text } }) + "\n"
  }

  private async startProcess(options: LanguageModelV3CallOptions, jsonInstruction?: string) {
    // Resolve the isolation ceiling before creating any temp files: a CLI that
    // cannot enforce the session's mode must fail before spawn, not after
    // attachments or the prompt file have been materialized.
    const isolation = cliIsolationArgs(this.config.providerID, resolveCliIsolationMode(), ScopedFlag.autonomous())
    const attachments = await materializeCliAttachments(options.prompt)
    let promptFile: Awaited<ReturnType<typeof materializeCliPrompt>> | undefined
    const cleanup = async () => {
      await Promise.all([attachments.cleanup(), promptFile?.cleanup()])
    }
    try {
      const promptText = promptToText(options.prompt, {
        providerID: this.config.providerID,
        attachments: attachments.refs,
      })
      const text = jsonInstruction ? `${promptText}\n\n${jsonInstruction}` : promptText
      if (this.config.promptMode === "file") promptFile = await materializeCliPrompt(text)
      // Materializing attachments or the prompt yields to cancellation.
      if (options.abortSignal?.aborted) throw readAbortError(options.abortSignal)
      if (this.config.providerID === "dsh-cli") await ensureDshPrivacyPatch()
      // Read-only Kimi runs load an AX-written agent definition that allowlists
      // only Read/Glob/Grep. Materialize it before spawn; a write failure fails
      // the launch instead of falling back to an unrestricted run.
      if (this.config.providerID === "kimi-cli" && isolation.args.includes("--agent-file")) {
        await ensureKimiReadOnlyAgentFile()
      }
      const cmd = this.buildCmd(promptFile?.file ?? text, options.providerOptions, isolation)
      assertCliCommandSize(cmd, this.config.providerID)
      const proc = Process.spawn(cmd, {
        cwd: currentInstanceDirectory(),
        stdin: this.useStdin() ? "pipe" : "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: cliEnv(this.config.providerEnvKeys, this.config.providerID),
        // Group leader so Shell.killTree terminates subprocesses on abort/timeout.
        detached: process.platform !== "win32",
      })
      // Retain input files until exit, including cancellation and asynchronous
      // spawn errors. Callers observe completion only after cleanup finishes.
      proc.exited = proc.exited.finally(cleanup)
      return { proc, text }
    } catch (error) {
      // A synchronous spawn failure never produces a child exit event.
      await cleanup()
      throw error
    }
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
    if (signal?.aborted) onAbort()
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

  /**
   * A stdin write can fail (EPIPE, or "stdin closed before buffered prompt data
   * drained") when the CLI rejected an optional flag and exited before reading
   * the prompt. Wait briefly for that exit and, when it failed with no stdout
   * while stderr names an optional flag, report the flag so the caller can take
   * the normal optional-flag retry path instead of surfacing the stdin error.
   */
  private async optionalFlagFromStdinFailure(
    proc: Process.Child,
    abort: { readonly isAborted: boolean; readonly abortError: Error },
  ): Promise<{ flag: string; failure: string } | undefined> {
    const optionalArgs = this.config.optionalArgs ?? []
    if (optionalArgs.length === 0 || abort.isAborted) return undefined
    let code: number
    try {
      // Bound the wait: a CLI that is still running (or never exits) must not
      // hold the stdin error behind an unbounded await.
      code = await withTimeout(proc.exited, CLI_TERMINAL_GRACE_MS, "CLI provider stdin failure exit timed out")
    } catch {
      return undefined
    }
    // An abort during the wait wins over any flag inference.
    if (abort.isAborted) return undefined
    if (code === 0 || !proc.stdout || !proc.stderr) return undefined
    let stdout: Buffer
    let stderr: Buffer
    try {
      ;[stdout, stderr] = await Promise.all([Process.drain(proc.stdout), Process.drain(proc.stderr)])
    } catch {
      return undefined
    }
    if (stdout.toString().trim()) return undefined
    const flag = rejectedOptionalCliFlag(stderr.toString(), optionalArgs)
    if (!flag) return undefined
    return { flag, failure: formatCliFailure(code, stdout, stderr) }
  }

  async doGenerate(options: LanguageModelV3CallOptions) {
    if (options.abortSignal?.aborted) throw readAbortError(options.abortSignal)

    const jsonInstruction = jsonResponseInstruction(options.responseFormat)
    try {
      return await this.generateOnce(options, jsonInstruction)
    } catch (error) {
      if (!(error instanceof OptionalCliFlagRejectedError)) throw error
      // Remember the rejection even when the caller aborted during this
      // attempt, so later calls still omit the flag.
      rememberRejectedOptionalArg(this.config.providerID, this.config.binary, error.flag)
      // The internal retry signal must never escape doGenerate: an aborted call
      // reports the abort, not the flag rejection.
      if (options.abortSignal?.aborted) throw readAbortError(options.abortSignal)
      log.warn(`${this.config.providerID} rejected ${error.flag}; retrying without it`)
      try {
        return await this.generateOnce(options, jsonInstruction)
      } catch (retryError) {
        // Surface the second attempt's failure exactly like a normal run; the
        // internal retry signal is an implementation detail.
        if (retryError instanceof OptionalCliFlagRejectedError) {
          rememberRejectedOptionalArg(this.config.providerID, this.config.binary, retryError.flag)
          if (options.abortSignal?.aborted) throw readAbortError(options.abortSignal)
          throw new Error(retryError.message)
        }
        throw retryError
      }
    }
  }

  private async generateOnce(options: LanguageModelV3CallOptions, jsonInstruction: string | undefined) {
    const { proc, text } = await this.startProcess(options, jsonInstruction)
    const abort = this.setupProcessAbort(proc, options.abortSignal, "cli generate")

    if (!proc.stdout || !proc.stderr) {
      await abort.kill()
      throw new Error("CLI process output not available")
    }
    if (this.useStdin()) {
      if (!proc.stdin) {
        await abort.kill()
        throw new Error("CLI process stdin not available")
      }
      // Await drain for large prompts. ChildProcess.stdin.write returns
      // false when the buffer is full; without waiting, .end() can ship
      // before the tail of a >64KB prompt has been flushed and macOS
      // sometimes EOFs the child mid-prompt, surfacing as "model returned
      // nothing" with no error. Strict `=== false` check so non-Writable
      // test mocks (write() returning undefined) don't enter the drain
      // path and fail on the absence of .once.
      //
      // A write failure (e.g. EPIPE) does not mean the child has exited —
      // without an explicit kill here the process was left running with no
      // one attached to its stdout/stderr or awaiting its exit, orphaning it.
      try {
        // Bound the stdin drain: a child that never reads stdin and never exits
        // would otherwise leave this await unsettled forever (the overall CLI
        // timeout is armed only after the write completes).
        await withTimeout(
          writeCliPrompt(proc.stdin, this.stdinPrompt(text)),
          CLI_TIMEOUT_MS,
          "CLI provider stdin write timed out",
        )
      } catch (error) {
        // A rejected optional flag can make the CLI exit before reading stdin,
        // so the write surfaces as EPIPE / a closed stdin. Treat that as the
        // flag rejection so the normal retry (without the flag) can run.
        const rejected = await this.optionalFlagFromStdinFailure(proc, abort)
        if (rejected) {
          rememberRejectedOptionalArg(this.config.providerID, this.config.binary, rejected.flag)
          await abort.kill()
          if (abort.isAborted) throw abort.abortError
          throw new OptionalCliFlagRejectedError(rejected.flag, rejected.failure)
        }
        await abort.kill()
        if (abort.isAborted) throw abort.abortError
        throw error
      }
    }
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    let resolveTimeout: (() => void) | undefined
    // Reset the idle ceiling on any stdout/stderr activity, exactly like
    // doStream. The previous fixed 5-minute wall clock killed long but healthy
    // CLI runs (generateObject / council members) that kept producing output.
    const armIdleTimer = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      // Keep the idle timer ref'd — it is the intentional ceiling for a hung
      // provider process and must keep the event loop alive until it fires.
      timeoutTimer = setTimeout(() => resolveTimeout?.(), CLI_TIMEOUT_MS)
    }
    proc.exited.catch((err) => {
      log.debug("cli process exited with error", {
        error: toErrorMessage(err),
      })
    })
    // Collect exit + full stdout/stderr. On timeout we still await this (after
    // kill) so the error can include partial CLI diagnostics — same idea as
    // doStream's formatCliTimeout path.
    const result = Promise.all([proc.exited, Process.drain(proc.stdout), Process.drain(proc.stderr)])
    result.catch((err) => {
      log.warn("cli language model result collection failed", {
        error: toErrorMessage(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
    })
    type GenerateOutcome = { kind: "result"; value: [number, Buffer, Buffer] } | { kind: "timeout" }
    const timeout = new Promise<GenerateOutcome>((resolve) => {
      resolveTimeout = () => resolve({ kind: "timeout" })
    })
    const onActivity = () => armIdleTimer()
    proc.stdout.on("data", onActivity)
    proc.stderr.on("data", onActivity)
    armIdleTimer()
    let code: number
    let stdout: Buffer
    let stderr: Buffer
    try {
      const outcome = await Promise.race([
        result.then((value): GenerateOutcome => ({ kind: "result", value })),
        timeout,
      ])
      if (outcome.kind === "timeout") {
        await abort.kill()
        let out: Buffer = Buffer.alloc(0)
        let err: Buffer = Buffer.alloc(0)
        try {
          // After kill, buffers usually drain quickly; bound the wait so a
          // stuck pipe cannot hang the timeout path forever.
          const drained = await Promise.race([
            result.then((value) => value),
            new Promise<null>((resolve) => {
              const drainTimer = setTimeout(() => resolve(null), 1_000)
              drainTimer.unref?.()
            }),
          ])
          if (drained) {
            ;[, out, err] = drained
          }
        } catch (error) {
          log.debug("cli generate timeout drain failed", { error: toErrorMessage(error) })
        }
        throw new Error(formatCliTimeout(out, err))
      }
      ;[code, stdout, stderr] = outcome.value
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      proc.stdout.off("data", onActivity)
      proc.stderr.off("data", onActivity)
      await abort.killPromise
    }
    const stdoutText = stdout.toString()
    // Detect an optional-flag rejection before the abort throw: a run that
    // produced nothing and failed only because of a flag is still evidence the
    // flag is unsupported, so remember it for later calls even when the caller
    // aborted as the attempt exited.
    if (code !== 0 && !stdoutText.trim()) {
      const rejected = rejectedOptionalCliFlag(stderr.toString(), this.config.optionalArgs ?? [])
      if (rejected) {
        const failure = formatCliFailure(code, stdout, stderr)
        rememberRejectedOptionalArg(this.config.providerID, this.config.binary, rejected)
        // Aborts never retry; they surface the caller's abort error.
        if (!abort.isAborted) throw new OptionalCliFlagRejectedError(rejected, failure)
      }
    }
    if (abort.isAborted) throw abort.abortError
    if (code !== 0) throw new Error(formatCliFailure(code, stdout, stderr))

    const rawStdout = stdout.toString()
    const parsed = this.config.parser.parseComplete(rawStdout)
    if (!parsed.text.trim()) throw new Error(formatCliNoOutput(stdout, stderr))

    const outputText = jsonInstruction ? extractJsonPayload(parsed.text) : parsed.text
    return {
      content: [{ type: "text" as const, text: outputText }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: mapCliUsage(this.config.parser.parseUsage?.(rawStdout)) ?? estimatedUsage(text, outputText),
      warnings: [],
    }
  }

  async doStream(options: LanguageModelV3CallOptions) {
    if (options.abortSignal?.aborted) throw readAbortError(options.abortSignal)

    let { proc, text } = await this.startProcess(options)
    let abort = this.setupProcessAbort(proc, options.abortSignal, "cli stream")
    // At most one optional-flag retry per stream, matching doGenerate.
    let retried = false

    if (!proc.stdout || !proc.stderr) {
      await abort.kill()
      throw new Error("CLI process output not available")
    }
    if (this.useStdin()) {
      if (!proc.stdin) {
        await abort.kill()
        throw new Error("CLI process stdin not available")
      }
      // Await drain for large prompts. ChildProcess.stdin.write returns
      // false when the buffer is full; without waiting, .end() can ship
      // before the tail of a >64KB prompt has been flushed and macOS
      // sometimes EOFs the child mid-prompt, surfacing as "model returned
      // nothing" with no error. Strict `=== false` check so non-Writable
      // test mocks (write() returning undefined) don't enter the drain
      // path and fail on the absence of .once.
      //
      // A write failure (e.g. EPIPE) does not mean the child has exited —
      // without an explicit kill here the process was left running with no
      // one attached to its stdout/stderr or awaiting its exit, orphaning it.
      let stdinError: unknown
      try {
        // Bound the stdin drain: a child that never reads stdin and never exits
        // would otherwise leave this await unsettled forever (the overall CLI
        // timeout is armed only after the write completes).
        await withTimeout(
          writeCliPrompt(proc.stdin, this.stdinPrompt(text)),
          CLI_TIMEOUT_MS,
          "CLI provider stdin write timed out",
        )
      } catch (error) {
        stdinError = error
      }
      if (stdinError !== undefined) {
        // A rejected optional flag can make the CLI exit before reading stdin,
        // so the write surfaces as EPIPE / a closed stdin. Retry once without
        // the flag before reporting the stdin error.
        const rejected = await this.optionalFlagFromStdinFailure(proc, abort)
        if (!rejected) {
          await abort.kill()
          if (abort.isAborted) throw abort.abortError
          throw stdinError
        }
        rememberRejectedOptionalArg(this.config.providerID, this.config.binary, rejected.flag)
        await abort.kill()
        if (abort.isAborted) throw abort.abortError
        log.warn(`${this.config.providerID} rejected ${rejected.flag}; retrying without it`)
        retried = true
        ;({ proc, text } = await this.startProcess(options))
        abort = this.setupProcessAbort(proc, options.abortSignal, "cli stream")
        if (!proc.stdout || !proc.stderr) {
          await abort.kill()
          throw new Error("CLI process output not available")
        }
        if (!proc.stdin) {
          await abort.kill()
          throw new Error("CLI process stdin not available")
        }
        try {
          await withTimeout(
            writeCliPrompt(proc.stdin, this.stdinPrompt(text)),
            CLI_TIMEOUT_MS,
            "CLI provider stdin write timed out",
          )
        } catch (retryError) {
          await abort.kill()
          if (abort.isAborted) throw abort.abortError
          throw retryError
        }
      }
    }
    const config = this.config
    const parser = config.parser
    // `start()` is a method on the stream source object, so its `this` is not
    // the model. Keep a bound reference for the retry path.
    const model = this
    const textId = "cli-0"
    // Parsers that need to distinguish separate messages on one stream (for
    // example Kimi) keep their cursor here, scoped to this stream.
    const streamState: CliStreamState = {}

    let done = false
    let timer: ReturnType<typeof setTimeout>
    let cancelStreaming: (() => void) | undefined
    // Incremented for every process attached to this stream. Stale handlers from
    // a rejected attempt become no-ops once a retry attaches.
    let attempt = 0
    let retrying = false

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
            if (onStdoutEnd) proc.stdout.off("close", onStdoutEnd)
          }
          if (proc.stderr) {
            if (onStderrData) proc.stderr.off("data", onStderrData)
            if (onStderrError) proc.stderr.off("error", onStderrError)
            if (onStderrEnd) proc.stderr.off("end", onStderrEnd)
            if (onStderrEnd) proc.stderr.off("close", onStderrEnd)
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
        // Reset the CLI idle ceiling on any process activity (stdout or
        // stderr). Long-running CLI agents that start a local server often
        // go quiet on the model stream while the child is still working;
        // without activity reset the hard CLI_TIMEOUT_MS ceiling aborts a
        // healthy live-run and can leave orphans if kill races the child (#382).
        const armCliActivityTimer = () => {
          clearTimeout(timer)
          timer = setTimeout(() => {
            onTimeout()
          }, CLI_TIMEOUT_MS)
          timer.unref?.()
        }
        const onFail = (error: unknown) => {
          if (closed()) return
          endText()
          controller.enqueue({ type: "error", error })
          safeClose()
        }

        let remainder = ""
        let emitted = false
        // Tracks whether any structured JSONL event has been seen on this
        // stream. Plain-text CLIs (e.g. `grok -p`) never emit one; for them
        // the line split below consumes the newlines that carry markdown
        // structure (tables, lists, paragraph breaks), so raw lines must get
        // their newline back. Structured events carry newlines inside their
        // payloads and must not get separators.
        let sawStructuredEvent = false
        let textOpen = true
        let stdoutEnded = false
        let stderrEnded = false
        let exitCode: number | undefined
        let raw: string[] = []
        let output: string[] = []
        let stderrRaw: Buffer[] = []
        let stdoutDecoder = new StringDecoder("utf8")
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
        // tools (claude-code/codex-cli) can emit anything, and
        // a synchronous throw in this data callback used to escape the
        // stdout.on("data") handler and tear down the host process —
        // stdout.on("error") only catches transport errors, not synchronous
        // throws.
        const safeParse = (line: string): ReturnType<typeof parser.parseStreamLine> | null => {
          try {
            return parser.parseStreamLine(line, streamState)
          } catch (err) {
            log.warn("CLI provider parseStreamLine failed", {
              error: toErrorMessage(err),
              line: line.length > 200 ? line.slice(0, 200) + "…" : line,
            })
            return null
          }
        }
        const emitDelta = (delta: string) => {
          emitted = true
          output.push(delta)
          controller.enqueue({ type: "text-delta", id: textId, delta })
        }
        const processStdoutText = (textChunk: string) => {
          if (!textChunk || closed()) return
          raw.push(textChunk)
          const text = remainder + textChunk
          const lines = text.split("\n")
          remainder = lines.pop() ?? ""
          for (const line of lines) {
            if (!line.trim()) {
              // Blank line: a paragraph break for plain-text CLIs, noise for
              // JSONL ones. Skip until real output has started so the text
              // does not gain a leading newline.
              if (!sawStructuredEvent && emitted) emitDelta("\n")
              continue
            }
            // Let the parser decide raw-vs-event. A plain reply line that happens
            // to parse as JSON (grok without --output-format) is still raw text
            // and must keep the newline the split consumed.
            const rawLine = parser.streamLineIsRaw?.(line, streamState)
            const structured = rawLine === undefined ? parseCliJsonEventLine(line) !== undefined : !rawLine
            if (structured) sawStructuredEvent = true
            const delta = safeParse(line)
            if (delta) emitDelta(structured ? delta : delta + "\n")
            if (parser.isTerminalEvent?.(line)) {
              finishTerminal()
              return
            }
          }
        }
        armCliActivityTimer()

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
          // the complete parser surface structured text first, then retain
          // non-empty plain stdout when that parser has no text to return.
          // Do not raw-fallback over structured JSONL (e.g. kimi meta/tool-only
          // lines) or we re-leak control payloads the complete parser dropped.
          const rawOutput = raw.join("")
          const complete = parser.parseComplete(rawOutput)
          const fallback = complete.text || (stdoutHasCliJsonEvents(rawOutput) ? "" : rawFallbackText(rawOutput))
          if (!emitted && fallback) {
            output.push(fallback)
            controller.enqueue({ type: "text-delta", id: textId, delta: fallback })
          }
        }
        const flushTerminalRemainder = () => {
          const tail = remainder
          remainder = ""
          if (!tail.trim()) return
          const delta = safeParse(tail)
          if (delta) emitDelta(delta)
        }
        // Finish as soon as the CLI's reliable terminal event arrives, because a
        // CLI (Muse, for example) may keep its process alive after the answer.
        // The stream must not wait for exit; the child is reaped/killed in the
        // background, and its exit still runs the temp-file cleanup attached to
        // `proc.exited`.
        const finishTerminal = () => {
          if (closed()) return
          // A CLI may flush its terminal event while handling cancellation.
          // Preserve the caller's abort just as the process-exit path does.
          if (abort.isAborted) {
            fail(abort.abortError)
            return
          }
          try {
            flushTerminalRemainder()
          } catch (error) {
            fail(error)
            return
          }
          if (!output.join("").trim()) return
          // The whole decoded chunk (including the unterminated tail) was
          // already pushed to `raw`, so appending `remainder` would double it.
          const rawOutput = raw.join("")
          endText()
          controller.enqueue({
            type: "finish",
            usage: mapCliUsage(parser.parseUsage?.(rawOutput)) ?? estimatedUsage(text, output.join("")),
            finishReason: { unified: "stop", raw: undefined },
          })
          safeClose()
          const reaper = setTimeout(() => {
            void abort.kill()
          }, CLI_TERMINAL_GRACE_MS)
          reaper.unref?.()
          void proc.exited.then(
            () => clearTimeout(reaper),
            () => clearTimeout(reaper),
          )
        }
        const finishSuccess = () => {
          // Wait for stderr too so empty-output failures can include stderr detail.
          if (retrying || !stdoutEnded || !stderrEnded || exitCode === undefined || exitCode !== 0 || closed()) return
          // The caller cancelled: a CLI that traps the signal and exits 0 must
          // not be reported as a completed model turn.
          if (abort.isAborted) {
            fail(abort.abortError)
            return
          }
          if (!output.join("").trim()) {
            fail(new Error(formatCliNoOutput(Buffer.from(raw.join("")), Buffer.concat(stderrRaw))))
            return
          }
          endText()
          const rawOutput = raw.join("")
          controller.enqueue({
            type: "finish",
            usage: mapCliUsage(parser.parseUsage?.(rawOutput)) ?? estimatedUsage(text, output.join("")),
            finishReason: { unified: "stop", raw: undefined },
          })
          safeClose()
        }
        const finishFailure = () => {
          if (retrying || !stdoutEnded || !stderrEnded || exitCode === undefined || exitCode === 0 || closed()) return
          if (abort.isAborted) {
            fail(abort.abortError)
            return
          }
          const stdoutText = raw.join("")
          // Retry only when the process produced no stdout at all, the failure
          // names an optional flag, and this stream has not retried yet.
          // Nothing has reached the consumer beyond stream-start/text-start, so
          // the retry can continue this same stream without a second
          // stream-start.
          if (!emitted && !stdoutText.trim()) {
            const rejected = rejectedOptionalCliFlag(Buffer.concat(stderrRaw).toString(), config.optionalArgs ?? [])
            if (rejected) {
              // Remember the flag even on a second rejection so later calls
              // omit it without needing their own retry.
              rememberRejectedOptionalArg(config.providerID, config.binary, rejected)
              if (!retried) {
                retried = true
                retrying = true
                log.warn(`${config.providerID} rejected ${rejected}; retrying without it`)
                startRetry()
                return
              }
            }
          }
          fail(new Error(formatCliFailure(exitCode, Buffer.from(stdoutText), Buffer.concat(stderrRaw))))
        }

        // Spawn the same call once more without the rejected flag. Fresh
        // process, fresh prompt file/attachments, fresh idle timer; the first
        // process's temp files clean up from its own `exited`.
        const startRetry = () => {
          void (async () => {
            cleanupListeners()
            cleanedUp = false
            clearTimeout(timer)
            remainder = ""
            emitted = false
            sawStructuredEvent = false
            stdoutEnded = false
            stderrEnded = false
            exitCode = undefined
            raw = []
            output = []
            stderrRaw = []
            stdoutDecoder = new StringDecoder("utf8")
            try {
              const next = await model.startProcess(options)
              proc = next.proc
              text = next.text
              abort = model.setupProcessAbort(proc, options.abortSignal, "cli stream")
              if (closed()) {
                await abort.kill()
                return
              }
              if (!proc.stdout || !proc.stderr) {
                retrying = false
                fail(new Error("CLI process output not available"))
                return
              }
              if (model.useStdin()) {
                if (!proc.stdin) {
                  retrying = false
                  fail(new Error("CLI process stdin not available"))
                  return
                }
                try {
                  await withTimeout(
                    writeCliPrompt(proc.stdin, model.stdinPrompt(text)),
                    CLI_TIMEOUT_MS,
                    "CLI provider stdin write timed out",
                  )
                } catch (error) {
                  // The retried CLI may reject another optional flag before
                  // reading stdin. Surface that rejection (and remember the
                  // flag) instead of the misleading stdin error.
                  const rejected = await model.optionalFlagFromStdinFailure(proc, abort)
                  if (!rejected) throw error
                  rememberRejectedOptionalArg(config.providerID, config.binary, rejected.flag)
                  await abort.kill()
                  if (closed()) return
                  retrying = false
                  fail(new Error(rejected.failure))
                  return
                }
                if (closed()) {
                  await abort.kill()
                  return
                }
              }
              armCliActivityTimer()
              attach()
            } catch (error) {
              await abort.kill()
              if (closed()) return
              retrying = false
              fail(abort.isAborted ? abort.abortError : error)
            }
          })()
        }

        const attach = () => {
          if (!proc.stdout || !proc.stderr) {
            controller.enqueue({ type: "error", error: new Error("CLI process output not available") })
            safeClose()
            return
          }
          const generation = ++attempt
          const isCurrent = () => generation === attempt
          retrying = false
          const stdout = proc.stdout
          const stderr = proc.stderr
          onStderrData = (chunk: Buffer) => {
            if (!isCurrent()) return
            stderrRaw.push(chunk)
            if (!closed()) armCliActivityTimer()
          }
          onStderrError = (err: Error) => {
            if (!isCurrent()) return
            clearTimeout(timer)
            abort.kill()
            if (closed()) return
            fail(abort.isAborted ? abort.abortError : err)
          }
          onStderrEnd = () => {
            if (!isCurrent() || closed() || stderrEnded) return
            stderrEnded = true
            finishSuccess()
            finishFailure()
          }
          onStdoutData = (chunk: Buffer) => {
            if (!isCurrent() || closed()) return
            armCliActivityTimer()
            processStdoutText(stdoutDecoder.write(chunk))
          }
          onStdoutEnd = () => {
            if (!isCurrent() || closed() || stdoutEnded) return
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
            if (!isCurrent()) return
            clearTimeout(timer)
            abort.kill()
            if (closed()) return
            fail(abort.isAborted ? abort.abortError : err)
          }

          stderr.on("data", onStderrData)
          stderr.on("error", onStderrError)
          // process.ts destroys the pipe after exit (for grandchild-held FDs),
          // which emits 'close' but not 'end'. Treat both as end so a successfully
          // finished CLI that spawned a background child is not reported as a
          // fake timeout once the destroy fires.
          stderr.on("end", onStderrEnd)
          stderr.on("close", onStderrEnd)
          stdout.on("data", onStdoutData)
          stdout.on("end", onStdoutEnd)
          stdout.on("close", onStdoutEnd)
          stdout.on("error", onStdoutError)

          cancelStreaming = safeAbort
          proc.exited
            .then((code) => {
              if (!isCurrent() || closed()) return
              exitCode = code
              if (code !== 0) {
                finishFailure()
                return
              }
              finishSuccess()
            })
            .catch((err) => {
              if (!isCurrent()) return
              clearTimeout(timer)
              if (closed()) return
              fail(abort.isAborted ? abort.abortError : (err ?? new Error("CLI process killed by signal")))
            })
        }

        attach()
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
