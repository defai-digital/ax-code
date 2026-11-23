import { configuredPins, pinWarnings, type PinConfig, type PinWarning, type ProviderLookup } from "../debug/routing"
import type { DoctorCheck } from "./health"
import { toErrorMessage } from "../../../util/error-message"

/** Doctor details stay on one line; the untruncated list is `ax-code debug routing`. */
const MAX_LISTED_PINS = 8

function consequence(warning: PinWarning): string {
  // The runtime throws while parsing an invalid-format pin (never reaches the
  // fallback chain), so every pin key shares the same consequence — except
  // the planner architect pin, whose parse error the planner ignores
  // (configuredArchitectModel falls back to the default model).
  if (warning.code === "invalid_format") {
    if (warning.pin === "experimental.planner_architect_model") return "ignored; the planner uses the default model"
    return "fails when used; fix the provider/model format"
  }
  switch (warning.pin) {
    case "small_model":
      return "falls back to the session model; complexity routing skipped"
    case "agent.title.model":
    case "agent.recap.model":
      return "tries small_model, then the session model"
    case "agent.compaction.model":
      return "uses the session model"
    default:
      return "fails when selected"
  }
}

function formatWarning(warning: PinWarning): string {
  return `${warning.pin} → ${warning.target} (${warning.reason}) — ${consequence(warning)}`
}

/** Advice sentences, appended once each in a stable order, keyed by warning code. */
function advice(warnings: PinWarning[]): string[] {
  const codes = new Set(warnings.map((warning) => warning.code))
  const result: string[] = []
  if (codes.has("invalid_format") || codes.has("provider_not_configured") || codes.has("model_not_found")) {
    result.push("Use exact IDs from ax-code models or remove stale pins.")
  }
  const excluded = new Set(
    warnings.flatMap((warning) =>
      warning.code === "excluded" && warning.excludeReason ? [warning.excludeReason] : [],
    ),
  )
  if (excluded.has("configured-blacklist") || excluded.has("outside-configured-whitelist")) {
    result.push("Edit the provider blacklist/whitelist or change the pin.")
  }
  if (excluded.has("experimental-model-disabled")) {
    result.push("Set AX_CODE_ENABLE_EXPERIMENTAL_MODELS=1 to allow experimental models, or change the pin.")
  }
  if (
    [...excluded].some(
      (reason) =>
        reason !== "configured-blacklist" &&
        reason !== "outside-configured-whitelist" &&
        reason !== "experimental-model-disabled",
    )
  ) {
    result.push("Pin a supported model instead.")
  }
  if (codes.has("catalog_unavailable")) {
    result.push("Some provider catalogs could not be loaded; rerun when those providers are reachable.")
  }
  return result
}

/**
 * Report configured model pins (model, small_model, wiki.model, planner,
 * agent pins, llm_routing fallbacks) that do not resolve against the loaded
 * provider registry. The lookup waits for provider catalog discovery, which
 * may contact providers but never runs inference. An unloadable registry is
 * a warning, not a crash.
 */
export async function getDoctorModelPinsCheck(
  config: PinConfig,
  lookup: ProviderLookup,
  parse?: (target: string) => { providerID: string; modelID: string },
): Promise<DoctorCheck> {
  const pins = configuredPins(config)
  try {
    const warnings = await pinWarnings(pins, lookup, parse)
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
    return {
      name: "Model pins",
      status: "warn",
      detail: `${listed.join(" | ")}. ${advice(warnings).join(" ")}`,
    }
  } catch (error) {
    return {
      name: "Model pins",
      status: "warn",
      detail: `unable to inspect model pins: ${toErrorMessage(error)}`,
    }
  }
}
