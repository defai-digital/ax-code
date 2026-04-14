import { Log } from "@/util/log"
import { EventQuery } from "./query"
import type { ReplayEvent } from "./event"
import type { SessionID } from "@/session/schema"

const log = Log.create({ service: "replay" })

export namespace Replay {
  export type Mode = "verify" | "check" | "summary"

  export interface DivergenceInfo {
    sequence: number
    expected: ReplayEvent
    actual: ReplayEvent | undefined
    reason: string
  }

  export interface Result {
    sessionID: string
    totalEvents: number
    steps: number
    toolCalls: number
    divergences: DivergenceInfo[]
  }

  export interface Options {
    sessionID: SessionID
    mode: Mode
    onEvent?: (event: ReplayEvent, index: number) => void
    onDivergence?: (info: DivergenceInfo) => void
  }

  export function run(options: Options): Result {
    const events = EventQuery.bySession(options.sessionID)
    if (events.length === 0) {
      log.warn("no events found for session", { sessionID: options.sessionID })
      return {
        sessionID: options.sessionID,
        totalEvents: 0,
        steps: 0,
        toolCalls: 0,
        divergences: [],
      }
    }

    const divergences: DivergenceInfo[] = []
    let steps = 0
    let toolCalls = 0

    for (let i = 0; i < events.length; i++) {
      const event = events[i]
      options.onEvent?.(event, i)

      if (event.type === "step.start") steps++
      if (event.type === "tool.call") toolCalls++

      if (options.mode === "verify" || options.mode === "check") {
        // R8: Skip non-deterministic events in comparison
        if (event.deterministic === false) continue

        // In verify mode, check event sequence consistency
        // A step.finish should follow step.start
        // A tool.result should follow tool.call with same callID
        if (event.type === "tool.result") {
          const preceding = events.slice(0, i).reverse().find((e) => e.type === "tool.call")
          if (preceding && preceding.type === "tool.call" && preceding.callID !== event.callID) {
            const div: DivergenceInfo = {
              sequence: i,
              expected: preceding,
              actual: event,
              reason: `tool.result callID "${event.callID}" does not match preceding tool.call "${preceding.callID}"`,
            }
            divergences.push(div)
            options.onDivergence?.(div)
          }
        }

        if (event.type === "step.finish") {
          const precedingStart = events.slice(0, i).reverse().find((e) => e.type === "step.start")
          if (precedingStart && precedingStart.type === "step.start" && precedingStart.stepIndex !== event.stepIndex) {
            const div: DivergenceInfo = {
              sequence: i,
              expected: precedingStart,
              actual: event,
              reason: `step.finish stepIndex ${event.stepIndex} does not match step.start stepIndex ${precedingStart.stepIndex}`,
            }
            divergences.push(div)
            options.onDivergence?.(div)
          }
        }
      }
    }

    return {
      sessionID: options.sessionID,
      totalEvents: events.length,
      steps,
      toolCalls,
      divergences,
    }
  }

  /**
   * Reconstruct a processor-compatible stream from recorded events.
   * This is the foundation for R3 (session replay without calling the LLM).
   * The returned async iterable yields events matching the Vercel AI SDK fullStream format.
   */
  /**
   * @param fromStep — Start reconstruction from this step index (R7: partial replay).
   *                    Steps before this index are skipped.
   */
  export function reconstructStream(sessionID: SessionID, options?: { fromStep?: number }): { steps: ReconstructedStep[] } {
    const events = EventQuery.bySession(sessionID)
    const steps: ReconstructedStep[] = []
    let current: ReconstructedStep | undefined
    const fromStep = options?.fromStep ?? 0

    for (const event of events) {
      if (event.type === "step.start") {
        if (event.stepIndex < fromStep) continue
        current = { stepIndex: event.stepIndex, parts: [], toolResults: [], finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } }
        steps.push(current)
      }
      if (!current) continue

      if (event.type === "llm.output") {
        for (const part of event.parts) {
          current.parts.push(part)
        }
      }
      if (event.type === "tool.result") {
        current.toolResults.push({
          callID: event.callID,
          tool: event.tool,
          status: event.status,
          output: event.output,
          error: event.error,
          metadata: event.metadata,
        })
      }
      if (event.type === "step.finish") {
        current.finishReason = event.finishReason
        current.usage = { inputTokens: event.tokens.input, outputTokens: event.tokens.output }
        current = undefined
      }
    }

    return { steps }
  }

  export interface ReconstructedStep {
    stepIndex: number
    parts: Array<
      | { type: "text", text: string }
      | { type: "reasoning", text: string }
      | { type: "tool_call", callID: string, tool: string, input: Record<string, unknown> }
    >
    toolResults: Array<{
      callID: string
      tool: string
      status: "completed" | "error"
      output?: string
      error?: string
      metadata?: Record<string, unknown>
    }>
    finishReason: string
    usage: { inputTokens: number, outputTokens: number }
  }

  /**
   * Generate a Vercel AI SDK-compatible fullStream async iterable from reconstructed steps.
   * Use with: `spyOn(LLM, "stream").mockResolvedValue({ fullStream: toFullStream(steps) })`
   */
  export async function* toFullStream(steps: ReconstructedStep[]) {
    yield { type: "start" }
    for (const step of steps) {
      yield { type: "start-step" }

      for (const part of step.parts) {
        if (part.type === "reasoning") {
          const id = `replay-reasoning-${step.stepIndex}`
          yield { type: "reasoning-start", id }
          yield { type: "reasoning-delta", id, text: part.text }
          yield { type: "reasoning-end", id }
        }
        if (part.type === "text") {
          const id = `replay-text-${step.stepIndex}`
          yield { type: "text-start", id }
          yield { type: "text-delta", id, text: part.text }
          yield { type: "text-end", id }
        }
        if (part.type === "tool_call") {
          yield { type: "tool-input-start", id: part.callID, toolName: part.tool }
          yield { type: "tool-call", toolCallId: part.callID, toolName: part.tool, input: part.input }

          const result = step.toolResults.find((r) => r.callID === part.callID)
          if (result) {
            if (result.status === "completed") {
              yield {
                type: "tool-result",
                toolCallId: part.callID,
                input: part.input,
                output: { output: result.output ?? "", title: part.tool, metadata: result.metadata ?? {}, attachments: [] },
              }
            } else {
              yield {
                type: "tool-error",
                toolCallId: part.callID,
                input: part.input,
                error: new Error(result.error ?? "Replayed error"),
              }
            }
          } else {
            yield {
              type: "tool-error",
              toolCallId: part.callID,
              input: part.input,
              error: new Error("Tool result not found — session may have crashed during execution"),
            }
          }
        }
      }

      yield {
        type: "finish-step",
        finishReason: step.finishReason,
        usage: step.usage,
      }
    }
    yield { type: "finish" }
  }

  /**
   * R3: Execute a replay by feeding reconstructed stream through the processor.
   * Returns the result without calling the real LLM.
   *
   * Usage:
   *   const { stream, steps } = Replay.prepareExecution(sessionID)
   *   // Mock LLM.stream to return { fullStream: stream }
   *   // Run processor.process() with the mock
   *   // Compare processor.message against original
   *
   * This function provides the mock stream; the caller wires it into the processor.
   * See test/replay/reconstruct.test.ts for the pattern.
   */
  export function prepareExecution(sessionID: SessionID, options?: { fromStep?: number }): {
    steps: ReconstructedStep[]
    stream: AsyncIterable<unknown>
  } {
    const { steps } = reconstructStream(sessionID, options)
    return { steps, stream: toFullStream(steps) }
  }

  /**
   * R4: Compare reconstructed steps against original event log.
   * Returns divergences where the replay would differ from the original.
   */
  export function compare(sessionID: SessionID): { divergences: DivergenceInfo[], stepsCompared: number } {
    const original = EventQuery.bySession(sessionID)
    const { steps } = reconstructStream(sessionID)
    const divergences: DivergenceInfo[] = []

    // Extract original steps from events for comparison
    const originalSteps: { stepIndex: number, toolCalls: string[], finishReason: string, textParts: number }[] = []
    let current: (typeof originalSteps)[number] | undefined
    for (const event of original) {
      if (event.type === "step.start") {
        current = { stepIndex: event.stepIndex, toolCalls: [], finishReason: "stop", textParts: 0 }
        originalSteps.push(current)
      }
      if (!current) continue
      if (event.type === "tool.call") current.toolCalls.push(event.callID)
      if (event.type === "step.finish") {
        current.finishReason = event.finishReason
        current = undefined
      }
    }

    // Compare step counts
    if (steps.length !== originalSteps.length) {
      divergences.push({
        sequence: 0,
        expected: { type: "session.end", sessionID, reason: "completed", totalSteps: originalSteps.length } as ReplayEvent,
        actual: { type: "session.end", sessionID, reason: "completed", totalSteps: steps.length } as ReplayEvent,
        reason: `Step count mismatch: original ${originalSteps.length} vs reconstructed ${steps.length}`,
      })
    }

    // Compare each step
    const count = Math.min(steps.length, originalSteps.length)
    for (let i = 0; i < count; i++) {
      const orig = originalSteps[i]
      const recon = steps[i]

      if (orig.finishReason !== recon.finishReason) {
        divergences.push({
          sequence: i,
          expected: { type: "step.finish", sessionID, stepIndex: orig.stepIndex, finishReason: orig.finishReason, tokens: { input: 0, output: 0 } } as ReplayEvent,
          actual: { type: "step.finish", sessionID, stepIndex: recon.stepIndex, finishReason: recon.finishReason, tokens: { input: 0, output: 0 } } as ReplayEvent,
          reason: `Step ${i} finish reason: original "${orig.finishReason}" vs reconstructed "${recon.finishReason}"`,
        })
      }

      const reconToolCalls = recon.parts.filter((p) => p.type === "tool_call").map((p) => (p as { callID: string }).callID)
      if (orig.toolCalls.length !== reconToolCalls.length) {
        divergences.push({
          sequence: i,
          expected: { type: "step.start", sessionID, stepIndex: orig.stepIndex } as ReplayEvent,
          actual: { type: "step.start", sessionID, stepIndex: recon.stepIndex } as ReplayEvent,
          reason: `Step ${i} tool call count: original ${orig.toolCalls.length} vs reconstructed ${reconToolCalls.length}`,
        })
      }
    }

    return { divergences, stepsCompared: count }
  }

  export function summary(sessionID: SessionID): string[] {
    const events = EventQuery.bySession(sessionID)
    const lines: string[] = []

    for (const event of events) {
      switch (event.type) {
        case "session.start":
          lines.push(`[session] start agent=${event.agent} model=${event.model}`)
          break
        case "session.end":
          lines.push(`[session] end reason=${event.reason} steps=${event.totalSteps}`)
          break
        case "agent.route":
          lines.push(
            `[route]   ${event.fromAgent} -> ${event.toAgent} (${event.confidence.toFixed(2)}, ${event.routeMode ?? "switch"})`,
          )
          break
        case "llm.request":
          lines.push(`[llm]     request model=${event.model} messages=${event.messageCount}`)
          break
        case "llm.response":
          lines.push(`[llm]     response finish=${event.finishReason} tokens=${event.tokens.input}/${event.tokens.output} ${event.latencyMs}ms`)
          break
        case "step.start":
          lines.push(`[step]    #${event.stepIndex} start`)
          break
        case "step.finish":
          lines.push(`[step]    #${event.stepIndex} finish reason=${event.finishReason}`)
          break
        case "tool.call":
          lines.push(`[tool]    call ${event.tool} id=${event.callID}`)
          break
        case "tool.result":
          lines.push(`[tool]    ${event.status} ${event.tool} ${event.durationMs}ms`)
          break
        case "permission.ask":
          lines.push(`[perm]    ask ${event.permission} patterns=${event.patterns.join(",")}`)
          break
        case "permission.reply":
          lines.push(`[perm]    reply ${event.reply}`)
          break
        case "llm.output":
          lines.push(`[llm]     output ${event.parts.length} parts`)
          break
        case "error":
          lines.push(`[error]   ${event.errorType}: ${event.message}`)
          break
        case "code.graph.snapshot":
          lines.push(`[graph]   snapshot project=${event.projectID} nodes=${event.nodeCount} edges=${event.edgeCount}${event.commitSha ? ` sha=${event.commitSha}` : ""}`)
          break
      }
    }

    return lines
  }
}
