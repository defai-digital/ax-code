import { isRecord } from "@/util/record"

export type WebMcpChipStatus = { status?: unknown; error?: unknown } | undefined

export type WebMcpChipModel = {
  servers: string[]
  connected: string[]
  blocked: { name: string; error?: string }[]
  attentions: { name: string; error?: string }[]
  /**
   * toggle: something is live, or something can be connected. warning: a
   * failure needs recovery and nothing is live. lock: every server is
   * policy-denied and nothing is live. The lock is the only non-interactive
   * view, and it renders only when no sibling can act.
   */
  view: "lock" | "warning" | "toggle"
  /** Toggle label, with a marker per sibling state that needs surfacing. */
  label: string
  lockText: string
  warningText: string
}

function normalizeErrorText(rawError: unknown): string | undefined {
  let text: string | undefined
  if (typeof rawError === "string") text = rawError
  else if (rawError instanceof Error) text = rawError.message
  else if (isRecord(rawError) && typeof rawError.message === "string") text = rawError.message
  if (text === undefined) return undefined
  text = text.replace(/\s+/g, " ").trim()
  if (text === "") return undefined
  return text.length > 80 ? `${text.slice(0, 79)}…` : text
}

function attentionError(rawError: unknown, status: unknown): string | undefined {
  let text = normalizeErrorText(rawError)
  if (text === undefined) {
    if (status === "needs_trust") text = "server is not trusted"
    else if (status === "needs_auth") text = "needs authentication"
    else if (status === "needs_client_registration") text = "needs client registration"
  }
  return text
}

/**
 * Pure derivation of the experimental WebMCP bridge footer chip. Mixed states
 * never hide a denial or a failure behind a healthy-looking toggle: the
 * active toggle carries one marker per sibling state, the warning names the
 * first failing bridge (with a count when several fail) and keeps the lock
 * marker when a sibling is denied, and the lock lists the denied servers.
 */
export function webMcpChipModel(
  configMcp: unknown,
  statuses: Record<string, WebMcpChipStatus> | undefined,
): WebMcpChipModel {
  const servers: string[] = []
  if (isRecord(configMcp)) {
    for (const [name, entry] of Object.entries(configMcp)) {
      if (isRecord(entry) && isRecord((entry as { webmcp?: unknown }).webmcp)) servers.push(name)
    }
  }
  const connected = servers.filter((name) => statuses?.[name]?.status === "connected")
  const blocked: WebMcpChipModel["blocked"] = []
  const attentions: WebMcpChipModel["attentions"] = []
  for (const name of servers) {
    const entry = statuses?.[name]
    const status = entry?.status
    if (status === "blocked") {
      blocked.push({ name, error: normalizeErrorText(entry?.error) })
      continue
    }
    if (
      status === "failed" ||
      status === "needs_trust" ||
      status === "needs_auth" ||
      status === "needs_client_registration"
    ) {
      attentions.push({ name, error: attentionError(entry?.error, status) })
    }
  }
  const actionable = servers.some((name) => statuses?.[name]?.status !== "blocked")
  const view: WebMcpChipModel["view"] =
    connected.length > 0 ? "toggle" : attentions.length > 0 ? "warning" : actionable ? "toggle" : "lock"
  const markers = `${blocked.length > 0 ? " 🔒" : ""}${attentions.length > 0 ? " ⚠" : ""}`
  const base = servers.length > 1 ? `WebMCP (${connected.length}/${servers.length})` : "WebMCP"
  const label = view === "toggle" ? `${base}${markers}` : base
  // The lock is the only dead-end view, so it always names the denied
  // servers and the first policy reason instead of a bare padlock.
  const lockReason = blocked.find((entry) => entry.error)?.error
  const lockText =
    `🔒 WebMCP (${blocked.map((entry) => entry.name).join(", ")})` + (lockReason ? `: ${lockReason}` : "")
  const first = attentions[0]
  const warningCore =
    attentions.length > 1 && first
      ? `⚠ WebMCP: ${first.name}: ${first.error ?? "needs attention"} (+${attentions.length - 1} more)`
      : `⚠ WebMCP: ${first?.error ?? first?.name ?? "(unknown)"}`
  const warningText = `${warningCore}${blocked.length > 0 ? " 🔒" : ""}`
  return { servers, connected, blocked, attentions, view, label, lockText, warningText }
}
