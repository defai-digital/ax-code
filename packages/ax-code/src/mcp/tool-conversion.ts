import { dynamicTool, type Tool, type ToolCallOptions, jsonSchema, type JSONSchema7 } from "ai"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { CallToolResultSchema, type Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import { createHash } from "node:crypto"
import z from "zod"
import { WebMcpApprovals } from "./webmcp-approvals"
import { WebMcpProfile } from "./webmcp-profile"
import { redirectOriginOutsideAllowlist } from "./webmcp-redirect"

const log = Log.create({ service: "mcp" })
const MAX_TOOL_DESCRIPTION = 4_000
const MAX_TOOL_SCHEMA_BYTES = 64 * 1024
const NO_READ_GRANTS: ReadonlySet<string> = new Set()
const NO_INTERACT_GRANTS: ReadonlyMap<string, number> = new Map()

/**
 * ADR-174 preflight for a T2 call, after the page URL was resolved. Checks
 * the interact grant (and, for wait_for, the read grant), binds every uid to
 * the latest snapshot of the page, requires a focused control for press_key,
 * and spends one budget unit for a grant-covered action. Throws the typed
 * grant or binding errors the caller turns into prompts or fail-closed
 * results.
 */
function webmcpInteractPreflight(
  policy: WebMcpProfile.Policy,
  call: Record<string, unknown>,
  pageUrl: string | undefined,
  origin: string,
  /** The ask-time decision bound to the raw call object, when the session layer made one. */
  boundPerAction: boolean | undefined,
) {
  const grants = policy.interactGrants?.() ?? NO_INTERACT_GRANTS
  if (!grants.has(origin)) throw new WebMcpProfile.InteractNotGrantedError(origin)
  if (policy.toolName === "wait_for" && !(policy.readGrants?.() ?? NO_READ_GRANTS).has(origin)) {
    throw new WebMcpProfile.ReadNotGrantedError(origin)
  }
  const pageId = call.pageId as number
  const uids: string[] = []
  if (typeof call.uid === "string") uids.push(call.uid)
  if (Array.isArray(call.elements)) {
    for (const element of call.elements) {
      if (element && typeof element === "object" && typeof (element as { uid?: unknown }).uid === "string") {
        uids.push((element as { uid: string }).uid)
      }
    }
  }
  for (const uid of uids) WebMcpProfile.verifyTarget(policy.profile, pageId, uid, pageUrl)
  if (policy.toolName === "press_key") {
    // The key goes to whatever holds focus; bind it to the control the
    // snapshot recorded as focused, on the URL the snapshot was taken on.
    const focused = WebMcpProfile.focusedTargetFor(policy.profile, pageId)
    if (!focused) {
      throw new WebMcpProfile.TargetBindingError(
        "WebMCP press_key needs a focused control in the latest snapshot; take a new snapshot or click the control first",
      )
    }
    WebMcpProfile.verifyTarget(policy.profile, pageId, focused.uid, pageUrl)
  }
  // A per-action call was confirmed by the user; only grant-covered actions
  // spend the budget, and an exhausted budget renews through the same prompt.
  // The decision is the one the asks were based on (bound by the session
  // layer); a direct dispatch without a bound decision evaluates it here.
  const perAction = boundPerAction ?? WebMcpProfile.perActionCall(policy.profile, policy.toolName, call)
  if (!perAction) {
    if (!policy.consumeInteractBudget?.(origin)) throw new WebMcpProfile.InteractNotGrantedError(origin, true)
  }
}

async function webmcpPageUrl(
  client: Client,
  pageId: number,
  timeout: number | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const pages = await client.callTool({ name: "list_pages", arguments: {} }, CallToolResultSchema, {
    timeout,
    signal,
  })
  // An error result must never contribute snapshot data, even when it carries
  // a plausible-looking page list alongside the error.
  WebMcpProfile.validateResult("list_pages", pages)
  return WebMcpProfile.parseStructuredPages(pages)?.get(pageId)
}

/**
 * When a WebMCP navigation fails while its requested origin IS allowed, the
 * bridge may have blocked a redirect to a different origin. The pinned bridge
 * reports that as a generic net error (`net::ERR_INTERNET_DISCONNECTED at
 * <requested>`) that does not name the target — the target otherwise appears
 * only in the untrusted page title, which must never decide an origin. Probe
 * the requested URL's redirect chain (which requests only already-allowed
 * origins) and return the first origin outside the allowlist, so the caller
 * can raise a grantable error instead of an opaque failure. Fail closed.
 */
async function webmcpRedirectOrigin(
  policy: WebMcpProfile.Policy,
  call: Record<string, unknown>,
  timeout: number | undefined,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (policy.toolName !== "new_page" && policy.toolName !== "navigate_page") return undefined
  const requested = typeof call.url === "string" ? call.url : undefined
  if (!requested) return undefined
  const requestedOrigin = WebMcpProfile.grantableOrigin(requested)
  if (!requestedOrigin || !policy.profile.allowedOrigins.includes(requestedOrigin)) return undefined
  return redirectOriginOutsideAllowlist(
    requested,
    policy.profile.allowedOrigins,
    globalThis.fetch as unknown as Parameters<typeof redirectOriginOutsideAllowlist>[2],
    { timeoutMs: Math.min(timeout ?? 4_000, 4_000), signal },
  ).catch(() => undefined)
}

/**
 * Dispatch-time binding for execute_webmcp_tool. Runs after approval and before
 * the call: it snapshots the page URL, re-lists the page's tools, then
 * snapshots the page URL again, so a page that navigated mid-snapshot, changed
 * its tool definition, or left the listed origin fails closed instead of
 * executing a different tool than the one approved. The fresh listing is
 * verified against the approval-time snapshot when the approval captured one,
 * so a baseline rewrite between approval and dispatch fails closed. This
 * narrows, but does not eliminate, the TOCTOU window ADR-076 records: a
 * navigation after the final snapshot still lands outside the binding.
 */
async function webmcpPreflight(
  client: Client,
  policy: WebMcpProfile.Policy,
  call: Record<string, unknown>,
  budget: () => number | undefined,
  signal?: AbortSignal,
  expected?: WebMcpProfile.ApprovalSnapshot,
) {
  if (policy.toolName !== "execute_webmcp_tool") return
  const pageId = call.pageId as number
  const toolName = call.toolName as string
  const before = await webmcpPageUrl(client, pageId, budget(), signal)
  const listing = await client.callTool({ name: "list_webmcp_tools", arguments: { pageId } }, CallToolResultSchema, {
    timeout: budget(),
    signal,
  })
  WebMcpProfile.validateResult("list_webmcp_tools", listing)
  const after = await webmcpPageUrl(client, pageId, budget(), signal)
  if (!before || !after)
    throw new Error(WebMcpProfile.unlocatedPageMessage(before ?? after, "could not be located before execution"))
  if (before !== after) throw new Error("WebMCP page navigated during the execute-time re-listing")
  const descriptors = WebMcpProfile.parseToolListing(listing)
  if (!descriptors) throw new Error("WebMCP re-listing returned no tool descriptors; refusing to execute")
  const decision = WebMcpProfile.verifyBinding(policy.profile, pageId, toolName, descriptors, after, expected)
  if (!decision.ok) throw new Error(decision.error)
}

export type ConvertedMcpTool = Tool & { webmcp?: WebMcpProfile.Policy }

export function sanitizeMcpName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_")
}

export function mcpItemKey(clientName: string, itemName: string): string {
  return `${sanitizeMcpName(clientName)}:${sanitizeMcpName(itemName)}`
}

export function mcpToolPermissionKey(server: string, tool: string): string {
  return `${sanitizeMcpName(server)}_${sanitizeMcpName(tool)}`
}

export type McpToolIdentity = { server: string; tool: string }

/**
 * Preserve the established MCP permission key when it is unique, while
 * deterministically disambiguating names that collapse to the same sanitized
 * representation. Exact duplicate identities intentionally share a key.
 */
export function resolveMcpToolPermissionKeys(items: readonly McpToolIdentity[]): string[] {
  const groups = new Map<string, Map<string, McpToolIdentity>>()
  for (const item of items) {
    const base = mcpToolPermissionKey(item.server, item.tool)
    const identity = JSON.stringify([item.server, item.tool])
    const group = groups.get(base) ?? new Map<string, McpToolIdentity>()
    group.set(identity, item)
    groups.set(base, group)
  }

  const resolved = new Map<string, string>()
  const reserved = new Set<string>()
  for (const [base, group] of groups) {
    if (group.size !== 1) continue
    const identity = group.keys().next().value
    if (identity === undefined) continue
    resolved.set(identity, base)
    reserved.add(base)
  }

  const collisions = [...groups.entries()]
    .filter(([, group]) => group.size > 1)
    .flatMap(([base, group]) => [...group.keys()].map((identity) => ({ base, identity })))
    .sort((a, b) => {
      if (a.base !== b.base) return a.base < b.base ? -1 : 1
      if (a.identity === b.identity) return 0
      return a.identity < b.identity ? -1 : 1
    })

  for (const { base, identity } of collisions) {
    const hash = createHash("sha256").update(identity).digest("hex").slice(0, 12)
    const prefix = `${base}__mcp_${hash}`
    let key = prefix
    let suffix = 2
    while (reserved.has(key)) key = `${prefix}_${suffix++}`
    resolved.set(identity, key)
    reserved.add(key)
  }

  return items.map((item) => resolved.get(JSON.stringify([item.server, item.tool]))!)
}

export function mcpSchemaByteLength(schema: JSONSchema7): number {
  try {
    return Buffer.byteLength(JSON.stringify(schema), "utf8")
  } catch (error) {
    throw new Error(`MCP tool schema is not JSON-serializable: ${toErrorMessage(error)}`)
  }
}

export async function convertMcpTool(
  mcpTool: MCPToolDef,
  client: Client,
  timeout?: number,
  webmcp?: WebMcpProfile.Policy,
): Promise<ConvertedMcpTool> {
  const inputSchema = webmcp
    ? z.toJSONSchema(WebMcpProfile.callSchema(webmcp.toolName, webmcp.profile), { target: "draft-7" })
    : mcpTool.inputSchema

  // Spread first, then override type to ensure it is always "object".
  const schema: JSONSchema7 = {
    ...(inputSchema as JSONSchema7),
    type: "object",
    properties: (inputSchema.properties ?? {}) as JSONSchema7["properties"],
    additionalProperties: (inputSchema as JSONSchema7).additionalProperties ?? false,
  }
  const schemaBytes = mcpSchemaByteLength(schema)
  if (schemaBytes > MAX_TOOL_SCHEMA_BYTES) {
    throw new Error(`MCP tool schema too large: ${mcpTool.name}`)
  }
  const baseDescription =
    (mcpTool.description ?? "").length > MAX_TOOL_DESCRIPTION
      ? `${(mcpTool.description ?? "").slice(0, MAX_TOOL_DESCRIPTION)}...`
      : (mcpTool.description ?? "")
  const description = webmcp ? WebMcpProfile.toolDescription(webmcp.toolName, webmcp.profile) : baseDescription

  const tool = dynamicTool({
    description,
    inputSchema: jsonSchema(schema),
    execute: async (args: unknown, opts: ToolCallOptions) => {
      if (webmcp && typeof args === "object" && args !== null) await WebMcpApprovals.checkCall(args)
      const input = webmcp ? WebMcpProfile.validateCall(webmcp.profile, webmcp.toolName, args) : args
      // ADR-171/172: read-scope calls dispatch behind a per-origin session
      // read grant, with the page origin resolved through the bridge before
      // the call and re-verified after it.
      const readTier = webmcp !== undefined && WebMcpProfile.READ_SCOPE_TOOLS.some((name) => name === webmcp.toolName)
      const interactTier = webmcp !== undefined && WebMcpProfile.isInteractTool(webmcp.toolName)
      // The approval-time snapshot rides on the validated call object the
      // permission wrapper approved; direct dispatches without an approval
      // fall back to the live baseline check. A call the approval marked as
      // unlisted never takes that fallback: it fails instead of executing a
      // definition written after its approval was requested.
      if (webmcp?.toolName === "execute_webmcp_tool" && WebMcpProfile.approvalDenied(args)) {
        throw new Error("WebMCP execute requires list_webmcp_tools to be called first")
      }
      const expected = webmcp?.toolName === "execute_webmcp_tool" ? WebMcpProfile.approvalFor(args) : undefined
      // One absolute deadline for every WebMCP sub-call of this dispatch, so
      // the preflight snapshots, the main call and the listing bind cannot
      // each consume a full timeout. Cancellation propagates to every
      // sub-call. An exhausted budget fails here instead of dispatching a
      // call the SDK would time out immediately.
      const deadline = webmcp && timeout !== undefined ? Date.now() + timeout : undefined
      const budget = () => {
        if (deadline === undefined) return undefined
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new Error("WebMCP dispatch exceeded its timeout; do not retry automatically")
        return remaining
      }
      // ADR-171 preflight: the read grant is checked against the page's origin
      // resolved through the bridge (never the page-controlled title), before
      // the bridge is asked for any page content.
      let readOrigin: string | undefined
      if (readTier && webmcp) {
        const pageId = (input as Record<string, unknown>).pageId
        const before =
          typeof pageId === "number" ? await webmcpPageUrl(client, pageId, budget(), opts.abortSignal) : undefined
        const origin = WebMcpProfile.pageOriginOf(before)
        if (!origin)
          throw new Error(
            WebMcpProfile.unlocatedPageMessage(before, "could not be located before reading") +
              " Do not retry automatically.",
          )
        await WebMcpApprovals.checkReadContinuation(args as object, origin)
        if (!(webmcp.readGrants?.() ?? NO_READ_GRANTS).has(origin) && !(await webmcp.persistentReadAllowed?.(origin)))
          throw new WebMcpProfile.ReadNotGrantedError(origin)
        readOrigin = origin
      }
      // ADR-174 preflight: resolve the page through the bridge, require the
      // interact grant for its origin, bind every uid (and the focused
      // control) to the latest snapshot of that page, spend the budget.
      let interactOrigin: string | undefined
      let interactUrl: string | undefined
      if (interactTier && webmcp) {
        const pageId = (input as Record<string, unknown>).pageId
        const before =
          typeof pageId === "number" ? await webmcpPageUrl(client, pageId, budget(), opts.abortSignal) : undefined
        const origin = WebMcpProfile.pageOriginOf(before)
        if (!origin)
          throw new Error(
            WebMcpProfile.unlocatedPageMessage(before, "could not be located before acting") +
              " Do not retry automatically.",
          )
        const interactPolicy =
          webmcp.toolName === "wait_for" && (await webmcp.persistentReadAllowed?.(origin))
            ? { ...webmcp, readGrants: () => new Set([...(webmcp.readGrants?.() ?? []), origin]) }
            : webmcp
        webmcpInteractPreflight(
          interactPolicy,
          input as Record<string, unknown>,
          before,
          origin,
          WebMcpProfile.interactDecisionFor(args),
        )
        interactOrigin = origin
        interactUrl = before
      }
      if (webmcp) {
        await webmcpPreflight(
          client,
          webmcp,
          (input ?? {}) as Record<string, unknown>,
          budget,
          opts.abortSignal,
          expected,
        )
      }
      const listingPageId = webmcp?.toolName === "list_webmcp_tools" ? (input as { pageId: number }).pageId : undefined
      try {
        // Snapshot the listing-time page before the tools call so the
        // descriptors can be bound to the page they were read from.
        const listedBefore =
          listingPageId !== undefined
            ? await webmcpPageUrl(client, listingPageId, budget(), opts.abortSignal)
            : undefined
        // The approved WebMCP call shares the dispatch deadline: a fresh full
        // timeout here would let one dispatch run past twice its budget and
        // starve the post-listing bind of any time at all.
        if (webmcp?.toolName === "close_page") {
          const pageId = (input as { pageId: number }).pageId
          const origin = WebMcpProfile.pageOriginOf(await webmcpPageUrl(client, pageId, budget(), opts.abortSignal))
          WebMcpApprovals.checkCloseTarget(args as object, pageId, origin)
          // The page lookup is asynchronous: revocation or a deny during it
          // must still stop a saved close before the bridge acts.
          await WebMcpApprovals.checkCall(args as object)
        }
        if (readTier && readOrigin) {
          await WebMcpApprovals.checkReadContinuation(args as object, readOrigin)
          await WebMcpApprovals.checkCall(args as object)
        }
        // Same window as close_page above: a revocation or deny during the
        // interact page lookup must still stop the action before the bridge
        // runs it.
        if (interactTier && interactOrigin) {
          await WebMcpApprovals.checkCall(args as object)
        }
        opts.abortSignal?.throwIfAborted()
        const mainTimeout = webmcp ? budget() : timeout
        const result = await client.callTool(
          {
            name: mcpTool.name,
            arguments: {
              ...((input || {}) as Record<string, unknown>),
              ...(webmcp?.toolName === "new_page"
                ? WebMcpProfile.workflowContextArguments(webmcp.profile, input as object)
                : {}),
            },
          },
          CallToolResultSchema,
          {
            resetTimeoutOnProgress: true,
            // A bridge that streams progress forever must not extend an
            // approved WebMCP call past its total budget.
            ...(webmcp && mainTimeout !== undefined ? { maxTotalTimeout: mainTimeout } : {}),
            signal: opts.abortSignal,
            timeout: mainTimeout,
          },
        )
        if (webmcp) {
          try {
            WebMcpProfile.validateResult(webmcp.toolName, result)
            WebMcpProfile.validateLanding(
              webmcp.profile,
              webmcp.toolName,
              (input ?? {}) as Record<string, unknown>,
              result,
            )
          } catch (error) {
            // The bridge blocked a redirect the allowlist does not cover. Probe
            // the requested URL (allowed origins only) and, when it names a
            // grantable origin, raise a grantable error so the ADR-168 prompt
            // can offer to allow it instead of an opaque failure.
            opts.abortSignal?.throwIfAborted()
            const redirect = await webmcpRedirectOrigin(
              webmcp,
              (input ?? {}) as Record<string, unknown>,
              budget(),
              opts.abortSignal,
            )
            opts.abortSignal?.throwIfAborted()
            budget()
            if (redirect) throw new WebMcpProfile.OriginNotGrantedError(redirect)
            throw error
          }
          if (readTier && webmcp && readOrigin) {
            // Re-resolve the page after the call: a page that navigated to
            // another origin mid-read discards its output (ADR-171).
            const pageId = (input as Record<string, unknown>).pageId as number
            const after = await webmcpPageUrl(client, pageId, budget(), opts.abortSignal)
            if (WebMcpProfile.pageOriginOf(after) !== readOrigin) {
              throw new Error("WebMCP page navigated during the read; the read output is discarded")
            }
            WebMcpProfile.boundReadResult(webmcp.toolName, result, readOrigin)
            // ADR-174 rule 5: the structured snapshot becomes the uid map
            // for later actions, bound to the URL resolved right after it.
            if (webmcp.toolName === "take_snapshot") {
              const nodes = WebMcpProfile.parseStructuredSnapshot(result)
              if (nodes && after) WebMcpProfile.recordSnapshot(webmcp.profile, pageId, nodes, after)
              else WebMcpProfile.clearSnapshot(webmcp.profile, pageId)
            }
          }
          if (interactTier && webmcp && interactOrigin) {
            // ADR-174 rules 6, 8, 9: the action happened, so a navigation is
            // reported, never discarded; any URL change invalidates the uid
            // map; wait_for output is a snapshot and is bounded as one.
            const pageId = (input as Record<string, unknown>).pageId as number
            const after = await webmcpPageUrl(client, pageId, budget(), opts.abortSignal)
            const afterOrigin = WebMcpProfile.pageOriginOf(after)
            if (webmcp.toolName === "wait_for") {
              if (afterOrigin !== interactOrigin) {
                WebMcpProfile.clearSnapshot(webmcp.profile, pageId)
                throw new Error("WebMCP page navigated during the wait; the snapshot is discarded")
              }
              WebMcpProfile.boundReadResult("wait_for", result, interactOrigin)
              const nodes = WebMcpProfile.parseStructuredSnapshot(result)
              if (nodes && after) WebMcpProfile.recordSnapshot(webmcp.profile, pageId, nodes, after)
              else WebMcpProfile.clearSnapshot(webmcp.profile, pageId)
            } else {
              WebMcpProfile.boundActionResult(result, interactOrigin, afterOrigin, after !== interactUrl)
              if (after !== interactUrl) WebMcpProfile.clearSnapshot(webmcp.profile, pageId)
            }
          }
          if (webmcp && typeof (input as Record<string, unknown>).pageId === "number") {
            WebMcpProfile.recordDialog(webmcp.profile, (input as Record<string, unknown>).pageId as number, result)
          }
          if (listingPageId !== undefined) {
            const after = await webmcpPageUrl(client, listingPageId, budget(), opts.abortSignal)
            if (!listedBefore || !after)
              throw new Error(
                WebMcpProfile.unlocatedPageMessage(
                  after ?? listedBefore,
                  "could not be located when its tools were listed",
                ),
              )
            if (listedBefore !== after) throw new Error("WebMCP page navigated while its tools were listed")
            // An unparseable listing fails the call: there is no binding to
            // store, and the previous baseline must not silently stand in.
            const descriptors = WebMcpProfile.parseToolListing(result)
            if (!descriptors) throw new Error("WebMCP tool listing could not be parsed; refusing an unbound listing")
            opts.abortSignal?.throwIfAborted()
            const recorded = WebMcpProfile.recordListing(
              WebMcpProfile.stateFor(webmcp.profile),
              listingPageId,
              descriptors,
              after,
            )
            if (!recorded.ok) throw new Error(recorded.error)
          }
        }
        if (webmcp) WebMcpProfile.annotateBlockingDialog(result, webmcp.profile.interact === true)
        return result
      } catch (e) {
        // A successful listing returns immediately after it is recorded, so
        // every failure here must invalidate the previous page baseline.
        if (webmcp && listingPageId !== undefined) {
          WebMcpProfile.invalidateListing(webmcp.profile, listingPageId)
        }
        log.error("MCP tool call failed", { tool: mcpTool.name, error: toErrorMessage(e) })
        throw e
      }
    },
  })
  return webmcp
    ? Object.assign(tool, {
        webmcp: {
          ...webmcp,
          ...(webmcp.toolName === "close_page"
            ? {
                closePageOrigin: async (pageId: number, signal?: AbortSignal) =>
                  WebMcpProfile.pageOriginOf(await webmcpPageUrl(client, pageId, timeout, signal)),
              }
            : {}),
        },
      })
    : tool
}
