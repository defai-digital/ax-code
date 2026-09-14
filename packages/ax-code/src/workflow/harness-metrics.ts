import { StringDecoder } from "node:string_decoder"
import z from "zod"
import { parseJsonResult } from "@/util/json-value"

const counter = z.number().int().nonnegative().safe()
const Part = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("step-finish"),
    id: z.string().min(1).max(300),
    tokens: z.object({
      input: counter,
      output: counter,
      reasoning: counter,
      cache: z.object({ read: counter }),
    }),
  }),
  z.object({
    type: z.literal("tool"),
    id: z.string().min(1).max(300),
    state: z.object({ status: z.enum(["completed", "error"]) }),
  }),
])

/** Bounded JSONL consumption. Retains counters and IDs, never prompt/tool bodies. */
export function harnessMetrics() {
  const decoder = new StringDecoder("utf8")
  let pending = ""
  let damaged = false
  let dropping = false
  let observed = false
  const seen = new Map<string, string>()
  const counts = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    toolCalls: 0,
    toolErrors: 0,
  }
  function line(text: string) {
    if (!text.trim()) return
    const parsed = parseJsonResult(text)
    if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
      damaged = true
      return
    }
    const event = parsed.value as Record<string, unknown>
    if (event.type !== "step_finish" && event.type !== "tool_use") return
    const result = Part.safeParse(event.part)
    if (!result.success || (event.type === "step_finish") !== (result.data.type === "step-finish")) {
      damaged = true
      return
    }
    const part = result.data
    const key = `${part.type}:${part.id}`
    const signature = JSON.stringify(part)
    if (seen.has(key)) {
      if (seen.get(key) !== signature) damaged = true
      return
    }
    if (seen.size >= 100_000) {
      damaged = true
      return
    }
    seen.set(key, signature)
    observed = true
    if (part.type === "tool") {
      counts.toolCalls++
      if (part.state.status === "error") counts.toolErrors++
    } else {
      counts.inputTokens += part.tokens.input
      counts.outputTokens += part.tokens.output
      counts.reasoningTokens += part.tokens.reasoning
      counts.cacheReadTokens += part.tokens.cache.read
    }
    if (Object.values(counts).some((value) => !Number.isSafeInteger(value))) damaged = true
  }
  function consume(text: string) {
    for (const fragment of text.split(/(?<=\n)/)) {
      if (!dropping) {
        if (pending.length + fragment.length > 1_000_000) {
          damaged = true
          dropping = true
          pending = ""
        } else pending += fragment
      }
      if (fragment.endsWith("\n")) {
        if (!dropping) line(pending)
        pending = ""
        dropping = false
      }
    }
  }
  return {
    write(chunk: Buffer) {
      consume(decoder.write(chunk))
    },
    finish(completed: boolean) {
      consume(decoder.end())
      if (pending) line(pending)
      // Withhold incomplete totals rather than treating missing usage as zero.
      if (!observed) return { metricsStatus: "unavailable" as const }
      if (damaged || dropping || !completed) return { metricsStatus: "partial" as const }
      const hasUsage = [...seen.keys()].some((key) => key.startsWith("step-finish:"))
      return {
        metricsStatus: "observed" as const,
        toolCalls: counts.toolCalls,
        toolErrors: counts.toolErrors,
        ...(hasUsage
          ? {
              inputTokens: counts.inputTokens,
              outputTokens: counts.outputTokens,
              reasoningTokens: counts.reasoningTokens,
              cacheReadTokens: counts.cacheReadTokens,
            }
          : {}),
      }
    },
  }
}
