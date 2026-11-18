import { createHash } from "node:crypto"
import { isRecord } from "@/util/record"
import type { Configuration } from "./webmcp-config"
import { pageOrigin, restricted, unlocatedPageMessage } from "./webmcp-origin"

/** Connection-local tool listings and the approval bindings derived from them. */
export const MAX_TOOLS = 50
export const MAX_DESCRIPTOR_BYTES = 64 * 1024
export const MAX_REGISTRATION_CHANGES = 10

export type ToolDescriptor = {
  name: string
  description?: string
  inputSchema?: unknown
  annotations?: { readOnly?: boolean; untrustedContent?: boolean; consequential?: boolean }
}

type PageState = {
  tools: Map<string, string>
  annotations: Map<string, ToolDescriptor["annotations"]>
  changes: number
  disabled: boolean
  origin: string | undefined
}
export type ListingState = { pages: Map<number, PageState> }
export type ListingResult = { ok: true } | { ok: false; error: string }

// The live profile object is recreated per connection (validateLaunch parses
// fresh each time) and frozen, so keying listing state by it yields
// per-connection state without threading a store through the MCP layer.
const listingStates = new WeakMap<Configuration, ListingState>()

export function stateFor(profile: Configuration): ListingState {
  let state = listingStates.get(profile)
  if (!state) {
    state = { pages: new Map() }
    listingStates.set(profile, state) // @scan-suppress lifecycle_scan - Weak keys release state with its connection profile.
  }
  return state
}

/** Parse the structured tool descriptors chrome-devtools-mcp returns. */
export function parseToolListing(result: unknown): ToolDescriptor[] | undefined {
  const record = isRecord(result) ? result : {}
  const structured = isRecord(record.structuredContent) ? record.structuredContent : undefined
  if (!structured || !Array.isArray(structured.webmcpTools)) return undefined
  const descriptors: ToolDescriptor[] = []
  for (const raw of structured.webmcpTools) {
    if (!isRecord(raw) || typeof raw.name !== "string" || raw.name.length === 0) return undefined
    descriptors.push({
      name: raw.name,
      description: typeof raw.description === "string" ? raw.description : undefined,
      inputSchema: raw.inputSchema,
      annotations: isRecord(raw.annotations)
        ? {
            readOnly: raw.annotations.readOnly === true,
            untrustedContent: raw.annotations.untrustedContent === true,
            consequential: raw.annotations.consequential === true,
          }
        : undefined,
    })
  }
  // Never truncate: the browser-workflow contracts listing and the runner's
  // find-by-name treat the result as complete. Callers that enforce the caps
  // (recordListing, verifyBinding) check the count before any per-entry work.
  return descriptors
}

export function descriptorHash(descriptor: ToolDescriptor): string {
  // Annotations ride along: the approval screen shows the listed
  // readOnly/consequential hints, so a flip must break the binding even
  // when the name, description and schema hash the same.
  return createHash("sha256")
    .update(
      JSON.stringify([
        descriptor.name,
        descriptor.description ?? "",
        descriptor.inputSchema ?? null,
        descriptor.annotations ?? null,
      ]),
    )
    .digest("hex")
}

function descriptorBytes(descriptors: ToolDescriptor[]): number {
  // Accumulate per descriptor and stop once the cap is certainly exceeded:
  // this runs before the cap check, so a listing of oversized schemas must
  // not be serialized in full just to be rejected. JSON separates entries
  // with a comma only between them, so the first entry adds no separator.
  let total = 2
  let first = true
  for (const descriptor of descriptors) {
    total += Buffer.byteLength(JSON.stringify(descriptor), "utf8") + (first ? 0 : 1)
    first = false
    if (total > MAX_DESCRIPTOR_BYTES) return total
  }
  return total
}

function duplicateToolName(descriptors: ToolDescriptor[]): string | undefined {
  const seen = new Set<string>()
  for (const descriptor of descriptors) {
    if (seen.has(descriptor.name)) return descriptor.name
    seen.add(descriptor.name)
  }
  return undefined
}

/**
 * Shared listing caps for the model's listing and the execute-time
 * re-listing. Both are listings; a page that exceeds the caps in either
 * path is not in an approvable state.
 */
function checkListingCaps(descriptors: ToolDescriptor[]): string | undefined {
  if (descriptors.length > MAX_TOOLS) {
    return `WebMCP page registers too many tools (${descriptors.length} > ${MAX_TOOLS})`
  }
  if (descriptorBytes(descriptors) > MAX_DESCRIPTOR_BYTES) {
    return "WebMCP tool descriptors exceed the descriptor size limit"
  }
  return undefined
}

function sameTools(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false
  for (const [name, hash] of a) if (b.get(name) !== hash) return false
  return true
}

/**
 * Clear a page's executable baseline while keeping its churn accounting. A
 * failed listing must not leave stale tools or origins behind for a later
 * execute to bind against — but it also must not reset the definition
 * churn count or revive a disabled page.
 */
function clearBaseline(state: ListingState, pageId: number): void {
  const existing = state.pages.get(pageId)
  if (!existing) return
  state.pages.set(pageId, {
    tools: new Map(),
    annotations: new Map(),
    changes: existing.changes,
    disabled: existing.disabled,
    origin: undefined,
  })
}

export function invalidateListing(profile: Configuration, pageId: number): void {
  clearBaseline(stateFor(profile), pageId)
}

/** Drop the closed page's listing baseline and churn accounting. */
export function forgetListing(profile: Configuration, pageId: number): void {
  listingStates.get(profile)?.pages.delete(pageId)
}

/**
 * Record a page's tool listing, enforcing the descriptor caps. Excessive tool
 * count or descriptor bytes fail closed; repeated definition churn past the
 * limit disables the page (it protects against approval-fatigue attacks).
 */
export function recordListing(
  state: ListingState,
  pageId: number,
  descriptors: ToolDescriptor[],
  pageUrl?: string | undefined,
): ListingResult {
  // Caps before the duplicate walk: an oversized listing fails on its O(1)
  // count without scanning every entry.
  const capped = checkListingCaps(descriptors)
  const duplicate = capped ? undefined : duplicateToolName(descriptors)
  const error = capped ?? (duplicate ? `WebMCP page registers a duplicate tool name (${duplicate})` : undefined)
  if (error) {
    clearBaseline(state, pageId)
    return { ok: false, error }
  }
  const origin = pageOrigin(pageUrl)
  if (!origin) {
    clearBaseline(state, pageId)
    return { ok: false, error: unlocatedPageMessage(pageUrl, "could not be located when its tools were listed") }
  }
  const tools = new Map<string, string>()
  const annotations = new Map<string, ToolDescriptor["annotations"]>()
  for (const descriptor of descriptors) {
    tools.set(descriptor.name, descriptorHash(descriptor))
    annotations.set(descriptor.name, descriptor.annotations) // @scan-suppress lifecycle_scan - Call-local map capped at MAX_TOOLS above.
  }
  const existing = state.pages.get(pageId)
  // A navigation counts as a page change just like a definition change.
  const same = existing && sameTools(existing.tools, tools) && existing.origin === origin
  const changes = existing && !same ? existing.changes + 1 : (existing?.changes ?? 0)
  if (changes > MAX_REGISTRATION_CHANGES) {
    state.pages.set(pageId, { tools, annotations, changes, disabled: true, origin })
    return { ok: false, error: "WebMCP tool definitions changed too many times on this page" }
  }
  state.pages.set(pageId, { tools, annotations, changes, disabled: false, origin })
  return { ok: true }
}

/** Approval-time annotations for a tool, when the model already listed it. */
export function annotationsFor(
  profile: Configuration,
  pageId: number,
  toolName: string,
): ToolDescriptor["annotations"] | undefined {
  const page = listingStates.get(profile)?.pages.get(pageId)
  if (!page || page.disabled) return undefined
  return page.annotations.get(toolName)
}

/** Listing-time origin for a page, when the model already listed it. */
export function listedOriginFor(profile: Configuration, pageId: number): string | undefined {
  const page = listingStates.get(profile)?.pages.get(pageId)
  if (!page || page.disabled) return undefined
  return page.origin
}

/**
 * Immutable approval-time binding for one `execute_webmcp_tool` call. The
 * listing baseline is connection-wide mutable state shared across sessions,
 * so the origin and descriptor hash the approver saw are captured when the
 * approval is requested and the dispatch-time preflight verifies the fresh
 * listing against this snapshot instead of the live baseline. A baseline
 * rewrite between approval and dispatch then fails closed instead of
 * executing a definition the user never approved.
 */
export type ApprovalSnapshot = { pageId: number; toolName: string; origin: string; hash: string }

/** Capture the current baseline for a tool, if the page has a usable listing. */
export function captureApproval(
  profile: Configuration,
  pageId: number,
  toolName: string,
): ApprovalSnapshot | undefined {
  const page = listingStates.get(profile)?.pages.get(pageId)
  if (!page || page.disabled || page.origin === undefined) return undefined
  const hash = page.tools.get(toolName)
  if (hash === undefined) return undefined
  return { pageId, toolName, origin: page.origin, hash }
}

const approvals = new WeakMap<object, ApprovalSnapshot>()

/** Bind a snapshot to the validated call object that carries it to dispatch. */
export function bindApproval(call: object, snapshot: ApprovalSnapshot): void {
  approvals.set(call, snapshot) // @scan-suppress lifecycle_scan - Weak keys release bindings with validated call objects.
}

/** Snapshot bound to a dispatch-time call object, if the approval captured one. */
export function approvalFor(args: unknown): ApprovalSnapshot | undefined {
  if (typeof args !== "object" || args === null) return undefined
  return approvals.get(args)
}

const denied = new WeakSet<object>()

/**
 * Mark a call object whose approval found no listing. Dispatch still asks
 * first (an unlisted execute surfaces its warning-laden approval dialog),
 * but the marked call can never fall back to a baseline another session
 * writes while approval is pending: it fails instead of executing a
 * definition the approver never saw.
 */
export function denyApproval(call: object): void {
  denied.add(call)
}

/**
 * Why an execute found no approval snapshot. "List first" is only true when the page
 * has no listing; repeating it after a listing that lacks the tool sent models back
 * to list -> execute forever.
 */
export function unlistedExecuteMessage(profile: Configuration, pageId: unknown, toolName: unknown): string {
  const page = typeof pageId === "number" ? listingStates.get(profile)?.pages.get(pageId) : undefined
  // A listing that holds the tool now was written after this call's approval found none.
  if (!page || page.disabled || page.origin === undefined || typeof toolName !== "string" || page.tools.has(toolName))
    return "WebMCP execute requires list_webmcp_tools to be called first"
  // Page-chosen names stay in the untrusted listing; this runtime sentence only counts them.
  const registered =
    page.tools.size > 0
      ? `it registered ${page.tools.size} other tool${page.tools.size === 1 ? "" : "s"}, named in that listing`
      : "registered: none"
  const fallback = profile.read === true ? "take_snapshot to read the page" : "webfetch for public content"
  return `WebMCP page ${pageId} registered no tool named ${JSON.stringify(toolName.slice(0, 64))} in its latest listing (${registered}). Do not execute it again; use a listed tool, ${fallback}, or report BLOCKED.`
}

/** Whether the approval for a dispatch-time call object found no listing. */
export function approvalDenied(args: unknown): boolean {
  return typeof args === "object" && args !== null && denied.has(args)
}

/**
 * Verify a fresh listing still matches what the model saw. `pageUrl` is the
 * page's current URL from a fresh `list_pages`; a missing page or an origin
 * that left the allowlist fails closed. When `expected` carries the
 * approval-time snapshot, the fresh listing is compared against it instead
 * of the live baseline, so a post-approval baseline rewrite fails closed.
 */
export function verifyBinding(
  profile: Configuration,
  pageId: number,
  toolName: string,
  descriptors: ToolDescriptor[],
  pageUrl?: string,
  expected?: ApprovalSnapshot,
): ListingResult {
  const page = listingStates.get(profile)?.pages.get(pageId)
  if (page?.disabled) return { ok: false, error: "WebMCP tool definitions are disabled for this page" }
  // A cleared baseline (failed listing) is equivalent to never having
  // listed for live-bound execution: the churn accounting stays on the
  // retained entry, but nothing may execute against it. A snapshot-bound
  // call still verifies the fresh listing against its approval below.
  const cleared = !page || page.origin === undefined
  if (cleared && !expected) {
    return { ok: false, error: "WebMCP execute requires list_webmcp_tools to be called first" }
  }
  // The re-listing is a listing too: an over-cap or ambiguous fresh
  // listing is not an approvable page state even when the one approved
  // tool still hashes the same. Caps before the duplicate walk: an
  // oversized listing fails on its O(1) count without scanning every entry.
  const capped = checkListingCaps(descriptors)
  if (capped) return { ok: false, error: capped }
  const duplicate = duplicateToolName(descriptors)
  if (duplicate) return { ok: false, error: `WebMCP re-listing registers a duplicate tool name (${duplicate})` }
  const origin = pageOrigin(pageUrl)
  if (!origin) return { ok: false, error: unlocatedPageMessage(pageUrl, "could not be located before execution") }
  if (expected) {
    if (expected.pageId !== pageId || expected.toolName !== toolName) {
      return { ok: false, error: "WebMCP approval does not match this call; refusing to execute" }
    }
    if (origin !== expected.origin) {
      return { ok: false, error: "WebMCP page origin changed since approval; list its tools again before executing" }
    }
    if (restricted(profile) && !profile.allowedOrigins.includes(origin)) {
      return { ok: false, error: "WebMCP page origin is no longer allowed" }
    }
    const fresh = descriptors.find((descriptor) => descriptor.name === toolName)
    if (!fresh) return { ok: false, error: `WebMCP tool ${toolName} is no longer registered` }
    if (descriptorHash(fresh) !== expected.hash) {
      return { ok: false, error: `WebMCP tool ${toolName} definition changed since approval` }
    }
    return { ok: true }
  }
  if (cleared || !page) {
    return { ok: false, error: "WebMCP execute requires list_webmcp_tools to be called first" }
  }
  // The execute-time origin must equal the listing-time origin: an
  // allowlist match alone would let two same-allowlist origins swap under
  // a mirrored tool definition.
  if (origin !== page.origin) {
    return { ok: false, error: "WebMCP page origin changed since its tools were listed" }
  }
  if (restricted(profile) && !profile.allowedOrigins.includes(origin)) {
    return { ok: false, error: "WebMCP page origin is no longer allowed" }
  }
  const stored = page.tools.get(toolName)
  if (stored === undefined) return { ok: false, error: `WebMCP tool ${toolName} was not in the listed tools` }
  const fresh = descriptors.find((descriptor) => descriptor.name === toolName)
  if (!fresh) return { ok: false, error: `WebMCP tool ${toolName} is no longer registered` }
  if (descriptorHash(fresh) !== stored) {
    return { ok: false, error: `WebMCP tool ${toolName} definition changed since it was listed` }
  }
  return { ok: true }
}
