import type { RuntimeMode } from "@/installation/runtime-mode"
import { shouldUseTuiAnimations } from "../spinner-profile"

export const FOOTER_LIVENESS_FRAMES = ["[|]", "[/]", "[-]", "[\\]"] as const

export type FooterLivenessIndicator =
  | {
      type: "native-spinner"
    }
  | {
      type: "text"
      frame: string
    }

export function footerLivenessIndicator(input: {
  tick: number
  userEnabled?: boolean
  runtime?: RuntimeMode
}): FooterLivenessIndicator {
  if (shouldUseTuiAnimations({ userEnabled: input.userEnabled, runtime: input.runtime })) {
    return { type: "native-spinner" }
  }

  if (input.userEnabled === false) return { type: "text", frame: "[...]" }

  const tick = Number.isFinite(input.tick) ? input.tick : 0
  const index = Math.abs(Math.trunc(tick)) % FOOTER_LIVENESS_FRAMES.length
  return { type: "text", frame: FOOTER_LIVENESS_FRAMES[index] ?? FOOTER_LIVENESS_FRAMES[0] }
}

export function footerLivenessTextFrame(indicator: FooterLivenessIndicator): string {
  return indicator.type === "text" ? indicator.frame : "[...]"
}

export type StreamConnectionPhase = "connecting" | "connected" | "reconnecting" | "stopped" | string
export type ProjectedStreamHealth = "fixture" | "connecting" | "connected" | "unavailable" | "error"

// Footer connection chip: undefined while the event stream is healthy, a
// short label while connecting/reconnecting, after a terminal stop, or when
// the backend reports itself unavailable/error through control events — so a
// dead backend behind a healthy socket no longer looks like "the model is
// thinking" (the SSE socket can stay green while the server is gone).
export function connectionChipText(input: {
  phase?: StreamConnectionPhase
  connected?: boolean
  streamHealth?: ProjectedStreamHealth
}): string | undefined {
  if (input.streamHealth === "unavailable") return "Backend unavailable"
  if (input.streamHealth === "error") return "Backend error"
  if (!input.phase || input.connected) return undefined
  if (input.phase === "reconnecting") return "Reconnecting…"
  if (input.phase === "connecting") return "Connecting…"
  if (input.phase === "stopped") return "Disconnected"
  return undefined
}
