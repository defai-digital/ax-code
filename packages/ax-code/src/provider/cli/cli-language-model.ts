import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider"
import { Process } from "../../util/process"
import { Env } from "../../util/env"
import { promptToText } from "./prompt"
import type { CliOutputParser } from "./parser"
import { buffer } from "node:stream/consumers"
import { StringDecoder } from "node:string_decoder"
import { Log } from "@/util/log"
import { Flag } from "@/flag/flag"
import { Token } from "@/util/token"
import { markEstimatedUsage } from "../usage"

const log = Log.create({ service: "provider.cli-language-model" })

export interface CliLanguageModelConfig {
  providerID: string
  modelID: string
  binary: string
  args: string[]
  parser: CliOutputParser
  promptMode: "stdin" | "arg"
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

export function cliEnv(providerEnvKeys: readonly string[] = []) {
  const env: Record<string, string> = {
    ...Env.withCliProviderKeys(Env.sanitize()),
    TERM: "dumb",
    NO_COLOR: "1",
  }
  for (const key of providerEnvKeys) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

function autonomousCliArgs(providerID: string): string[] {
  if (!Flag.AX_CODE_AUTONOMOUS) return []
  if (providerID === "claude-code") return ["--dangerously-skip-permissions"]
  if (providerID === "gemini-cli") return ["--approval-mode", "yolo"]
  return []
}

export function buildCliCommand(config: CliLanguageModelConfig, prompt: string) {
  const cmd = [config.binary, ...config.args, ...autonomousCliArgs(config.providerID)]
  if (config.modelID !== config.providerID) cmd.push("--model", config.modelID)
  if (config.promptMode === "arg") cmd.push(config.promptFlag ?? "-p", prompt)
  return cmd
}
const CLI_TIMEOUT_MS = 300_000 // 5 minutes

function estimatedUsage(input: string, output: string): LanguageModelV3Usage {
  const inputTokens = Token.estimate(input)
  const outputTokens = Token.estimate(output)
  return markEstimatedUsage({
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
  })
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

  async doGenerate(options: LanguageModelV3CallOptions) {
    const text = promptToText(options.prompt)
    const proc = Process.spawn(this.buildCmd(text), {
      stdin: this.useStdin() ? "pipe" : "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: cliEnv(this.config.providerEnvKeys),
      abort: options.abortSignal,
    })

    if (this.useStdin()) {
      if (!proc.stdin) throw new Error("CLI process stdin not available")
      proc.stdin.write(text)
      proc.stdin.end()
    }
    if (!proc.stdout || !proc.stderr) throw new Error("CLI process output not available")

    let timeoutTimer: ReturnType<typeof setTimeout>
    let killTimer: ReturnType<typeof setTimeout> | undefined
    proc.exited
      .finally(() => {
        if (killTimer) {
          clearTimeout(killTimer)
          killTimer = undefined
        }
      })
      .catch((err) => {
        log.debug("cli process exited with error", {
          error: err instanceof Error ? err.message : String(err),
        })
      })
    const timeout = new Promise<never>(
      (_, reject) =>
        (timeoutTimer = setTimeout(() => {
          proc.kill("SIGTERM")
          killTimer = setTimeout(() => {
            try {
              proc.kill("SIGKILL")
            } catch {}
          }, 5000)
          killTimer.unref()
          reject(new Error(`CLI process timed out after ${CLI_TIMEOUT_MS / 1000}s`))
        }, CLI_TIMEOUT_MS)),
    )
    const result = Promise.all([proc.exited, buffer(proc.stdout), buffer(proc.stderr)])
    result.catch((err) => {
      log.warn("cli language model result collection failed", {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
    })
    const [code, stdout, stderr] = await Promise.race([result, timeout])
    clearTimeout(timeoutTimer!)
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
    const text = promptToText(options.prompt)
    const proc = Process.spawn(this.buildCmd(text), {
      stdin: this.useStdin() ? "pipe" : "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: cliEnv(this.config.providerEnvKeys),
      abort: options.abortSignal,
    })

    if (this.useStdin()) {
      if (!proc.stdin) throw new Error("CLI process stdin not available")
      proc.stdin.write(text)
      proc.stdin.end()
    }
    if (!proc.stdout || !proc.stderr) throw new Error("CLI process output not available")

    const parser = this.config.parser
    const textId = "cli-0"

    let done = false
    let timer: ReturnType<typeof setTimeout>

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        const closed = () => done || controller.desiredSize === null
        const safeClose = () => {
          if (done) return
          done = true
          controller.close()
        }

        let remainder = ""
        let emitted = false
        let textOpen = true
        let stdoutEnded = false
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
          endText()
          controller.enqueue({ type: "error", error })
          safeClose()
        }
        const processStdoutText = (textChunk: string) => {
          if (!textChunk || closed()) return
          raw.push(textChunk)
          const text = remainder + textChunk
          const lines = text.split("\n")
          remainder = lines.pop() ?? ""
          for (const line of lines) {
            if (!line.trim()) continue
            const delta = parser.parseStreamLine(line)
            if (delta) {
              emitted = true
              output.push(delta)
              controller.enqueue({ type: "text-delta", id: textId, delta })
            }
          }
        }
        timer = setTimeout(() => {
          proc.kill("SIGTERM")
          if (closed()) return
          fail(new Error(formatCliTimeout(Buffer.from(raw.join("")), Buffer.concat(stderrRaw))))
        }, CLI_TIMEOUT_MS)

        controller.enqueue({ type: "stream-start", warnings: [] })
        controller.enqueue({ type: "text-start", id: textId })

        const flushOutput = () => {
          processStdoutText(stdoutDecoder.end())
          if (remainder.trim()) {
            const delta = parser.parseStreamLine(remainder)
            if (delta) {
              emitted = true
              output.push(delta)
              controller.enqueue({ type: "text-delta", id: textId, delta })
            }
          }
          if (!emitted) {
            const fallback = raw.join("").trim()
            if (fallback) {
              output.push(fallback)
              controller.enqueue({ type: "text-delta", id: textId, delta: fallback })
            }
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
        if (!proc.stdout || !proc.stderr) {
          controller.enqueue({ type: "error", error: new Error("CLI process output not available") })
          safeClose()
          return
        }
        const stdout = proc.stdout
        const stderr = proc.stderr
        stderr.on("data", (chunk: Buffer) => {
          stderrRaw.push(chunk)
        })
        stderr.on("error", (err: Error) => {
          clearTimeout(timer)
          proc.kill("SIGTERM")
          if (closed()) return
          fail(err)
        })
        stdout.on("data", (chunk: Buffer) => {
          if (closed()) return
          processStdoutText(stdoutDecoder.write(chunk))
        })

        stdout.on("end", () => {
          clearTimeout(timer)
          if (closed()) return
          stdoutEnded = true
          flushOutput()
          finishSuccess()
        })

        stdout.on("error", (err: Error) => {
          clearTimeout(timer)
          proc.kill("SIGTERM")
          if (closed()) return
          fail(err)
        })

        proc.exited
          .then((code) => {
            clearTimeout(timer)
            if (closed()) return
            exitCode = code
            if (code !== 0) {
              fail(new Error(formatCliFailure(code, Buffer.from(raw.join("")), Buffer.concat(stderrRaw))))
              return
            }
            finishSuccess()
          })
          .catch((err) => {
            clearTimeout(timer)
            if (closed()) return
            fail(err ?? new Error("CLI process killed by signal"))
          })
      },
      cancel() {
        done = true
        clearTimeout(timer)
        proc.kill("SIGTERM")
      },
    })

    return { stream }
  }
}
