import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3StreamPart, LanguageModelV3Usage } from "@ai-sdk/provider"
import { Process } from "../../util/process"
import { Env } from "../../util/env"
import { promptToText } from "./prompt"
import type { CliOutputParser } from "./parser"
import { buffer } from "node:stream/consumers"

export interface CliLanguageModelConfig {
  providerID: string
  modelID: string
  binary: string
  args: string[]
  parser: CliOutputParser
  promptMode: "stdin" | "arg"
  promptFlag?: string
}

function formatCliFailure(code: number, stdout: Buffer, stderr: Buffer) {
  const err = stderr.toString().trim()
  const out = stdout.toString().trim()
  const detail = err || out
  return detail
    ? `CLI exited with code ${code}: ${detail.slice(0, 500)}`
    : `CLI exited with code ${code}`
}

function cliEnv() {
  return { ...Env.sanitize(), TERM: "dumb", NO_COLOR: "1" }
}

function autonomousCliArgs(providerID: string): string[] {
  if (process.env["AX_CODE_AUTONOMOUS"] !== "true") return []
  if (providerID === "claude-code") return ["--dangerously-skip-permissions"]
  if (providerID === "gemini-cli") return ["--approval-mode", "yolo"]
  return []
}

export function buildCliCommand(config: CliLanguageModelConfig, prompt: string) {
  const cmd = [config.binary, ...config.args, ...autonomousCliArgs(config.providerID), "--model", config.modelID]
  if (config.promptMode === "arg") cmd.push(config.promptFlag ?? "-p", prompt)
  return cmd
}
const CLI_TIMEOUT_MS = 300_000 // 5 minutes

const EMPTY_USAGE: LanguageModelV3Usage = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
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
      env: cliEnv(),
      abort: options.abortSignal,
    })

    if (this.useStdin()) {
      if (!proc.stdin) throw new Error("CLI process stdin not available")
      proc.stdin.write(text)
      proc.stdin.end()
    }
    if (!proc.stdout || !proc.stderr) throw new Error("CLI process output not available")

    let timeoutTimer: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_, reject) =>
      timeoutTimer = setTimeout(() => {
        proc.kill("SIGTERM")
        setTimeout(() => proc.kill("SIGKILL"), 5000).unref()
        reject(new Error(`CLI process timed out after ${CLI_TIMEOUT_MS / 1000}s`))
      }, CLI_TIMEOUT_MS),
    )
    const result = Promise.all([proc.exited, buffer(proc.stdout), buffer(proc.stderr)])
    result.catch(() => {})
    const [code, stdout, stderr] = await Promise.race([result, timeout])
    clearTimeout(timeoutTimer!)
    if (code !== 0) {
      throw new Error(formatCliFailure(code, stdout, stderr))
    }

    const parsed = this.config.parser.parseComplete(stdout.toString())

    return {
      content: [{ type: "text" as const, text: parsed.text }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: EMPTY_USAGE,
      warnings: [],
    }
  }

  async doStream(options: LanguageModelV3CallOptions) {
    const text = promptToText(options.prompt)
    const proc = Process.spawn(this.buildCmd(text), {
      stdin: this.useStdin() ? "pipe" : "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: cliEnv(),
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

        timer = setTimeout(() => {
          proc.kill("SIGTERM")
          if (closed()) return
          controller.enqueue({ type: "error", error: new Error(`CLI process timed out after ${CLI_TIMEOUT_MS / 1000}s`) })
          safeClose()
        }, CLI_TIMEOUT_MS)

        controller.enqueue({ type: "stream-start", warnings: [] })
        controller.enqueue({ type: "text-start", id: textId })

        let remainder = ""
        let emitted = false
        let stdoutEnded = false
        let exitCode: number | undefined
        const raw: string[] = []
        const stderrRaw: Buffer[] = []
        const flushOutput = () => {
          if (remainder.trim()) {
            const delta = parser.parseStreamLine(remainder)
            if (delta) {
              emitted = true
              controller.enqueue({ type: "text-delta", id: textId, delta })
            }
          }
          if (!emitted) {
            const fallback = raw.join("").trim()
            if (fallback) controller.enqueue({ type: "text-delta", id: textId, delta: fallback })
          }
        }
        const finishSuccess = () => {
          if (!stdoutEnded || exitCode === undefined || exitCode !== 0 || closed()) return
          controller.enqueue({ type: "text-end", id: textId })
          controller.enqueue({
            type: "finish",
            usage: EMPTY_USAGE,
            finishReason: { unified: "stop", raw: undefined },
          })
          safeClose()
        }
        proc.stderr!.on("data", (chunk: Buffer) => {
          stderrRaw.push(chunk)
        })
        proc.stdout!.on("data", (chunk: Buffer) => {
          if (closed()) return
          const text = remainder + chunk.toString()
          raw.push(chunk.toString())
          const lines = text.split("\n")
          remainder = lines.pop() ?? ""
          for (const line of lines) {
            if (!line.trim()) continue
            const delta = parser.parseStreamLine(line)
            if (delta) {
              emitted = true
              controller.enqueue({ type: "text-delta", id: textId, delta })
            }
          }
        })

        proc.stdout!.on("end", () => {
          clearTimeout(timer)
          if (closed()) return
          stdoutEnded = true
          flushOutput()
          finishSuccess()
        })

        proc.stdout!.on("error", (err: Error) => {
          clearTimeout(timer)
          proc.kill("SIGTERM")
          if (closed()) return
          controller.enqueue({ type: "error", error: err })
          safeClose()
        })

        proc.exited.then((code) => {
          clearTimeout(timer)
          if (closed()) return
          exitCode = code
          if (code !== 0) {
            controller.enqueue({
              type: "error",
              error: new Error(formatCliFailure(code, Buffer.from(raw.join("")), Buffer.concat(stderrRaw))),
            })
            safeClose()
            return
          }
          finishSuccess()
        }).catch((err) => {
          clearTimeout(timer)
          if (closed()) return
          controller.enqueue({ type: "error", error: err ?? new Error("CLI process killed by signal") })
          safeClose()
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
