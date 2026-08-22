import type { McpClient } from "./mcp/stdio-client"

/**
 * Protocol contract for the app-scoped OCU tool dialect: the exact tool
 * inventory OcuProtocolProvider depends on. Checked against a backend's
 * tools/list response so upstream drift (renamed or removed tools) fails at
 * preflight/test time instead of surfacing as a mid-task refusal.
 *
 * Keep in sync with the callTool sites in providers/ocu-protocol.ts.
 */
export const OCU_DIALECT_REQUIRED_TOOLS = [
  "list_apps",
  "get_app_state",
  "click",
  "type_text",
  "press_key",
  "scroll",
  "drag",
  "set_value",
] as const

export interface DialectContractReport {
  ok: boolean
  /** required tools the backend does not advertise */
  missing: string[]
  /** tools the backend advertises beyond the required set (informational) */
  extra: string[]
}

/** Pure check of a tools/list inventory against the required set. */
export function checkDialectContract(advertised: readonly string[]): DialectContractReport {
  const advertisedSet = new Set(advertised)
  const required = new Set<string>(OCU_DIALECT_REQUIRED_TOOLS)
  const missing = OCU_DIALECT_REQUIRED_TOOLS.filter((tool) => !advertisedSet.has(tool))
  const extra = advertised.filter((tool) => !required.has(tool))
  return { ok: missing.length === 0, missing, extra }
}

/**
 * Query a backend's tools/list and check it against the OCU dialect contract.
 * Works with any connected McpClient (stdio or SDK adapter).
 */
export async function probeDialectContract(client: McpClient): Promise<DialectContractReport> {
  const tools = await client.listTools()
  return checkDialectContract(tools.map((tool) => tool.name))
}
