// Shared step-window parsing for token rate/usage readouts (sidebar local
// inference rates, prompt footer token chip). Message-level token counts
// ACCUMULATE across every step of an assistant turn (the processor adds each
// step's usage onto the running totals), so any consumer that wants a
// per-request rate or the current context size must work from the per-step
// data in the message's parts instead of the message totals.
//
// Parts arrive over the wire as untyped JSON, so parsing is defensive.
//
// Window semantics per finished step:
//   decode window = step's first output token through its last output token,
//                   or through the start of its first tool execution when the
//                   answer was a tool call (tool-call tokens are decode too)
export type StepTokenWindow = {
  /** Earliest text/reasoning part start in the step (first output token). */
  firstOut?: number
  /** Latest text/reasoning part end in the step (`now` while streaming). */
  streamEnd?: number
  /** Earliest tool execution start in the step. */
  toolStart?: number
  /** Latest tool execution end in the step (`now` while a tool runs). */
  toolEnd?: number
  /** Tokens reported by the step's step-finish part. */
  input: number
  output: number
  /** Whether the step's step-finish part (and thus its usage) has landed. */
  finished: boolean
}

export function parseStepTokenWindows(
  parts: readonly unknown[],
  now: number,
): { steps: StepTokenWindow[]; sawStepPart: boolean } {
  const steps: StepTokenWindow[] = []
  let sawStepPart = false
  for (const value of parts) {
    if (!value || typeof value !== "object") continue
    const part = value as { type?: unknown; time?: unknown; state?: unknown; tokens?: unknown }

    if (part.type === "step-start") {
      sawStepPart = true
      steps.push({ input: 0, output: 0, finished: false })
      continue
    }
    if (steps.length === 0) steps.push({ input: 0, output: 0, finished: false })
    const step = steps[steps.length - 1]

    if (part.type === "text" || part.type === "reasoning") {
      const time =
        part.time && typeof part.time === "object" ? (part.time as { start?: unknown; end?: unknown }) : undefined
      const start = typeof time?.start === "number" && Number.isFinite(time.start) ? time.start : undefined
      if (start === undefined) continue
      if (step.firstOut === undefined || start < step.firstOut) step.firstOut = start
      const end = typeof time?.end === "number" && Number.isFinite(time.end) ? time.end : now
      if (step.streamEnd === undefined || end > step.streamEnd) step.streamEnd = end
      continue
    }

    if (part.type === "tool") {
      const state = part.state && typeof part.state === "object" ? (part.state as { time?: unknown }) : undefined
      const time =
        state?.time && typeof state.time === "object"
          ? (state.time as { start?: unknown; end?: unknown })
          : undefined
      const start = typeof time?.start === "number" && Number.isFinite(time.start) ? time.start : undefined
      if (start === undefined) continue
      if (step.toolStart === undefined || start < step.toolStart) step.toolStart = start
      const end = typeof time?.end === "number" && Number.isFinite(time.end) ? time.end : now
      if (step.toolEnd === undefined || end > step.toolEnd) step.toolEnd = end
      continue
    }

    if (part.type === "step-finish") {
      sawStepPart = true
      const tokens =
        part.tokens && typeof part.tokens === "object"
          ? (part.tokens as { input?: unknown; output?: unknown })
          : undefined
      if (typeof tokens?.input === "number" && Number.isFinite(tokens.input)) step.input += tokens.input
      if (typeof tokens?.output === "number" && Number.isFinite(tokens.output)) step.output += tokens.output
      step.finished = true
    }
  }
  return { steps, sawStepPart }
}

// End of a step's decode window: the first tool execution start when the
// answer included tool calls (the tool call itself was decoded by then),
// otherwise the last streamed output token.
export function stepDecodeEnd(step: StepTokenWindow): number | undefined {
  return step.toolStart ?? step.streamEnd
}

// Aggregate output tokens and decode windows over finished steps. The
// in-flight step is excluded — its usage is unknown until step-finish, and
// pairing its window with earlier steps' tokens would drag the rate down
// while tools run.
export function stepDecodeTotals(steps: readonly StepTokenWindow[]): { tokens: number; ms: number } {
  let tokens = 0
  let ms = 0
  for (const step of steps) {
    if (!step.finished) continue
    const firstOut = step.firstOut
    const end = stepDecodeEnd(step)
    if (firstOut === undefined || end === undefined || end <= firstOut || step.output <= 0) continue
    tokens += step.output
    ms += end - firstOut
  }
  return { tokens, ms }
}
