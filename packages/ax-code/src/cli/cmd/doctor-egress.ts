import type { Isolation as IsolationConfig } from "@/config/schema"
import type { DoctorCheck } from "./doctor-health"

/**
 * Egress allowlist preflight (ADR-232). Reports how strongly
 * `isolation.network.allowed_domains` is enforced on this platform so a user
 * knows whether sandboxed bash is truly restricted or only proxy-advisory.
 */
export function getEgressCheck(
  input: {
    config?: IsolationConfig["network"]
    mode?: IsolationConfig["mode"]
    platform?: NodeJS.Platform
  } = {},
): DoctorCheck {
  const name = "Network egress"
  const platform = input.platform ?? process.platform
  const allowed = input.config && typeof input.config === "object" ? (input.config.allowed_domains ?? []) : []
  if (allowed.length === 0) {
    return {
      name,
      status: "ok",
      detail: "not configured (set isolation.network.allowed_domains to restrict sandboxed bash egress)",
    }
  }
  const count = allowed.length
  if (input.mode === "full-access") {
    return {
      name,
      status: "warn",
      detail: `${count} allowed domains configured but not enforced: isolation.mode is full-access (sandbox off)`,
    }
  }
  if (platform === "darwin") {
    return { name, status: "ok", detail: `enforced via Seatbelt egress proxy (${count} allowed domains)` }
  }
  if (platform === "linux") {
    return {
      name,
      status: "warn",
      detail: `advisory on bubblewrap (${count} allowed domains): the network namespace is shared, so the proxy can be bypassed`,
    }
  }
  return {
    name,
    status: "warn",
    detail: `unsupported on ${platform} (${count} allowed domains configured): no OS sandbox, the setting is ignored`,
  }
}
