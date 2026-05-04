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
