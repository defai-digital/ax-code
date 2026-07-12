/**
 * Mode resolution policy (ADR-049 D1/D2). Pure — no IO.
 */

import { Hybrid } from "./hybrid"

export namespace ModePolicy {
  export type ModeId = "local" | "cloud" | "hybrid" | "arena" | "council"

  export type Placement = Hybrid.Placement

  export type ModesConfig = {
    default?: ModeId
    hybrid?: {
      preferLocalWhenAvailable?: boolean
      escalateOnHighComplexity?: boolean
      localProviderID?: string
    }
    council?: {
      enabled?: boolean
      maxMembers?: number
      timeoutMs?: number
      debateRounds?: number
    }
    arena?: {
      enabled?: boolean
      maxContestants?: number
      strategy?: "verify_first" | "diversity" | "hybrid_score"
    }
    budget?: {
      maxEstimatedUsd?: number
    }
  }

  export type ModeSignals = {
    localAvailable: boolean
    connectedProviderIDs: readonly string[]
    complexity?: "low" | "medium" | "high" | null
    privacyRequired?: boolean
    requestedMode?: ModeId | null
    /** When true, cloud fan-out is blocked unless requestedMode explicitly overrides with awareness. */
    blockCloudEnsemble?: boolean
  }

  export type ModeDecision = {
    mode: ModeId
    placement: Placement
    reasons: string[]
    ensemble: boolean
    /** False when requested ensemble mode cannot run (not enough providers / disabled). */
    allowed: boolean
  }

  const ENSEMBLE_MODES = new Set<ModeId>(["arena", "council"])

  export function isEnsembleMode(mode: ModeId): boolean {
    return ENSEMBLE_MODES.has(mode)
  }

  function uniqueProviders(ids: readonly string[]): string[] {
    return [...new Set(ids.filter((id) => id.trim().length > 0))]
  }

  function hybridPlacement(config: ModesConfig, signals: ModeSignals): Hybrid.RecommendResult {
    return Hybrid.recommendPlacement({
      localAvailable: signals.localAvailable,
      complexity: signals.complexity,
      privacyRequired: signals.privacyRequired,
      preferLocalWhenAvailable: config.hybrid?.preferLocalWhenAvailable,
      escalateOnHighComplexity: config.hybrid?.escalateOnHighComplexity,
    })
  }

  function ensembleAllowed(
    mode: ModeId,
    config: ModesConfig,
    signals: ModeSignals,
  ): { ok: boolean; reasons: string[] } {
    const reasons: string[] = []
    if (mode === "council" && config.council?.enabled === false) {
      return { ok: false, reasons: ["council_disabled"] }
    }
    if (mode === "arena" && config.arena?.enabled !== true) {
      // Arena defaults off until Phase 2 productization
      return { ok: false, reasons: ["arena_disabled"] }
    }
    if (signals.privacyRequired || signals.blockCloudEnsemble) {
      reasons.push("privacy_blocks_cloud_ensemble")
      return { ok: false, reasons }
    }
    const providers = uniqueProviders(signals.connectedProviderIDs)
    if (providers.length < 2) {
      return { ok: false, reasons: ["insufficient_providers", `connected=${providers.length}`] }
    }
    return { ok: true, reasons: [`providers=${providers.length}`] }
  }

  /**
   * Resolve the effective execution mode and placement.
   * Default product posture: hybrid when local is available, else cloud.
   */
  export function resolveMode(config: ModesConfig, signals: ModeSignals): ModeDecision {
    const reasons: string[] = []
    const requested = signals.requestedMode ?? null
    const configuredDefault: ModeId =
      config.default ?? (signals.localAvailable ? "hybrid" : "cloud")

    let mode: ModeId = requested ?? configuredDefault
    if (requested) reasons.push(`requested:${requested}`)
    else reasons.push(`default:${configuredDefault}`)

    // Ensemble modes need enablement + provider count
    if (isEnsembleMode(mode)) {
      const check = ensembleAllowed(mode, config, signals)
      reasons.push(...check.reasons)
      if (!check.ok) {
        // Fall back to hybrid/cloud single path
        const fallback: ModeId = signals.localAvailable ? "hybrid" : "cloud"
        reasons.push(`ensemble_fallback:${fallback}`)
        mode = fallback
        const place = hybridPlacement(config, signals)
        return {
          mode,
          placement: place.placement,
          reasons: [...reasons, ...place.reasons],
          ensemble: false,
          allowed: false,
        }
      }
      // Ensemble modes still pick a placement for any single-agent follow-up
      const place = hybridPlacement(config, signals)
      return {
        mode,
        placement: place.placement,
        reasons: [...reasons, ...place.reasons],
        ensemble: true,
        allowed: true,
      }
    }

    if (mode === "local") {
      if (!signals.localAvailable) {
        reasons.push("local_unavailable_fallback_cloud")
        return { mode: "cloud", placement: "cloud", reasons, ensemble: false, allowed: true }
      }
      if (signals.privacyRequired) reasons.push("privacy_required")
      return { mode: "local", placement: "local", reasons, ensemble: false, allowed: true }
    }

    if (mode === "cloud") {
      if (signals.privacyRequired && signals.localAvailable) {
        reasons.push("privacy_override_local")
        return { mode: "local", placement: "local", reasons, ensemble: false, allowed: true }
      }
      return { mode: "cloud", placement: "cloud", reasons, ensemble: false, allowed: true }
    }

    // hybrid (default path)
    const place = hybridPlacement(config, signals)
    reasons.push(...place.reasons)
    return {
      mode: "hybrid",
      placement: place.placement,
      reasons,
      ensemble: false,
      allowed: true,
    }
  }
}
