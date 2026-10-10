import type { WebMcpApprovalRecord } from "@ax-code/sdk/v2"
import { grantableOrigin } from "@/mcp/webmcp-origin"

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
export const WEBMCP_ALLOWLIST_FOOTER_HINT = "Double click an entry (or press Enter twice) to revoke it"
/**
 * How long a first activation keeps a revoke row armed. A second activation
 * inside the window revokes; the row says so meanwhile. Long enough to read
 * the prompt, short enough that a stray click minutes later cannot revoke.
 */
export const WEBMCP_ALLOWLIST_ARM_MS = 4000

/** Display rank per capability: listing first, then navigation, read and close. */
const CAPABILITY_RANK: Record<WebMcpAllowlistCapability, number> = { list_pages: 0, navigate: 1, read: 2, close: 3 }
const ORIGIN_CAPABILITIES = ["navigate", "read", "close"] as const

/**
 * The exact origin a typed value would grant: the shared bridge rule plus
 * the store's wildcard and length limits. The server validates again; this
 * only decides whether an add row is offered.
 */
export function webMcpAllowlistOrigin(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed === "" || trimmed.includes("*") || trimmed.length > 2048) return undefined
  return grantableOrigin(trimmed)
}

/**
 * Identity of a destructive action for the two-step confirmation: revoking a
 * row and clearing the bridge each arm on the first activation and run on the
 * second. Grant rows have no key, so adding stays a single activation.
 */
export function webMcpAllowlistActionKey(action: WebMcpAllowlistAction): string | undefined {
  if (action.kind === "revoke") return `revoke:${action.id}`
  if (action.kind === "clear") return "clear"
  return undefined
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
  if (a.capability === "list_pages" || b.capability === "list_pages") return a.capability === b.capability
  return a.capability === b.capability && a.origin === b.origin
}

/** Lower-cased, trimmed query; empty matches everything. */
function needleOf(query: string): string {
  return query.trim().toLowerCase()
}

function matches(title: string, needle: string): boolean {
  return needle === "" || title.toLowerCase().includes(needle)
}

function scopeOrigin(scope: WebMcpAllowlistScope): string {
  return scope.capability === "list_pages" ? "" : scope.origin
}

/**
 * Saved records in a stable order: listing first, then by capability rank
 * and origin. Origins compare by code point, not locale, so the order is
 * the same on every machine and never depends on the ICU data available.
 */
export function webMcpAllowlistRows(records: readonly WebMcpApprovalRecord[]): WebMcpApprovalRecord[] {
  return [...records].sort((a, b) => {
    const rank = CAPABILITY_RANK[a.scope.capability] - CAPABILITY_RANK[b.scope.capability]
    if (rank !== 0) return rank
    const left = scopeOrigin(a.scope)
    const right = scopeOrigin(b.scope)
    return left < right ? -1 : left > right ? 1 : 0
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
  if (!saved.some((scope) => sameScope(scope, listing)) && matches(grantTitle(listing), needleOf(query)))
    scopes.push(listing)
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
 * Destructive rows carry their confirmation state in the description, so a
 * single activation never revokes silently. `armed` is caller-owned state:
 * this function cannot expire it, so the caller must clear it whenever the
 * armed row can leave the output (query change, refetch, revoke).
 */
export function webMcpAllowlistDialogOptions(input: {
  records: readonly WebMcpApprovalRecord[] | undefined
  query: string
  loading: boolean
  failed: boolean
  /** Action key (webMcpAllowlistActionKey) of the row whose first activation is pending confirmation. */
  armed?: string
}): WebMcpAllowlistOption[] {
  if (input.failed) return [{ title: "Could not load approvals — select to retry", value: { kind: "retry" } }]
  const records = input.records ?? []
  const needle = needleOf(input.query)
  const blank = needle === ""
  const rows: WebMcpAllowlistOption[] = webMcpAllowlistRows(records)
    .map((record) => ({ record, title: webMcpAllowlistScopeTitle(record.scope) }))
    .filter(({ title }) => matches(title, needle))
    .map(({ record, title }) => {
      const value: WebMcpAllowlistAction = { kind: "revoke", id: record.id }
      return {
        title,
        value,
        description:
          input.armed === webMcpAllowlistActionKey(value) ? "click again to revoke" : "double click to revoke",
        category: WEBMCP_ALLOWLIST_SAVED,
      }
    })
  const grants = webMcpAllowlistGrantOptions(records, input.query)
  const out: WebMcpAllowlistOption[] = [...rows]
  if (rows.length > 0 && blank) {
    const value: WebMcpAllowlistAction = { kind: "clear" }
    out.push({
      title: "Revoke all saved approvals for this bridge",
      value,
      description:
        input.armed === webMcpAllowlistActionKey(value) ? "click again to revoke all" : "double click to revoke all",
      category: WEBMCP_ALLOWLIST_SAVED,
    })
  }
  if (rows.length === 0 && blank) {
    out.push({
      title: input.loading ? "Loading approvals..." : "No saved approvals",
      value: { kind: "none" },
      category: WEBMCP_ALLOWLIST_SAVED,
      disabled: true,
    })
  }
  out.push(...grants)
  if (rows.length === 0 && grants.length === 0 && !blank) {
    out.push({ title: WEBMCP_ALLOWLIST_ORIGIN_HINT, value: { kind: "none" }, disabled: true })
  }
  return out
}
