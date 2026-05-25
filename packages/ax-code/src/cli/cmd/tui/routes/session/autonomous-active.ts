import type { AssistantMessage, Part } from "@ax-code/sdk/v2"
import type { FooterSessionStatus } from "./footer-view-model"

// Pure rule for "is this session currently mid-autonomous-turn?".
//
// The TUI does not carry a per-session autonomous flag. The server only
// emits step/maxSteps on the SessionStatus busy event when the loop is
// actually running multi-step (see src/session/prompt.ts) — single-turn
// chat busy events leave both undefined. That presence is the
// pragmatic, no-new-event signal we use to decide whether to surface
// the autonomous chip and tint the transcript border.
//
// Multi-step status means an autonomous loop is currently active.
type AutonomousActive = {
  active: boolean
  step?: number
  maxSteps?: number
}

export function autonomousActiveView(status?: FooterSessionStatus): AutonomousActive {
  if (!status || status.type !== "busy") return { active: false }
  if (status.step === undefined || status.maxSteps === undefined) return { active: false }
  if (status.maxSteps <= 0) return { active: false }
  return { active: true, step: status.step, maxSteps: status.maxSteps }
}

// "Is this assistant text part the one currently streaming inside an
// active autonomous turn?" — used to apply the live deep-green background
// only to the in-flight message. Everything else (older messages in this
// session, non-autonomous turns, completed turns) is excluded.
//
// `last` is the same boolean the TextPart renderer already receives from
// AssistantMessage's <For>; it's true when this is the final part of the
// final message in the transcript. We additionally require the message's
// finish field to be unset or a continuation marker — once the turn
// settles to "stop", the background drops away even if `last` is true.
export function isLiveAutonomousText(input: {
  last: boolean
  message: Pick<AssistantMessage, "finish">
  autonomousActive: boolean
}): boolean {
  if (!input.last) return false
  if (!input.autonomousActive) return false
  const finish = input.message.finish
  if (finish && finish !== "tool-calls" && finish !== "unknown") return false
  return true
}

// "Was this assistant message produced by an autonomous multi-step turn?"
// — used to keep a subtle green left-border on the message even after the
// turn completes, so scroll-back history makes it obvious which answers
// were autonomous-driven vs. single-turn chat.
//
// Signal: count of step-finish parts. A normal single-turn message has
// at most one; an autonomous turn produces one per LLM call inside the
// loop. Two or more is the threshold. We deliberately ignore tool-part
// count — a single-turn chat that calls one tool to look something up
// shouldn't be marked autonomous.
export function isAutonomousProducedMessage(parts: Pick<Part, "type">[]): boolean {
  let count = 0
  for (const part of parts) {
    if (part.type === "step-finish") {
      count++
      if (count >= 2) return true
    }
  }
  return false
}
