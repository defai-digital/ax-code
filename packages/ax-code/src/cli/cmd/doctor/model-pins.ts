import { configuredPins, pinWarnings, type PinConfig, type ProviderLookup } from "../debug/routing"
import type { DoctorCheck } from "./health"
import { toErrorMessage } from "../../../util/error-message"

/** Pins that degrade to the session model instead of failing the dispatch. */
const AUXILIARY_PINS = new Set(["small_model", "agent.title.model", "agent.recap.model", "agent.compaction.model"])

const AUXILIARY_CONSEQUENCE = "fall back to the session model"
const OTHER_CONSEQUENCE = "fail when selected; update or remove them"

/** Doctor details stay on one line; the untruncated list is `ax-code debug routing`. */
const MAX_LISTED_PINS = 8

function consequence(pin: string): string {
  return AUXILIARY_PINS.has(pin) ? AUXILIARY_CONSEQUENCE : OTHER_CONSEQUENCE
}

function formatWarning(warning: { pin: string; target: string; reason: string }): string {
  return `${warning.pin} → ${warning.target} (${warning.reason}) — ${consequence(warning.pin)}`
}

/**
 * Report configured model pins (model, small_model, wiki.model, planner,
 * agent pins, llm_routing fallbacks) that do not resolve against the loaded
 * provider registry. The lookup only reads local provider state; no model
 * requests are sent. An unloadable registry is a warning, not a crash.
 */
export async function getDoctorModelPinsCheck(config: PinConfig, lookup: ProviderLookup): Promise<DoctorCheck> {
  const pins = configuredPins(config)
  try {
    const warnings = await pinWarnings(pins, lookup)
    if (warnings.length === 0) {
      return {
        name: "Model pins",
        status: "ok",
        detail: pins.length === 0 ? "No model pins configured" : `All ${pins.length} configured model pins resolve`,
      }
    }
    const listed = warnings.slice(0, MAX_LISTED_PINS).map(formatWarning)
    const hidden = warnings.length - listed.length
    if (hidden > 0) listed.push(`+${hidden} more`)
    return { name: "Model pins", status: "warn", detail: listed.join(" | ") }
  } catch (error) {
    return {
      name: "Model pins",
      status: "warn",
      detail: `unable to inspect model pins: ${toErrorMessage(error)}`,
    }
  }
}
