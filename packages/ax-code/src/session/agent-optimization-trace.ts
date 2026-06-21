// AgentOptimizationTrace — minimal event shape for long-agent session telemetry.
//
// Purpose: capture route class, model, context-pack summary, tool counts,
// verification outcomes, patch results, failure signals, and token usage for
// each agent session. Local-only; no external telemetry export in this module.
//
// Redaction: all string fields are safe to write to disk (no secrets, no raw
// user content). Callers must not pass raw prompt text or tool outputs here.

import z from "zod"
import { parseJsonPayload } from "@/util/json-value"

export namespace AgentOptimizationTrace {
  export type RouteClass = "cheap" | "premium" | "premiumCrossCheck" | "unknown"

  export type VerificationStatus = "pass" | "fail" | "skip" | "partial"

  export type PatchOutcome = "accepted" | "rejected" | "partial" | "not-attempted"

  export type ToolObservation = {
    tool: string
    input?: unknown
    status: "completed" | "error"
  }

  export type TraceEvent = {
    // Correlation
    sessionID: string
    eventID: string
    timestamp: string // ISO 8601

    // Route + model
    routeClass: RouteClass
    providerID: string
    modelID: string

    // Context pack summary (never raw content)
    contextPackSummary: ContextPackSummary

    // Tool loop
    toolCallCount: number
    repeatedFailureCount: number
    repeatedFailureSignal: boolean

    // Verification
    verificationCommand?: string
    verificationStatus: VerificationStatus

    // Patch
    patchOutcome: PatchOutcome

    // Token usage
    cacheReadTokens: number
    cacheWriteTokens: number
    inputTokens: number
    outputTokens: number
  }

  export type ContextPackSummary = {
    totalTokens: number
    tierCounts: [number, number, number, number] // t0, t1, t2, t3
    droppedTiers: number[]
  }

  const ContextPackSummarySchema = z.object({
    totalTokens: z.number(),
    tierCounts: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    droppedTiers: z.array(z.number()),
  })

  const TraceEventSchema = z.object({
    sessionID: z.string(),
    eventID: z.string(),
    timestamp: z.string(),
    routeClass: z.enum(["cheap", "premium", "premiumCrossCheck", "unknown"]),
    providerID: z.string(),
    modelID: z.string(),
    contextPackSummary: ContextPackSummarySchema,
    toolCallCount: z.number(),
    repeatedFailureCount: z.number(),
    repeatedFailureSignal: z.boolean(),
    verificationCommand: z.string().optional(),
    verificationStatus: z.enum(["pass", "fail", "skip", "partial"]),
    patchOutcome: z.enum(["accepted", "rejected", "partial", "not-attempted"]),
    cacheReadTokens: z.number(),
    cacheWriteTokens: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
  })

  // Repeated-failure detector: returns true when the same failure surface has
  // been seen >= threshold times. Callers should surface a recovery hint.
  export function detectRepeatedFailure(
    failureSurfaces: string[],
    threshold = 3,
  ): { detected: boolean; surface?: string; count?: number } {
    const counts = new Map<string, number>()
    for (const s of failureSurfaces) {
      counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    for (const [surface, count] of counts) {
      if (count >= threshold) return { detected: true, surface, count }
    }
    return { detected: false }
  }

  // Build a minimal context-pack summary safe for inclusion in a trace event.
  export function contextPackSummary(
    totalTokens: number,
    tierCounts: [number, number, number, number],
    droppedTiers: number[],
  ): ContextPackSummary {
    return { totalTokens, tierCounts, droppedTiers }
  }

  export function verificationCommand(input: unknown): string | undefined {
    if (!input || typeof input !== "object") return undefined
    const command = (input as { command?: unknown }).command
    return typeof command === "string" ? command : undefined
  }

  export function isVerificationObservation(observation: Pick<ToolObservation, "tool" | "input">): boolean {
    if (observation.tool === "verify_project") return true
    if (observation.tool !== "bash") return false
    const command = verificationCommand(observation.input)
    if (!command) return false
    return /\b(test|typecheck|tsc|lint|build|check|pytest|cargo\s+test|go\s+test|bun\s+test|pnpm\s+test|npm\s+test)\b/i.test(
      command,
    )
  }

  export function verificationStatusFromObservations(input: {
    observations: readonly ToolObservation[]
    repeatedFailureDetected: boolean
  }): { status: VerificationStatus; command?: string } {
    const verifier = input.observations.findLast(isVerificationObservation)
    if (input.repeatedFailureDetected) {
      return {
        status: "fail",
        command: verifier ? (verificationCommand(verifier.input) ?? verifier.tool) : undefined,
      }
    }
    if (!verifier) return { status: "skip" }
    return {
      status: verifier.status === "completed" ? "pass" : "fail",
      command: verificationCommand(verifier.input) ?? verifier.tool,
    }
  }

  // Serialize a trace event to a JSON string. Redaction: caller must not pass
  // raw content in any field — only summaries and counts.
  export function serialize(event: TraceEvent): string {
    return JSON.stringify(event, null, 2)
  }

  export function decodeTraceEvent(value: unknown): TraceEvent | null {
    const decoded = TraceEventSchema.safeParse(value)
    return decoded.success ? decoded.data : null
  }

  // Parse a previously serialized trace event. Returns null on invalid JSON.
  export function deserialize(json: string): TraceEvent | null {
    const parsed = parseJsonPayload(json)
    if (parsed === undefined) return null
    return decodeTraceEvent(parsed)
  }
}
