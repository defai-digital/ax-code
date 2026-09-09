import z from "zod"
import { Tool } from "./tool"
import { CanonicalOutput } from "./canonical-output"
import { Session } from "@/session"
import { PartID } from "@/session/schema"
import { toErrorMessage } from "@/util/error-message"
import DESCRIPTION from "./read_recipe.txt"

const Path = z.array(z.union([z.string().max(100), z.number().int().min(0).max(1000)])).max(8)
const Reference = z.object({ $ref: z.object({ step: z.string(), path: Path }).strict() }).strict()
const Selection = z
  .object({
    step: z.string(),
    path: Path,
    contains: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict()
const Parameters = z
  .object({
    steps: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
            tool: z.enum(["read", "glob", "grep"]),
            parameters: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    select: z.array(Selection).min(1).max(8).optional(),
  })
  .strict()
const schemas = { read: CanonicalOutput.Read, glob: CanonicalOutput.Glob, grep: CanonicalOutput.Grep }
const forbidden = new Set(["__proto__", "prototype", "constructor"])

function at(value: unknown, path: z.infer<typeof Path>): unknown {
  for (const key of path) {
    if (forbidden.has(String(key)) || value === null || typeof value !== "object" || !Object.hasOwn(value, key)) {
      throw new Error("Recipe reference does not identify an own data property")
    }
    value = (value as Record<string | number, unknown>)[key]
  }
  return value
}

function transform(value: unknown, resolve: (ref: z.infer<typeof Reference>["$ref"]) => unknown, depth = 0): unknown {
  if (depth > 12) throw new Error("Recipe parameters exceed the nesting limit")
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((item) => transform(item, resolve, depth + 1))
  if (Object.hasOwn(value, "$ref")) return resolve(Reference.parse(value).$ref)
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (forbidden.has(key)) throw new Error("Prototype properties are not allowed in recipes")
      return [key, transform(item, resolve, depth + 1)]
    }),
  )
}

export const ReadRecipeTool = Tool.define("read_recipe", {
  description: DESCRIPTION,
  parameters: Parameters,
  async execute(params, ctx) {
    if (Buffer.byteLength(JSON.stringify(params)) > 32_000) throw new Error("Recipe exceeds the parameter budget")
    const dispatcher = ctx.extra?.toolDispatcher as Tool.Dispatcher | undefined
    if (!dispatcher || !ctx.callID) throw new Error("Recipe requires a scoped dispatcher and parent call identity")
    const declared = new Set<string>()
    for (const step of params.steps) {
      if (declared.has(step.id)) throw new Error("Recipe step IDs must be unique")
      if (!dispatcher.ids.includes(step.tool)) throw new Error(`Recipe tool '${step.tool}' is not enabled`)
      transform(step.parameters, (ref) => {
        if (!declared.has(ref.step) || ref.path.some((key) => forbidden.has(String(key))))
          throw new Error("Recipe references must identify a previous step and safe path")
        return null
      })
      declared.add(step.id)
    }
    for (const selection of params.select ?? []) {
      if (!declared.has(selection.step) || selection.path.some((key) => forbidden.has(String(key))))
        throw new Error("Invalid recipe selection")
    }
    ctx.abort.throwIfAborted()
    await ctx.ask({
      permission: "read_recipe",
      patterns: params.steps.map((step) => step.tool),
      always: ["*"],
      metadata: {},
    })
    const abort = AbortSignal.any([ctx.abort, AbortSignal.timeout(60_000)])
    const values = new Map<string, unknown>()
    const calls: { step: string; tool: string; partID: PartID; status: string; error?: string }[] = []
    let status = "completed"
    let bytes = 0
    let projection = true
    let sourceTruncated = false
    for (const step of params.steps) {
      abort.throwIfAborted()
      const parameters = transform(step.parameters, (ref) => at(values.get(ref.step), ref.path)) as Record<
        string,
        unknown
      >
      if (Buffer.byteLength(JSON.stringify(parameters)) > 32_000)
        throw new Error("Resolved recipe arguments exceed the parameter budget")
      if (dispatcher.concurrencySafe?.({ tool: step.tool, parameters }) !== true)
        throw new Error("Recipe tool did not admit a read-only call")
      const partID = PartID.ascending()
      const base = {
        id: partID,
        messageID: ctx.messageID,
        sessionID: ctx.sessionID,
        type: "tool" as const,
        tool: step.tool,
        callID: partID,
        parentCallID: ctx.callID,
      }
      const start = Date.now()
      await Session.updatePart({ ...base, state: { status: "running", input: parameters, time: { start } } })
      try {
        // Await owned work after cancellation; never leave a detached tool running.
        const result = await dispatcher.execute({ tool: step.tool, parameters, callID: partID, abort })
        const data = schemas[step.tool].parse(result.data)
        sourceTruncated ||= data.truncated
        await Session.updatePart({
          ...base,
          state: {
            status: "completed",
            input: parameters,
            title: result.title,
            output: result.output,
            metadata: result.metadata,
            attachments: result.attachments,
            time: { start, end: Date.now() },
          },
        })
        calls.push({ step: step.id, tool: step.tool, partID, status: "completed" })
        if (
          result.attachments?.length ||
          (Array.isArray(result.metadata.loaded) && result.metadata.loaded.length > 0)
        ) {
          // Newly loaded repository instructions and media must reach the model
          // before another step. Keep this child's normal provider projection.
          projection = false
          status = "paused_for_context"
          break
        }
        bytes += Buffer.byteLength(JSON.stringify(data))
        if (bytes > 192_000) {
          status = "output_budget"
          break
        }
        values.set(step.id, data) // @scan-suppress lifecycle_scan - At most eight entries and 192KB per invocation.
        abort.throwIfAborted()
      } catch (error) {
        await Session.updatePart({
          ...base,
          state: { status: "error", input: parameters, error: toErrorMessage(error), time: { start, end: Date.now() } },
        })
        if (abort.aborted) throw error
        calls.push({
          step: step.id,
          tool: step.tool,
          partID,
          status: "error",
          error: toErrorMessage(error).slice(0, 2000),
        })
        status = "error"
        break
      }
    }
    let truncated = sourceTruncated || status === "output_budget"
    const selected = (params.select ?? [{ step: calls.at(-1)!.step, path: [], limit: 20 }]).flatMap((selection) => {
      if (!values.has(selection.step)) return []
      let value = at(values.get(selection.step), selection.path)
      if (selection.contains !== undefined) {
        if (!Array.isArray(value)) throw new Error("Recipe contains filter requires an array")
        value = value.filter((item) => JSON.stringify(item).includes(selection.contains!))
      }
      if (Array.isArray(value)) {
        truncated ||= value.length > selection.limit
        value = value.slice(0, selection.limit)
      }
      const serialized = JSON.stringify(value)
      if (serialized.length > 8000) {
        truncated = true
        value = { preview: serialized.slice(0, 8000), truncated: true }
      }
      return [{ step: selection.step, path: selection.path, value }]
    })
    let output = JSON.stringify({ status, calls, selected, truncated })
    if (output.length > 16_000) {
      truncated = true
      output = JSON.stringify({ status, calls, preview: output.slice(0, 12_000), truncated })
    }
    return {
      title: `Read recipe: ${calls.length} calls`,
      output,
      metadata: { truncated, recipeProjection: projection, status, calls: calls.length },
    }
  },
})
