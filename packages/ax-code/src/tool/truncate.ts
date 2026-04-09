import { NodePath } from "@effect/platform-node"
import { Cause, Duration, Effect, Layer, Schedule, ServiceMap } from "effect"
import path from "path"
import type { Agent } from "../agent/agent"
import { makeRunPromise } from "@/effect/run-service"
import { AppFileSystem } from "@/filesystem"
import { evaluate } from "@/permission/evaluate"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import { ToolID } from "./schema"
import { TRUNCATION_DIR } from "./truncation-dir"
import { MAX_LINES as _MAX_LINES, MAX_BYTES as _MAX_BYTES } from "@/constants/tool"

export namespace Truncate {
  const log = Log.create({ service: "truncation" })
  const RETENTION = Duration.days(7)
  const MAX_DIR_BYTES = 200 * 1024 * 1024 // 200 MB disk cap

  export const MAX_LINES = _MAX_LINES
  export const MAX_BYTES = _MAX_BYTES
  export const DIR = TRUNCATION_DIR
  export const GLOB = path.join(TRUNCATION_DIR, "*")

  export type Result = { content: string; truncated: false } | { content: string; truncated: true; outputPath: string }

  export interface Options {
    maxLines?: number
    maxBytes?: number
    direction?: "head" | "tail"
  }

  function hasTaskTool(agent?: Agent.Info) {
    if (!agent?.permission) return false
    return evaluate("task", "*", agent.permission).action !== "deny"
  }

  export interface Interface {
    readonly cleanup: () => Effect.Effect<void>
    /**
     * Returns output unchanged when it fits within the limits, otherwise writes the full text
     * to the truncation directory and returns a preview plus a hint to inspect the saved file.
     */
    readonly output: (text: string, options?: Options, agent?: Agent.Info) => Effect.Effect<Result>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@ax-code/Truncate") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service

      const cleanup = Effect.fn("Truncate.cleanup")(function* () {
        const cutoff = Identifier.timestamp(Identifier.create("tool", false, Date.now() - Duration.toMillis(RETENTION)))
        const entries = yield* fs.readDirectory(TRUNCATION_DIR).pipe(
          Effect.map((all) => all.filter((name) => name.startsWith("tool_")).sort()),
          Effect.catch(() => Effect.succeed([])),
        )
        // Time-based cleanup
        for (const entry of entries) {
          if (Identifier.timestamp(entry) >= cutoff) continue
          yield* fs.remove(path.join(TRUNCATION_DIR, entry)).pipe(Effect.catch(() => Effect.void))
        }
        // Size-based cleanup — remove oldest files until under disk cap
        const remaining = yield* fs.readDirectory(TRUNCATION_DIR).pipe(
          Effect.map((all) => all.filter((name) => name.startsWith("tool_")).sort()),
          Effect.catch(() => Effect.succeed([])),
        )
        let totalSize = 0
        const sizes: { name: string; size: number }[] = []
        for (const entry of remaining) {
          const stat = yield* fs.stat(path.join(TRUNCATION_DIR, entry)).pipe(Effect.catch(() => Effect.succeed({ size: 0 as number })))
          const size = Number(stat.size)
          sizes.push({ name: entry, size })
          totalSize += size
        }
        if (totalSize > MAX_DIR_BYTES) {
          for (const item of sizes) {
            if (totalSize <= MAX_DIR_BYTES) break
            yield* fs.remove(path.join(TRUNCATION_DIR, item.name)).pipe(Effect.catch(() => Effect.void))
            totalSize -= item.size
          }
        }
      })

      const output = Effect.fn("Truncate.output")(function* (text: string, options: Options = {}, agent?: Agent.Info) {
        const maxLines = options.maxLines ?? MAX_LINES
        const maxBytes = options.maxBytes ?? MAX_BYTES
        const direction = options.direction ?? "head"
        const lines = text.split("\n")
        const totalBytes = Buffer.byteLength(text, "utf-8")

        if (lines.length <= maxLines && totalBytes <= maxBytes) {
          return { content: text, truncated: false } as const
        }

        const out: string[] = []
        let i = 0
        let bytes = 0
        let hitBytes = false

        if (direction === "head") {
          for (i = 0; i < lines.length && i < maxLines; i++) {
            const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
            if (bytes + size > maxBytes) {
              hitBytes = true
              break
            }
            out.push(lines[i])
            bytes += size
          }
        } else {
          for (i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
            const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
            if (bytes + size > maxBytes) {
              hitBytes = true
              break
            }
            out.unshift(lines[i])
            bytes += size
          }
        }

        const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
        const unit = hitBytes ? "bytes" : "lines"
        const preview = out.join("\n")
        const file = path.join(TRUNCATION_DIR, ToolID.ascending())

        yield* fs.ensureDir(TRUNCATION_DIR).pipe(Effect.orDie)
        yield* fs.writeFileString(file, text).pipe(Effect.orDie)

        const hint = hasTaskTool(agent)
          ? `The tool call succeeded but the output was truncated. Full output saved to: ${file}\nUse the Task tool to have explore agent process this file with Grep and Read (with offset/limit). Do NOT read the full file yourself - delegate to save context.`
          : `The tool call succeeded but the output was truncated. Full output saved to: ${file}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`

        return {
          content:
            direction === "head"
              ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
              : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`,
          truncated: true,
          outputPath: file,
        } as const
      })

      yield* cleanup().pipe(
        Effect.catchCause((cause) => {
          log.error("truncation cleanup failed", { cause: Cause.pretty(cause) })
          return Effect.void
        }),
        Effect.repeat(Schedule.spaced(Duration.hours(1))),
        Effect.delay(Duration.minutes(1)),
        Effect.forkScoped,
      )

      return Service.of({ cleanup, output })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer), Layer.provide(NodePath.layer))

  const runPromise = makeRunPromise(Service, defaultLayer)

  export async function output(text: string, options: Options = {}, agent?: Agent.Info): Promise<Result> {
    return runPromise((s) => s.output(text, options, agent))
  }
}
