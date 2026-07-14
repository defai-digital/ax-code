import { AX_ENGINE_ERROR } from "./constants"
import type { AxEngineStatus } from "./status"

/**
 * Shared Local Engine lifecycle phases (ax-engine docs/LOCAL-ENGINE-CLIENTS.md).
 * Keep string literals identical across AX Code / AX Studio / ax-engine docs.
 */
export type LocalEnginePhase =
  | "unavailable"
  | "missing_dependency"
  | "missing_model"
  | "starting"
  | "ready"
  | "degraded"
  | "error"

export type LocalEngineBackendKind = "in_process" | "sidecar_http"

/** AX Code's normative default — managed `ax-engine serve` over HTTP `/v1`. */
export const AX_CODE_LOCAL_ENGINE_BACKEND: LocalEngineBackendKind = "sidecar_http"

export const LOCAL_ENGINE_PHASE_RANK: Record<LocalEnginePhase, number> = {
  error: 60,
  unavailable: 50,
  missing_dependency: 40,
  missing_model: 30,
  starting: 20,
  degraded: 10,
  ready: 0,
}

export type LocalEngineLifecycle = {
  phase: LocalEnginePhase
  backend: LocalEngineBackendKind
  blockers: string[]
}

function mostSevere(phases: LocalEnginePhase[]): LocalEnginePhase {
  return phases.reduce((best, next) =>
    LOCAL_ENGINE_PHASE_RANK[next] > LOCAL_ENGINE_PHASE_RANK[best] ? next : best,
  )
}

/**
 * Map AX Code's rich AxEngineStatus into the shared cross-product phase set.
 */
export function mapAxEngineStatusToLifecycle(status: AxEngineStatus): LocalEngineLifecycle {
  const blockers: string[] = []
  const candidates: LocalEnginePhase[] = []

  if (!status.eligibility.supported) {
    candidates.push("unavailable")
    blockers.push(
      ...(status.eligibility.blockers.length
        ? status.eligibility.blockers
        : [AX_ENGINE_ERROR.UnsupportedPlatform]),
    )
  }

  if (!status.dependency.available) {
    candidates.push("missing_dependency")
    blockers.push(
      ...(status.dependency.blockers.length ? status.dependency.blockers : [AX_ENGINE_ERROR.BinaryMissing]),
    )
  }

  const modelReady = status.model.present && status.model.complete
  if (!modelReady) {
    candidates.push("missing_model")
    blockers.push(
      ...(status.model.blockers.length ? status.model.blockers : [AX_ENGINE_ERROR.ModelNotPrepared]),
    )
  }

  if (status.server.running && !status.server.ready) {
    candidates.push("starting")
    blockers.push(
      ...(status.server.blockers.length
        ? status.server.blockers
        : [AX_ENGINE_ERROR.ServerHealthFailed]),
    )
  }

  if (!status.server.running && status.server.blockers.length > 0) {
    const hard = status.server.blockers.some(
      (b) =>
        b.includes(AX_ENGINE_ERROR.ServerStartFailed) ||
        b.includes(AX_ENGINE_ERROR.ServerHealthFailed) ||
        b.toLowerCase().includes("failed"),
    )
    if (hard) {
      candidates.push("error")
      blockers.push(...status.server.blockers)
    }
  }

  if (status.server.ready) {
    if (status.capability.toolcall === false) {
      candidates.push("degraded")
      if (status.capability.reason) blockers.push(status.capability.reason)
    } else {
      candidates.push("ready")
    }
  }

  if (candidates.length === 0) {
    candidates.push(status.dependency.available ? "missing_model" : "missing_dependency")
  }

  return {
    phase: mostSevere(candidates),
    backend: AX_CODE_LOCAL_ENGINE_BACKEND,
    blockers: [...new Set(blockers.filter(Boolean))],
  }
}
