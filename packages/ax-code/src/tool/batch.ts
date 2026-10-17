import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./batch.txt"
import { toError } from "@/util/error-message"
import { createToolBarrier, dispatchToolPart } from "./nested-dispatch"

const DISALLOWED = new Set(["batch", "task", "read_recipe", "execute"])
const FILTERED_FROM_SUGGESTIONS = new Set(["invalid", "patch", ...DISALLOWED])
const TOOL_TIMEOUT = 60_000

function asError(reason: unknown, fallback: string) {
  if (reason instanceof Error) return reason
  if (typeof reason === "string" && reason.length > 0) return new Error(reason)
  return new Error(fallback)
}

export function withToolTimeout<T>(input: {
  tool: string
  parent: AbortSignal
  timeoutMs: number
  run(signal: AbortSignal): Promise<T>
}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController()
    const timeoutError = new Error(`Tool '${input.tool}' timed out after ${input.timeoutMs}ms`)
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      controller.signal.removeEventListener("abort", onAbort)
      input.parent.removeEventListener("abort", onParentAbort)
      fn()
    }

    const onAbort = () => {
      finish(() => reject(asError(controller.signal.reason, `Tool '${input.tool}' was aborted`)))
    }

    const onParentAbort = () => {
      controller.abort(input.parent.reason)
    }

    controller.signal.addEventListener("abort", onAbort, { once: true })
    if (input.parent.aborted) {
      controller.abort(input.parent.reason)
    } else {
      input.parent.addEventListener("abort", onParentAbort, { once: true })
    }

    if (settled) return

    timer = setTimeout(() => {
      controller.abort(timeoutError)
    }, input.timeoutMs)
    if (typeof timer === "object" && "unref" in timer) timer.unref()

    if (controller.signal.aborted) {
      finish(() => reject(asError(controller.signal.reason, `Tool '${input.tool}' was aborted`)))
      return
    }

    let result: Promise<T>
    try {
      result = input.run(controller.signal)
    } catch (error) {
      finish(() => reject(asError(error, `Tool '${input.tool}' failed`)))
      return
    }

    result.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(asError(error, `Tool '${input.tool}' failed`))),
    )
  })
}

export const BatchTool = Tool.define("batch", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      tool_calls: z
        .array(
          z.object({
            tool: z.string().describe("The name of the tool to execute"),
            parameters: z.object({}).loose().describe("Parameters for the tool"),
          }),
        )
        .min(1, "Provide at least one tool call")
        .describe("Array of tool calls to execute in parallel"),
    }),
    formatValidationError(error) {
      const formattedErrors = error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "root"
          return `  - ${path}: ${issue.message}`
        })
        .join("\n")

      return `Invalid parameters for tool 'batch':\n${formattedErrors}\n\nExpected payload format:\n  [{"tool": "tool_name", "parameters": {...}}, {...}]`
    },
    async execute(params, ctx) {
      const { Session } = await import("../session")
      const { PartID } = await import("../session/schema")

      const toolCalls = params.tool_calls.slice(0, 25)
      const discardedCalls = params.tool_calls.slice(25)
      const dispatcher = ctx.extra?.toolDispatcher as Tool.Dispatcher | undefined
      if (!dispatcher) throw new Error("Batch tool dispatcher is unavailable for this execution context")
      const availableTools = new Set(dispatcher.ids)

      // Pre-generate all PartIDs in declaration order BEFORE the
      // parallel execution. Generating `PartID.ascending()` inside
      // the async `executeCall` body meant calls racing inside
      // `Promise.all` could receive IDs in a non-deterministic order,
      // so the UI displayed the tool parts shuffled. Pre-generating
      // pins the ordering to the input order.
      const partIDs = toolCalls.map(() => PartID.ascending())

      const schedule = createToolBarrier({
        concurrencySafe: (call) =>
          !DISALLOWED.has(call.tool) && availableTools.has(call.tool) && dispatcher.concurrencySafe?.(call) === true,
      })
      const results = await Promise.all(
        toolCalls.map((call, idx) =>
          schedule(call, async () => {
            try {
              const result = await dispatchToolPart({
                ctx,
                tool: call.tool,
                parameters: call.parameters,
                partID: partIDs[idx],
                async run(callID) {
                  if (DISALLOWED.has(call.tool)) throw new Error(`Tool '${call.tool}' is not allowed in batch`)
                  if (!availableTools.has(call.tool))
                    throw new Error(
                      `Tool '${call.tool}' not in registry. External tools (MCP, environment) cannot be batched - call them directly. Available tools: ${[...availableTools].filter((name) => !FILTERED_FROM_SUGGESTIONS.has(name)).join(", ")}`,
                    )
                  return withToolTimeout({
                    tool: call.tool,
                    parent: ctx.abort,
                    timeoutMs: TOOL_TIMEOUT,
                    run: (abort) => dispatcher.execute({ ...call, callID, abort }),
                  })
                },
              })
              return { success: true as const, tool: call.tool, result }
            } catch (error) {
              return { success: false as const, tool: call.tool, error: toError(error) }
            }
          }),
        ),
      )

      // Add discarded calls as errors
      const now = Date.now()
      for (const call of discardedCalls) {
        const partID = PartID.ascending()
        await Session.updatePart({
          id: partID,
          messageID: ctx.messageID,
          sessionID: ctx.sessionID,
          type: "tool",
          tool: call.tool,
          callID: partID,
          state: {
            status: "error",
            input: call.parameters,
            error: "Maximum of 25 tools allowed in batch",
            time: { start: now, end: now },
          },
        })
        results.push({
          success: false as const,
          tool: call.tool,
          error: new Error("Maximum of 25 tools allowed in batch"),
        })
      }

      const successfulCalls = results.filter((r) => r.success).length
      const failedCalls = results.length - successfulCalls

      const outputMessage =
        failedCalls > 0
          ? `Executed ${successfulCalls}/${results.length} tools successfully. ${failedCalls} failed.`
          : `All ${successfulCalls} tools executed successfully.\n\nKeep using the batch tool for optimal performance in your next response!`

      return {
        title: `Batch execution (${successfulCalls}/${results.length} successful)`,
        output: outputMessage,
        attachments: results.filter((result) => result.success).flatMap((r) => r.result.attachments ?? []),
        metadata: {
          totalCalls: results.length,
          successful: successfulCalls,
          failed: failedCalls,
          tools: params.tool_calls.map((c) => c.tool),
          details: results.map((r) => ({ tool: r.tool, success: r.success })),
        },
      }
    },
  }
})
