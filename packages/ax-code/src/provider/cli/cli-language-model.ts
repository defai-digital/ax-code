import type { LanguageModelV2, LanguageModelV2CallOptions, LanguageModelV2StreamPart } from "@ai-sdk/provider"
import { Process } from "../../util/process"
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

const CLI_ENV = { TERM: "dumb", NO_COLOR: "1", CI: "true" }
const CLI_TIMEOUT_MS = 300_000 // 5 minutes

export class CliLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v2" as const
  readonly provider: string
  readonly modelId: string
  readonly supportedUrls: Record<string, RegExp[]> = {}

  constructor(private config: CliLanguageModelConfig) {
    this.provider = config.providerID
    this.modelId = config.modelID
  }

  private buildCmd(prompt: string) {
    const cmd = [this.config.binary, ...this.config.args, "--model", this.config.modelID]
    if (this.config.promptMode === "arg") cmd.push(this.config.promptFlag ?? "-p", prompt)
    return cmd
  }

  private useStdin() {
    return this.config.promptMode === "stdin"
  }

  async doGenerate(options: LanguageModelV2CallOptions) {
    const text = promptToText(options.prompt)
    const proc = Process.spawn(this.buildCmd(text), {
      stdin: this.useStdin() ? "pipe" : "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: CLI_ENV,
      abort: options.abortSignal,
    })

    if (this.useStdin()) {
      proc.stdin!.write(text)
      proc.stdin!.end()
    }

    let timeoutTimer: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_, reject) =>
      timeoutTimer = setTimeout(() => {
        proc.kill("SIGTERM")
        setTimeout(() => proc.kill("SIGKILL"), 5000).unref()
        reject(new Error(`CLI process timed out after ${CLI_TIMEOUT_MS / 1000}s`))
      }, CLI_TIMEOUT_MS),
    )
    const result = Promise.all([proc.exited, buffer(proc.stdout!), buffer(proc.stderr!)])
    result.catch(() => {})
    const [code, stdout, stderr] = await Promise.race([result, timeout])
    clearTimeout(timeoutTimer!)
    if (code !== 0 && stdout.length === 0) {
      throw new Error(`CLI exited with code ${code}: ${stderr.toString().slice(0, 500)}`)
    }

    const parsed = this.config.parser.parseComplete(stdout.toString())

    return {
      content: [{ type: "text" as const, text: parsed.text }],
      finishReason: "stop" as const,
      usage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
      warnings: [],
    }
  }

  async doStream(options: LanguageModelV2CallOptions) {
    const text = promptToText(options.prompt)
    const proc = Process.spawn(this.buildCmd(text), {
      stdin: this.useStdin() ? "pipe" : "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: CLI_ENV,
      abort: options.abortSignal,
    })

    if (this.useStdin()) {
      proc.stdin!.write(text)
      proc.stdin!.end()
    }

    const parser = this.config.parser
    const textId = "cli-0"

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start(controller) {
        const closed = () => controller.desiredSize === null

        const timer = setTimeout(() => {
          proc.kill("SIGTERM")
          if (closed()) return
          controller.enqueue({ type: "error", error: new Error(`CLI process timed out after ${CLI_TIMEOUT_MS / 1000}s`) })
          controller.close()
        }, CLI_TIMEOUT_MS)

        controller.enqueue({ type: "stream-start", warnings: [] })
        controller.enqueue({ type: "text-start", id: textId })

        let remainder = ""
        proc.stdout!.on("data", (chunk: Buffer) => {
          if (closed()) return
          const text = remainder + chunk.toString()
          const lines = text.split("\n")
          remainder = lines.pop() ?? ""
          for (const line of lines) {
            if (!line.trim()) continue
            const delta = parser.parseStreamLine(line)
            if (delta) controller.enqueue({ type: "text-delta", id: textId, delta })
          }
        })

        proc.stdout!.on("end", () => {
          clearTimeout(timer)
          if (closed()) return
          if (remainder.trim()) {
            const delta = parser.parseStreamLine(remainder)
            if (delta) controller.enqueue({ type: "text-delta", id: textId, delta })
          }
          controller.enqueue({ type: "text-end", id: textId })
          controller.enqueue({
            type: "finish",
            usage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
            finishReason: "stop",
          })
          controller.close()
        })

        proc.stdout!.on("error", (err: Error) => {
          clearTimeout(timer)
          proc.kill("SIGTERM")
          if (closed()) return
          controller.enqueue({ type: "error", error: err })
          controller.close()
        })

        proc.exited.then((code) => {
          clearTimeout(timer)
          if (closed()) return
          if (code !== 0) {
            controller.enqueue({ type: "error", error: new Error(`CLI exited with code ${code}`) })
            controller.close()
          }
        }).catch((err) => {
          clearTimeout(timer)
          if (closed()) return
          controller.enqueue({ type: "error", error: err ?? new Error("CLI process killed by signal") })
          controller.close()
        })
      },
      cancel() {
        proc.kill("SIGTERM")
      },
    })

    return { stream }
  }
}
