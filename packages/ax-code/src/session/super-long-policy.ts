import { isQwen37MaxModel } from "@/provider/qwen37-readiness"
import { Env } from "@/util/env"

export namespace SuperLongPolicy {
  const MAX_DURATION_MS = 72 * 60 * 60 * 1000
  const SESSION_OVERRIDE_ENV = "AX_CODE_SUPER_LONG_SESSION_OVERRIDE"
  const BASE_ENV = "AX_CODE_SUPER_LONG"

  export type RuntimeConfig = {
    enabled?: boolean
    requestedDurationMs?: number
  }

  export type ConfigValue = boolean | { enabled?: boolean; duration_hours?: number } | undefined

  /**
   * Normalize the `super_long` config value (legacy boolean or object form)
   * into the runtime config shape. duration_hours is converted to ms here;
   * the 72h hard ceiling is still enforced by `duration()`.
   */
  export function fromConfig(value: ConfigValue): RuntimeConfig {
    if (value === undefined) return {}
    if (typeof value === "boolean") return { enabled: value }
    return {
      enabled: value.enabled,
      requestedDurationMs: value.duration_hours === undefined ? undefined : value.duration_hours * 60 * 60 * 1000,
    }
  }

  export type StateDecision = {
    enabled: boolean
    source: "session-override" | "env" | "config" | "model-default"
  }

  export type DurationDecision =
    | { ok: true; durationMs: number }
    | { ok: false; reason: "invalid_duration"; requestedDurationMs: number }
    | { ok: false; reason: "duration_exceeds_ceiling"; maxDurationMs: number; requestedDurationMs: number }

  export type DeadlineDecision =
    | { ok: true; expired: boolean; elapsedMs: number; durationMs: number }
    | { ok: false; reason: "invalid_duration"; requestedDurationMs: number }
    | { ok: false; reason: "duration_exceeds_ceiling"; maxDurationMs: number; requestedDurationMs: number }

  export type DeadlineStopDecision =
    | { action: "continue" }
    | {
        action: "stop"
        reason: "step_limit"
        message: string
        logMessage: string
        status: "error" | "stopped"
        errorCode: "SUPER_LONG_DURATION_EXCEEDS_CEILING" | "SUPER_LONG_DEADLINE_REACHED"
        details:
          | { requestedDurationMs: number; maxDurationMs: number }
          | { elapsedMs: number; durationMs: number; source: StateDecision["source"] }
      }

  export type PacingPolicy = {
    windowMs: number
    maxRequests: number
    minDelayMs: number
  }

  export type PacingState = {
    timestamps: number[]
  }

  export type PacingDecision = {
    waitMs: number
    reason: "allowed" | "min-delay" | "rolling-window"
    timestamps: number[]
  }

  const DEFAULT_PACING: PacingPolicy = {
    windowMs: 60_000,
    maxRequests: 6,
    minDelayMs: 5_000,
  }

  const ALIBABA_PACING: PacingPolicy = {
    windowMs: 60_000,
    maxRequests: 4,
    minDelayMs: 10_000,
  }

  export function providerPacing(providerID: string): PacingPolicy {
    const policy = providerID.startsWith("alibaba-") ? ALIBABA_PACING : DEFAULT_PACING
    return { ...policy }
  }

  export function state(input: { modelID: string; config?: RuntimeConfig; sessionOverride?: boolean }): StateDecision {
    if (input.sessionOverride !== undefined) {
      return { enabled: input.sessionOverride, source: "session-override" }
    }
    if (input.config?.enabled !== undefined) {
      return { enabled: input.config.enabled, source: "config" }
    }
    return { enabled: isQwen37MaxModel(input.modelID), source: "model-default" }
  }

  export function runtimeState(input: {
    modelID: string
    config?: RuntimeConfig
    env?: Record<string, string | undefined>
  }): StateDecision {
    const env = input.env ?? process.env
    const sessionOverride = Env.parseBoolean(env[SESSION_OVERRIDE_ENV])
    if (sessionOverride !== undefined) {
      return { enabled: sessionOverride, source: "session-override" }
    }
    const base = Env.parseBoolean(env[BASE_ENV])
    if (base !== undefined) {
      return { enabled: base, source: "env" }
    }
    return state({
      modelID: input.modelID,
      config: input.config,
    })
  }

  export function duration(requestedDurationMs: number | undefined, fallbackMs = MAX_DURATION_MS): DurationDecision {
    const fallbackDurationMs = normalizeDurationFallback(fallbackMs)
    const durationMs = requestedDurationMs ?? fallbackDurationMs
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return {
        ok: false,
        reason: "invalid_duration",
        requestedDurationMs: durationMs,
      }
    }
    if (durationMs > MAX_DURATION_MS) {
      return {
        ok: false,
        reason: "duration_exceeds_ceiling",
        maxDurationMs: MAX_DURATION_MS,
        requestedDurationMs: durationMs,
      }
    }
    return { ok: true, durationMs }
  }

  function normalizeDurationFallback(fallbackMs: number) {
    if (!positiveFinite(fallbackMs)) return MAX_DURATION_MS
    return Math.min(fallbackMs, MAX_DURATION_MS)
  }

  export function deadline(input: {
    enabled: boolean
    startedAt: number
    now: number
    requestedDurationMs?: number
  }): DeadlineDecision {
    const durationDecision = duration(input.requestedDurationMs)
    if (!durationDecision.ok) return durationDecision
    const elapsedMs = elapsedSince(input.startedAt, input.now)
    return {
      ok: true,
      expired: input.enabled && elapsedMs >= durationDecision.durationMs,
      elapsedMs,
      durationMs: durationDecision.durationMs,
    }
  }

  function elapsedSince(startedAt: number, now: number) {
    const elapsedMs = now - startedAt
    return nonNegativeFinite(elapsedMs) ? elapsedMs : 0
  }

  export function deadlineStopDecision(input: {
    deadline: DeadlineDecision
    source: StateDecision["source"]
  }): DeadlineStopDecision {
    if (!input.deadline.ok) {
      return {
        action: "stop",
        reason: "step_limit",
        message:
          input.deadline.reason === "invalid_duration"
            ? `Super-Long mode stopped because the requested runtime duration is invalid. ` +
              `Use a positive finite duration and resume the session.`
            : `Super-Long mode stopped because the requested runtime ceiling exceeds the hard 72 hour limit. ` +
              `Reduce the requested duration and resume the session.`,
        logMessage: "super-long deadline rejected",
        status: "error",
        errorCode: "SUPER_LONG_DURATION_EXCEEDS_CEILING",
        details:
          input.deadline.reason === "invalid_duration"
            ? {
                requestedDurationMs: input.deadline.requestedDurationMs,
                maxDurationMs: MAX_DURATION_MS,
              }
            : {
                requestedDurationMs: input.deadline.requestedDurationMs,
                maxDurationMs: input.deadline.maxDurationMs,
              },
      }
    }

    if (input.deadline.expired) {
      const hours = Math.round((input.deadline.durationMs / (60 * 60 * 1000)) * 10) / 10
      return {
        action: "stop",
        reason: "step_limit",
        message:
          `Super-Long mode stopped after reaching the configured ${hours} hour runtime ceiling. ` +
          `Review the current state, then resume with a new supervised run if more work is required.`,
        logMessage: "super-long deadline reached",
        status: "stopped",
        errorCode: "SUPER_LONG_DEADLINE_REACHED",
        details: {
          elapsedMs: input.deadline.elapsedMs,
          durationMs: input.deadline.durationMs,
          source: input.source,
        },
      }
    }

    return { action: "continue" }
  }

  export function evaluatePacing(input: { now: number; state: PacingState; policy: PacingPolicy }): PacingDecision {
    const policy = normalizePacingPolicy(input.policy)
    const now = normalizeTimestamp(input.now)
    const timestamps = activePacingTimestamps({ ...input, now, policy })
    const last = timestamps.at(-1)
    if (last !== undefined) {
      const minDelayWait = last + policy.minDelayMs - now
      if (minDelayWait > 0) {
        return { waitMs: minDelayWait, reason: "min-delay", timestamps }
      }
    }
    if (timestamps.length >= policy.maxRequests) {
      const oldest = timestamps[0]!
      return { waitMs: Math.max(0, oldest + policy.windowMs - now), reason: "rolling-window", timestamps }
    }
    return { waitMs: 0, reason: "allowed", timestamps }
  }

  export function recordRequest(input: { now: number; state: PacingState; policy: PacingPolicy }): PacingState {
    const policy = normalizePacingPolicy(input.policy)
    const now = normalizeTimestamp(input.now)
    return {
      timestamps: [...activePacingTimestamps({ ...input, now, policy }), now],
    }
  }

  function activePacingTimestamps(input: { now: number; state: PacingState; policy: PacingPolicy }) {
    const cutoff = input.now - input.policy.windowMs
    return input.state.timestamps.filter((ts) => ts > cutoff && ts <= input.now).sort((a, b) => a - b)
  }

  function normalizePacingPolicy(policy: PacingPolicy): PacingPolicy {
    return {
      windowMs: positiveFinite(policy.windowMs) ? policy.windowMs : DEFAULT_PACING.windowMs,
      maxRequests: positiveFinite(policy.maxRequests)
        ? Math.max(1, Math.floor(policy.maxRequests))
        : DEFAULT_PACING.maxRequests,
      minDelayMs: nonNegativeFinite(policy.minDelayMs) ? policy.minDelayMs : DEFAULT_PACING.minDelayMs,
    }
  }

  function positiveFinite(value: number) {
    return Number.isFinite(value) && value > 0
  }

  function nonNegativeFinite(value: number) {
    return Number.isFinite(value) && value >= 0
  }

  function normalizeTimestamp(value: number) {
    return nonNegativeFinite(value) ? value : 0
  }
}
