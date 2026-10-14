import { Env } from "@/util/env"
import { isRecord } from "@/util/record"

/** Placeholder written in place of a value the audit trail may not persist. */
export const AUDIT_REDACTED = "[redacted]"

// Bounded so a pathological payload cannot make the audit write path walk an
// unbounded structure; anything deeper is replaced wholesale.
const MAX_DEPTH = 8

/**
 * A durable audit row is a trace, so a raw credential must never land in it,
 * while the payload's shape stays inspectable. Values under a
 * credential-shaped key are replaced, and every string goes through the same
 * shared redactors the event log and message parts already use
 * (`redactInlineEnvAssignments` covers `KEY=VALUE` inside a command string,
 * `redactForRecord` covers the header/private-key shapes).
 */
export function redactAuditPayload(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return Env.redactForRecord(Env.redactInlineEnvAssignments(value))
  if (depth >= MAX_DEPTH) return isRecord(value) || Array.isArray(value) ? AUDIT_REDACTED : value
  if (Array.isArray(value)) return value.map((item) => redactAuditPayload(item, depth + 1))
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    // `cookie` is not covered by the shared keyword detector; the MCP trust
    // fingerprint applies the same explicit exception.
    const sensitive = key.toLowerCase() === "cookie" || Env.isSensitiveName(key)
    result[key] =
      sensitive && entry !== undefined && entry !== null ? AUDIT_REDACTED : redactAuditPayload(entry, depth + 1)
  }
  return result
}
