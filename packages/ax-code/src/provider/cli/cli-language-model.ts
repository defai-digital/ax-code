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
}

const CLI_ENV = { TERM: "dumb", NO_COLOR: "1", CI: "true" }

export class CliLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v2" as const
  readonly provider: string
  readonly modelId: string
  readonly supportedUrls: Record<string, RegExp[]> = {}

  constructor(private config: CliLanguageModelConfig) {
    this.provider = config.providerID
    this.modelId = config.modelID
  }

  private buildCmd() {
    return [this.config.binary, ...this.config.args, "--model", this.config.modelID]
  }

  async doGenerate(options: LanguageModelV2CallOptions) {
    const text = promptToText(options.prompt)
    const proc = Process.spawn(this.buildCmd(), {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: CLI_ENV,
      abort: options.abortSignal,
    })

    proc.stdin!.write(text)
    proc.stdin!.end()

    const [code, stdout, stderr] = await Promise.all([proc.exited, buffer(proc.stdout!), buffer(proc.stderr!)])
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
    const proc = Process.spawn(this.buildCmd(), {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: CLI_ENV,
      abort: options.abortSignal,
    })

    proc.stdin!.write(text)
    proc.stdin!.end()

    const parser = this.config.parser
    const textId = "cli-0"

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start(controller) {
        const closed = () => controller.desiredSize === null

        controller.enqueue({ type: "stream-start", warnings: [] })
        controller.enqueue({ type: "text-start", id: textId })

        let buf = ""
        proc.stdout!.on("data", (chunk: Buffer) => {
          if (closed()) return
          buf += chunk.toString()
          const lines = buf.split("\n")
          buf = lines.pop() ?? ""
          for (const line of lines) {
            if (!line.trim()) continue
            const delta = parser.parseStreamLine(line)
            if (delta) controller.enqueue({ type: "text-delta", id: textId, delta })
          }
        })

        proc.stdout!.on("end", () => {
          if (closed()) return
          if (buf.trim()) {
            const delta = parser.parseStreamLine(buf)
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
          proc.kill("SIGTERM")
          if (closed()) return
          controller.enqueue({ type: "error", error: err })
          controller.close()
        })

        proc.exited.then((code) => {
          if (closed()) return
          if (code !== 0) {
            controller.enqueue({ type: "error", error: new Error(`CLI exited with code ${code}`) })
            controller.close()
          }
        }).catch(() => {})
      },
      cancel() {
        proc.kill("SIGTERM")
      },
    })

    return { stream }
  }
}
