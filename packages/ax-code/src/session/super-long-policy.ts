import { isQwen37MaxModel } from "@/provider/qwen37-readiness"

export namespace SuperLongPolicy {
  export const MAX_DURATION_MS = 72 * 60 * 60 * 1000

  export type RuntimeConfig = {
    enabled?: boolean
    requestedDurationMs?: number
  }

  export type StateDecision = {
    enabled: boolean
    source: "session-override" | "config" | "model-default"
  }

  export type DurationDecision =
    | { ok: true; durationMs: number }
    | { ok: false; reason: "duration_exceeds_ceiling"; maxDurationMs: number; requestedDurationMs: number }

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

  export const DEFAULT_PACING: PacingPolicy = {
    windowMs: 60_000,
    maxRequests: 6,
    minDelayMs: 5_000,
  }

  export const ALIBABA_PACING: PacingPolicy = {
    windowMs: 60_000,
    maxRequests: 4,
    minDelayMs: 10_000,
  }

  export function providerPacing(providerID: string): PacingPolicy {
    return providerID.startsWith("alibaba-") ? ALIBABA_PACING : DEFAULT_PACING
  }

  export function state(input: {
    modelID: string
    config?: RuntimeConfig
    sessionOverride?: boolean
  }): StateDecision {
    if (input.sessionOverride !== undefined) {
      return { enabled: input.sessionOverride, source: "session-override" }
    }
    if (input.config?.enabled !== undefined) {
      return { enabled: input.config.enabled, source: "config" }
    }
    return { enabled: isQwen37MaxModel(input.modelID), source: "model-default" }
  }

  export function duration(requestedDurationMs: number | undefined, fallbackMs = MAX_DURATION_MS): DurationDecision {
    const durationMs = requestedDurationMs ?? fallbackMs
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return { ok: true, durationMs: fallbackMs }
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

  export function evaluatePacing(input: {
    now: number
    state: PacingState
    policy: PacingPolicy
  }): PacingDecision {
    const cutoff = input.now - input.policy.windowMs
    const timestamps = input.state.timestamps.filter((ts) => ts > cutoff).sort((a, b) => a - b)
    const last = timestamps.at(-1)
    if (last !== undefined) {
      const minDelayWait = last + input.policy.minDelayMs - input.now
      if (minDelayWait > 0) {
        return { waitMs: minDelayWait, reason: "min-delay", timestamps }
      }
    }
    if (timestamps.length >= input.policy.maxRequests) {
      const oldest = timestamps[0]!
      return { waitMs: Math.max(0, oldest + input.policy.windowMs - input.now), reason: "rolling-window", timestamps }
    }
    return { waitMs: 0, reason: "allowed", timestamps }
  }

  export function recordRequest(input: { now: number; state: PacingState; policy: PacingPolicy }): PacingState {
    const cutoff = input.now - input.policy.windowMs
    return {
      timestamps: [...input.state.timestamps.filter((ts) => ts > cutoff), input.now],
    }
  }
}
