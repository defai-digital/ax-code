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
// Mirrors the gate footerProgressBar() already uses, so the chip and
// the existing progress bar appear and disappear together.
export type AutonomousActive = {
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
