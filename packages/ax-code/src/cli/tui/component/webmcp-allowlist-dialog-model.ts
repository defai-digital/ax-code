import type { WebMcpApprovalRecord } from "@ax-code/sdk/v2"

export type WebMcpAllowlistScope = WebMcpApprovalRecord["scope"]
export type WebMcpAllowlistCapability = WebMcpAllowlistScope["capability"]

/** What selecting a row in the allowlist dialog does. */
export type WebMcpAllowlistAction =
  | { kind: "retry" }
  | { kind: "none" }
  | { kind: "revoke"; id: string }
  | { kind: "clear" }
  | { kind: "grant"; scope: WebMcpAllowlistScope }

export type WebMcpAllowlistOption = {
  title: string
  value: WebMcpAllowlistAction
  description?: string
  category?: string
  disabled?: boolean
}

export const WEBMCP_ALLOWLIST_SAVED = "Saved approvals"
export const WEBMCP_ALLOWLIST_ADD = "Add approval"
export const WEBMCP_ALLOWLIST_PLACEHOLDER = "Filter, or type an origin to add"
export const WEBMCP_ALLOWLIST_ORIGIN_HINT = "Type an https:// origin (or http://localhost) to add an approval"

const CAPABILITY_ORDER: WebMcpAllowlistCapability[] = ["list_pages", "navigate", "read", "close"]
const ORIGIN_CAPABILITIES = ["navigate", "read", "close"] as const
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])

/**
 * The exact origin a typed value would grant, mirroring the server-side
 * Scope rule (https, or http on loopback; no credentials; wildcards never
 * parse). The server validates again; this only decides whether an add row
 * is offered, so a stricter client never hides a server-accepted origin and
 * a looser one only earns a toast.
 */
export function webMcpAllowlistOrigin(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed === "" || trimmed.includes("*") || trimmed.length > 2048) return undefined
  try {
    const url = new URL(trimmed)
    if (url.username || url.password) return undefined
    if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) return undefined
    return url.origin
  } catch {
    return undefined
  }
}

export function webMcpAllowlistScopeTitle(scope: WebMcpAllowlistScope): string {
  if (scope.capability === "list_pages") return "List all browser pages"
  return `${scope.capability}: ${scope.origin}`
}

function grantTitle(scope: WebMcpAllowlistScope): string {
  if (scope.capability === "list_pages") return "Allow listing all browser pages"
  if (scope.capability === "navigate") return `Allow navigation to ${scope.origin}`
  if (scope.capability === "read") return `Allow reads on ${scope.origin}`
  return `Allow closing pages on ${scope.origin}`
}

function sameScope(a: WebMcpAllowlistScope, b: WebMcpAllowlistScope): boolean {
  if (a.capability !== b.capability) return false
  if (a.capability === "list_pages" || b.capability === "list_pages") return true
  return a.origin === b.origin
}

function matches(title: string, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return needle === "" || title.toLowerCase().includes(needle)
}

/** Saved records in a stable order: listing first, then by capability and origin. */
export function webMcpAllowlistRows(records: readonly WebMcpApprovalRecord[]): WebMcpApprovalRecord[] {
  return [...records].sort((a, b) => {
    const order = CAPABILITY_ORDER.indexOf(a.scope.capability) - CAPABILITY_ORDER.indexOf(b.scope.capability)
    if (order !== 0) return order
    const left = a.scope.capability === "list_pages" ? "" : a.scope.origin
    const right = b.scope.capability === "list_pages" ? "" : b.scope.origin
    return left.localeCompare(right)
  })
}

/**
 * Grant candidates for the typed query: page listing when it is not saved
 * yet, and one row per origin capability when the query is a grantable
 * origin that has no saved record for that capability. Rows that already
 * exist are never offered twice, so a saved scope cannot be re-minted from
 * the add list.
 */
export function webMcpAllowlistGrantOptions(
  records: readonly WebMcpApprovalRecord[],
  query: string,
): WebMcpAllowlistOption[] {
  const saved = records.map((record) => record.scope)
  const scopes: WebMcpAllowlistScope[] = []
  const listing: WebMcpAllowlistScope = { capability: "list_pages" }
  if (!saved.some((scope) => sameScope(scope, listing)) && matches(grantTitle(listing), query)) scopes.push(listing)
  const origin = webMcpAllowlistOrigin(query)
  if (origin) {
    for (const capability of ORIGIN_CAPABILITIES) {
      const scope: WebMcpAllowlistScope = { capability, origin }
      if (!saved.some((existing) => sameScope(existing, scope))) scopes.push(scope)
    }
  }
  return scopes.map((scope) => ({
    title: grantTitle(scope),
    value: { kind: "grant", scope },
    description: "This project • select to save",
    category: WEBMCP_ALLOWLIST_ADD,
  }))
}

/**
 * Pure option list for the allowlist dialog. The dialog runs with the
 * picker's own fuzzy filter off, so the query both narrows the saved rows
 * and feeds the add rows; a non-empty query that matches nothing and is not
 * an origin explains the accepted shape instead of showing an empty list.
 */
export function webMcpAllowlistDialogOptions(input: {
  records: readonly WebMcpApprovalRecord[] | undefined
  query: string
  loading: boolean
  failed: boolean
}): WebMcpAllowlistOption[] {
  if (input.failed) return [{ title: "Could not load approvals — select to retry", value: { kind: "retry" } }]
  const records = input.records ?? []
  const rows: WebMcpAllowlistOption[] = webMcpAllowlistRows(records)
    .filter((record) => matches(webMcpAllowlistScopeTitle(record.scope), input.query))
    .map((record) => ({
      title: webMcpAllowlistScopeTitle(record.scope),
      value: { kind: "revoke", id: record.id },
      description: "This project • select to revoke",
      category: WEBMCP_ALLOWLIST_SAVED,
    }))
  const grants = webMcpAllowlistGrantOptions(records, input.query)
  const out: WebMcpAllowlistOption[] = [...rows]
  if (rows.length > 0 && input.query.trim() === "") {
    out.push({
      title: "Revoke all saved approvals for this bridge",
      value: { kind: "clear" },
      description: "This project only",
      category: WEBMCP_ALLOWLIST_SAVED,
    })
  }
  if (rows.length === 0 && input.query.trim() === "") {
    out.push({
      title: input.loading ? "Loading approvals..." : "No saved approvals",
      value: { kind: "none" },
      category: WEBMCP_ALLOWLIST_SAVED,
      disabled: true,
    })
  }
  out.push(...grants)
  if (rows.length === 0 && grants.length === 0 && input.query.trim() !== "") {
    out.push({ title: WEBMCP_ALLOWLIST_ORIGIN_HINT, value: { kind: "none" }, disabled: true })
  }
  return out
}
