// Host port for @ax-code/ax-agent-runtime.
//
// The package is environment-agnostic: everything host-specific (clock,
// logging) is injected through this port. Phase 1 declares the port only;
// nothing on the hot path calls `configureAgentRuntimeHost()` yet.

export type AgentRuntimeLogLevel = "debug" | "info" | "warn" | "error"

export type AgentRuntimeHost = {
  /** Wall clock in milliseconds. */
  now: () => number
  /** Structured log sink. */
  log: (level: AgentRuntimeLogLevel, message: string, fields?: Record<string, unknown>) => void
}

let current: AgentRuntimeHost | undefined

export function configureAgentRuntimeHost(host: AgentRuntimeHost): void {
  current = host
}

export function getAgentRuntimeHost(): AgentRuntimeHost {
  if (!current) throw new Error("AgentRuntimeHost is not configured")
  return current
}
