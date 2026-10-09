/**
 * Tool resolution and schema caching for the prompt loop.
 *
 * Extracted from prompt.ts to reduce file size and improve maintainability.
 */

import z from "zod"
import { type Tool as AITool, tool, jsonSchema, type ToolCallOptions, asSchema } from "ai"
import { Log } from "../../util/log"
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import { ModelID } from "../../provider/schema"
import { Plugin } from "../../plugin"
import { Session } from ".."
import { MessageV2 } from "../message-v2"
import { PartID } from "../schema"
import { ToolRegistry } from "../../tool/registry"
import { Tool } from "../../tool/tool"
import { MCP } from "../../mcp"
import { ToolDiscovery } from "../tool-discovery"
import { McpPermissionPattern } from "../../mcp/permission-pattern"
import { WebMcpApprovals } from "../../mcp/webmcp-approvals"
import { WebMcpProfile } from "../../mcp/webmcp-profile"
import { BrowserWorkflow } from "../../browser-workflow/service"
import { ProviderTransform } from "../../provider/transform"
import { Permission } from "@/permission"
import { Isolation } from "@/isolation"
import { Config } from "@/config/config"
import { Instance } from "../../project/instance"
import { Truncate } from "@/tool/truncate"
import { safeUtf8PrefixLength } from "@/tool/bash-helpers"
import { uniqueStrings } from "@/util/string-list"
import { parseJsonResult } from "@/util/json-value"
import { isRecord } from "@/util/record"
import { defer } from "@/util/defer"
import { ToolWriteGate } from "../tool-write-gate"
import type { SessionProcessor } from "../processor"
import { permissionRulesetFromLegacyTools } from "./prompt-permission"
import { estimateToolDefinitionTokens } from "./prompt-request"
import { createHash } from "node:crypto"

const log = Log.create({ service: "session.prompt.tools" })

/**
 * ADR-174 rule 11: each live assistant-turn processor owns its T2 breaker.
 * Weak keys release completed turns and prevent late calls from replacing
 * another turn's counters.
 */
const webmcpBreakers = Instance.state(() => new WeakMap<SessionProcessor.Info, WebMcpProfile.InteractBreaker>())

function webmcpTurnBreaker(processor: SessionProcessor.Info): WebMcpProfile.InteractBreaker {
  const map = webmcpBreakers()
  const existing = map.get(processor)
  if (existing) return existing
  const fresh = new WebMcpProfile.InteractBreaker(processor.message.id)
  map.set(processor, fresh) // @scan-suppress lifecycle_scan: weak processor keys are collected after the turn
  return fresh
}

function webmcpTargetSummary(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined
  const parts: string[] = []
  if (typeof metadata.tool === "string") parts.push(metadata.tool)
  const target = isRecord(metadata.target) ? metadata.target : undefined
  if (target && typeof target.uid === "string" && target.uid) parts.push(`uid ${target.uid}`)
  if (target && typeof target.name === "string" && target.name) parts.push(`"${target.name.slice(0, 60)}"`)
  if (typeof metadata.pageOrigin === "string") parts.push(`on ${metadata.pageOrigin}`)
  return parts.length > 0 ? parts.join(" ") : undefined
}

// Schema transforms may capture project-defined tool schemas. Keep both the
// LRU and in-flight work scoped to the active project instance so two projects
// with the same tool ID/model cannot reuse each other's schema.
type PendingSchema = { promise: Promise<any> }
const schemaState = Instance.state(() => ({
  cache: new Map<string, any>(),
  mcpPending: new Map<string, PendingSchema>(),
}))
const SCHEMA_CACHE_MAX = 500
const SCHEMA_CACHE_DROP = 100

function schemaCache() {
  return schemaState().cache
}

function touchSchemaCache(cache: Map<string, any>, cacheKey: string, value: any) {
  cache.delete(cacheKey)
  cache.set(cacheKey, value)
}

function setSchemaCache(cache: Map<string, any>, cacheKey: string, value: any) {
  if (!cache.has(cacheKey) && cache.size >= SCHEMA_CACHE_MAX) {
    let dropped = 0
    for (const key of cache.keys()) {
      cache.delete(key)
      if (++dropped >= SCHEMA_CACHE_DROP) break
    }
  }
  cache.set(cacheKey, value)
}

function schemaFingerprint(schema: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(schema) ?? "undefined")
    .digest("base64url")
}

export async function transformMcpInputSchema(input: {
  cacheKey: string
  model: Provider.Model
  inputSchema: Parameters<typeof asSchema>[0]
}) {
  const current = schemaState()
  const schemaJson = await Promise.resolve(asSchema(input.inputSchema).jsonSchema)
  const modelIdentity = schemaFingerprint({
    id: input.model.id,
    providerID: input.model.providerID,
    apiID: input.model.api.id,
    npm: input.model.api.npm,
    url: input.model.api.url,
  })
  const cacheKey = `${input.cacheKey}:${modelIdentity}:${schemaFingerprint(schemaJson)}`
  const cached = current.cache.get(cacheKey)
  if (cached !== undefined) {
    touchSchemaCache(current.cache, cacheKey, cached)
    return cached
  }

  const pending = current.mcpPending.get(cacheKey)
  if (pending) return pending.promise

  const inFlight: PendingSchema = {
    promise: (async () => {
      const cachedAfterAwait = current.cache.get(cacheKey)
      if (cachedAfterAwait !== undefined) {
        touchSchemaCache(current.cache, cacheKey, cachedAfterAwait)
        return cachedAfterAwait
      }
      const transformed = ProviderTransform.schema(input.model, schemaJson)
      setSchemaCache(current.cache, cacheKey, transformed)
      return transformed
    })(),
  }
  current.mcpPending.set(cacheKey, inFlight)
  try {
    return await inFlight.promise
  } finally {
    if (current.mcpPending.get(cacheKey) === inFlight) current.mcpPending.delete(cacheKey)
  }
}

/**
 * Compute the isolation state with path and network bypasses applied.
 * Used when retrying tool execution after isolation escalation.
 */
export function isolationRetryState(input: {
  isolation: Isolation.State | undefined
  pathBypass: string[]
  networkBypass: boolean
}): Isolation.State | undefined {
  if (!input.isolation) return undefined
  const bypass = uniqueStrings([...(input.isolation.bypass ?? []), ...input.pathBypass])
  return {
    ...input.isolation,
    network: input.networkBypass ? true : input.isolation.network,
    ...(bypass.length ? { bypass } : {}),
  }
}

/**
 * Shared evidence boundary for every supported tool surface. The execution
 * closure remains surface-specific (registry isolation, MCP permission, etc.)
 * while plugin and user lifecycle hooks stay consistent.
 */
/** Permission name used when a PreToolUse hook answers `ask`. Interactive-only. */
export const HOOK_CONFIRMATION_PERMISSION = "hook"

/**
 * Tools that mutate the workspace, run code, or reach outside the process
 * and therefore take the exclusive lane of the session write gate when the
 * model calls them in parallel with other tools. Everything else is shared.
 * MCP tools are exclusive: their side effects are unknown to the harness.
 */
const EXCLUSIVE_TOOL_IDS: ReadonlySet<string> = new Set([
  "edit",
  "write",
  "multiedit",
  "apply_patch",
  "notebook_edit",
  "refactor_apply",
  "bash",
  "bash_input",
  "ops_apply",
  "task",
  "task_parallel",
])

export function toolGateMode(input: {
  toolID: string
  args: unknown
  childSafe?: (call: { tool: string; parameters: unknown }) => boolean
}): "shared" | "exclusive" {
  if (EXCLUSIVE_TOOL_IDS.has(input.toolID)) return "exclusive"
  if (input.toolID === "batch") {
    // A batch is only as safe as its least safe child.
    const calls = isRecord(input.args) && Array.isArray(input.args["tool_calls"]) ? input.args["tool_calls"] : []
    for (const call of calls) {
      if (!isRecord(call) || typeof call["tool"] !== "string") return "exclusive"
      if (!input.childSafe?.({ tool: call["tool"], parameters: call["parameters"] })) return "exclusive"
    }
  }
  return "shared"
}

/** Wrap PostToolUse hook feedback so the model can tell it apart from tool output. */
export function formatHookFeedback(feedback: string) {
  return `\n\n<hook_feedback event="PostToolUse">\n${feedback}\n</hook_feedback>`
}

/**
 * Hook feedback for the MCP result path, under its own budget. Feedback is
 * appended AFTER the tool-output cap, so neither side can squeeze the other
 * out: untrusted output keeps its 8 MiB and trusted plugin signals always
 * keep up to 64 KiB. The feedback body truncates before formatting, so the
 * format wrapper never copies an unbounded plugin string.
 */
export function boundMcpHookFeedback(feedback: string): string {
  const overhead = Buffer.byteLength(formatHookFeedback(""), "utf8")
  const marker = `[hook feedback truncated at ${MAX_MCP_HOOK_FEEDBACK_BYTES} bytes]`
  if (Buffer.byteLength(feedback, "utf8") + overhead <= MAX_MCP_HOOK_FEEDBACK_BYTES) return formatHookFeedback(feedback)
  return formatHookFeedback(
    `${truncateUtf8Bytes(feedback, MAX_MCP_HOOK_FEEDBACK_BYTES - overhead - Buffer.byteLength(marker, "utf8") - 1)}\n${marker}`,
  )
}

export async function runToolLifecycle<T>(input: {
  toolID: string
  sessionID: string
  callID?: string
  args: unknown
  cwd: string
  /**
   * Permission channel of the calling tool. When present, a PreToolUse hook
   * that answers `ask` is routed here as an interactive-only `hook`
   * permission; when absent the ask degrades to a fail-safe block.
   */
  ask?: Tool.Context["ask"]
  /** Receives bounded PostToolUse hook feedback for inclusion in the tool result. */
  onFeedback?: (feedback: string) => void
  execute(): Promise<T>
}): Promise<T> {
  await Plugin.trigger(
    "tool.execute.before",
    {
      tool: input.toolID,
      sessionID: input.sessionID,
      callID: input.callID,
    },
    { args: input.args },
  )

  let askReason: string | undefined
  try {
    const { LifecycleHooks } = await import("@/hooks/lifecycle")
    const pre = await LifecycleHooks.runForWorkspace({
      event: "PreToolUse",
      sessionID: input.sessionID,
      tool: input.toolID,
      args: input.args,
      cwd: input.cwd,
    })
    if (pre.blocked) {
      const detail =
        pre.blockReason ??
        pre.outputs
          .filter((output) => output.exit !== 0)
          .map((output) => output.stderr || output.stdout || `exit ${output.exit}`)
          .join("\n")
      throw new Error(`PreToolUse hook blocked tool ${input.toolID}: ${detail || "hook failed"}`)
    }
    if (pre.ask) {
      if (!input.ask) throw new Error(`PreToolUse hook blocked tool ${input.toolID}: ${pre.ask.reason}`)
      askReason = pre.ask.reason
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PreToolUse hook blocked")) throw error
    // Hook load/run failures must not brick the agent loop.
  }

  if (askReason !== undefined && input.ask) {
    // Outside the try above so a user rejection propagates as the ordinary
    // Permission.RejectedError the processor already understands.
    await input.ask({
      permission: HOOK_CONFIRMATION_PERMISSION,
      patterns: [input.toolID],
      always: [],
      metadata: { requireInteractive: true, tool: input.toolID, reason: askReason },
    })
  }

  let result: T
  try {
    result = await input.execute()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    void import("@/hooks/lifecycle")
      .then(({ LifecycleHooks }) =>
        LifecycleHooks.runForWorkspace({
          event: "PostToolUseFailure",
          sessionID: input.sessionID,
          tool: input.toolID,
          args: { args: input.args, error: message.slice(0, 4_000) },
          cwd: input.cwd,
        }),
      )
      .catch(() => undefined)
    throw error
  }

  await Plugin.trigger(
    "tool.execute.after",
    {
      tool: input.toolID,
      sessionID: input.sessionID,
      callID: input.callID,
      args: input.args,
    },
    result,
  )

  try {
    const { LifecycleHooks } = await import("@/hooks/lifecycle")
    const post = await LifecycleHooks.runForWorkspace({
      event: "PostToolUse",
      sessionID: input.sessionID,
      tool: input.toolID,
      args: input.args,
      cwd: input.cwd,
    })
    if (post.feedback && input.onFeedback) input.onFeedback(post.feedback)
  } catch {
    // Post hooks are evidence/automation helpers and remain non-fatal.
  }

  return result
}

interface ResolveToolsInput {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  tools?: Record<string, boolean>
  processor: SessionProcessor.Info
  bypassAgentCheck: boolean
  messages: MessageV2.WithParts[]
  isolation?: Isolation.State
  goalBinding?: { created: number | undefined }
}

export function shouldBypassAgentCheck(parts: MessageV2.Part[] | undefined): boolean {
  return parts?.some((part) => part.type === "agent") ?? false
}

type McpToolContentItem = {
  type: string
  text?: string
  mimeType?: string
  data?: string
  resource?: {
    text?: string
    blob?: string
    mimeType?: string
    uri?: string
  }
}

// Untrusted MCP content bounds. A hostile server or page tool must not
// exhaust memory, session storage or the truncation directory with giant
// texts or binary attachments; over-limit content degrades to a placeholder.
// The text budget is enforced WHILE collecting: bounding only the joined
// output would still allocate one full copy per part plus the join buffer.
const MAX_MCP_ATTACHMENTS = 10
const MAX_MCP_ATTACHMENT_BASE64 = 8 * 1024 * 1024
const MAX_MCP_ATTACHMENTS_TOTAL_BASE64 = 16 * 1024 * 1024
const MAX_MCP_TEXT_BYTES = 8 * 1024 * 1024
const MAX_MCP_FILENAME = 1024
const MAX_MCP_SERVER_METADATA_BYTES = 16 * 1024
const MAX_MCP_HOOK_FEEDBACK_BYTES = 64 * 1024
const MAX_MCP_JSON_DEPTH = 64
// Pretty-printed base64 wraps every ~76 chars (~3% overhead). The raw-length
// pre-gate allows this slack past the caps, so near-cap wrapped payloads
// still validate while the compaction copy stays hard-bounded.
const MAX_MCP_BASE64_SLACK = 256 * 1024
// Rejected attachment bytes scanned before the walk stops. Stored bytes need
// no scan cap (the 16 MiB total bounds them); only rejected scans accumulate.
const MAX_MCP_DROPPED_SCAN_BYTES = 64 * 1024 * 1024
// Consecutive scan-costly items (measured base64, validated payloads) that
// keep neither text nor attachment before the walk stops. O(1) skips
// (unknown types, empty text) never consume this budget; they have their
// own far higher cap below, so a long benign list cannot drop a trailing
// real summary.
const MAX_MCP_IDLE_ITEMS = 1024
// Unsupported-but-benign content items (resource_link, audio, empty text)
// skipped before the walk stops. Skipping is O(1) with no scan cost, so
// the cap only bounds the walk itself, not attacker rejection pressure.
const MAX_MCP_SKIPPED_ITEMS = 100_000
const MCP_SCAN_STOPPED = "[MCP content scan stopped: too much rejected content]"
const MCP_SCAN_STOPPED_SKIPPED = "[MCP content scan stopped: too many unsupported items]"
const MIME_PATTERN = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/

function validMcpMimeType(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length <= 128 && MIME_PATTERN.test(value) ? value : fallback
}

/**
 * Byte-precise truncation with bounded transient allocation. The char slice
 * over-approximates (one UTF-16 unit encodes to at most 3 UTF-8 bytes), so
 * the temporary buffer stays within ~3x the limit instead of the input size.
 * The end backtracks to a UTF-8 character boundary, so the result holds only
 * complete characters and never a decoder-invented U+FFFD fragment.
 */
function truncateUtf8Bytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text
  const buf = Buffer.from(text.slice(0, maxBytes), "utf8")
  return buf.subarray(0, safeUtf8PrefixLength(buf, maxBytes)).toString("utf8")
}

type McpImageKind = "png" | "jpeg" | "gif" | "webp"

// Providers accept a narrow image set; anything else (svg with script
// potential, tiff, bmp, application/* masquerading as image/*) degrades to a
// placeholder instead of poisoning every later provider request.
const MCP_IMAGE_TYPES: Record<string, McpImageKind> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
}

function mcpImageMagicMatches(kind: McpImageKind, bytes: Buffer): boolean {
  switch (kind) {
    case "png":
      return (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      )
    case "jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    case "gif":
      return (
        bytes.length >= 6 &&
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x38 &&
        (bytes[4] === 0x37 || bytes[4] === 0x39) &&
        bytes[5] === 0x61
      )
    case "webp":
      return (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      )
  }
}

/**
 * Declared image bytes must open with the format's magic signature, so a
 * mislabeled HTML or text payload cannot ride into session history as an
 * image part. Reads only a short head prefix off the raw payload (skipping
 * wrapping whitespace), so a magic mismatch never compacts the full body
 * first. Full magic forgery still needs a real image decoder, which stays
 * the provider's job.
 */
function mcpImageMagicOkRaw(kind: McpImageKind, data: string): boolean {
  let head = ""
  for (let index = 0; index < data.length && head.length < 24; index++) {
    const char = data[index]
    if (char === undefined) break
    if (char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f" || char === "\v") continue
    head += char
  }
  if (head.length < 4) return false
  try {
    return mcpImageMagicMatches(kind, Buffer.from(head, "base64"))
  } catch {
    return false
  }
}

/**
 * Zero-copy base64 measurement: one scan validates the charset, the padding
 * placement and the length, so a hostile multi-hundred-megabyte payload is
 * rejected before any compaction copy exists. Only the six common ASCII
 * whitespace chars are tolerated; anything else fails closed.
 */
function measureBase64(data: string): { length: number; hasWhitespace: boolean } | undefined {
  let length = 0
  let padding = 0
  let hasWhitespace = false
  for (let index = 0; index < data.length; index++) {
    const code = data.charCodeAt(index)
    if (code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 11) {
      hasWhitespace = true
      continue
    }
    if (code === 61) {
      padding++
      length++
      continue
    }
    const valid =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47
    if (!valid || padding > 0) return undefined
    length++
  }
  if (length === 0 || length % 4 !== 0 || padding > 2) return undefined
  return { length, hasWhitespace }
}

export function collectMcpToolContent(content: McpToolContentItem[]) {
  const textParts: string[] = []
  const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []
  let totalBase64 = 0
  let textBytes = 0
  let textCapped = false
  let droppedScanBytes = 0
  let idleItems = 0
  let skippedItems = 0
  // O(1) skips (unsupported types, empty text, content-less resources) share
  // one far-higher cap; returns true when the walk must stop. Skips never
  // touch the rejected-idle budget, so a long benign list cannot drop a
  // trailing real summary or misreport a rejection flood.
  const skipItem = (): boolean => {
    skippedItems++
    if (skippedItems >= MAX_MCP_SKIPPED_ITEMS) {
      pushText(MCP_SCAN_STOPPED_SKIPPED)
      return true
    }
    return false
  }
  const pushText = (part: string) => {
    if (textCapped) return
    // Parts join with "\n\n" downstream, so the separator counts too;
    // otherwise a flood of tiny parts smuggles ~2 bytes each past the cap.
    const separator = textParts.length > 0 ? 2 : 0
    const bytes = separator + Buffer.byteLength(part, "utf8")
    if (textBytes + bytes <= MAX_MCP_TEXT_BYTES) {
      textParts.push(part)
      textBytes += bytes
      return
    }
    textParts.push(truncateUtf8Bytes(part, Math.max(0, MAX_MCP_TEXT_BYTES - textBytes - separator)))
    textParts.push(MCP_TEXT_TRUNCATED)
    textCapped = true
  }
  // Drops a scanned payload, stopping the walk once rejected scans pile up.
  // Returns "stop" when the caller must break out of the content loop.
  const dropScanned = (dataLength: number, message: string): "dropped" | "stop" => {
    droppedScanBytes += dataLength
    if (droppedScanBytes > MAX_MCP_DROPPED_SCAN_BYTES) {
      pushText(MCP_SCAN_STOPPED)
      return "stop"
    }
    pushText(message)
    return "dropped"
  }
  const pushAttachment = (
    mime: string,
    data: string,
    filename?: string,
    imageKind?: McpImageKind,
  ): "stored" | "dropped" | "stop" => {
    if (attachments.length >= MAX_MCP_ATTACHMENTS) {
      pushText("[MCP attachment dropped: too many attachments in one result]")
      return "dropped"
    }
    if (totalBase64 >= MAX_MCP_ATTACHMENTS_TOTAL_BASE64) {
      pushText("[MCP attachment dropped: exceeds the attachment size limit]")
      return "dropped"
    }
    // Raw pre-gate in O(1): the raw length over-approximates the compact one,
    // so anything past the caps plus wrapping slack is rejected before the
    // validating scan or the compaction copy. Only whitespace-heavy monsters
    // past the slack (never legitimate wrapping) take this exit.
    if (
      data.length > MAX_MCP_ATTACHMENT_BASE64 + MAX_MCP_BASE64_SLACK ||
      totalBase64 + data.length > MAX_MCP_ATTACHMENTS_TOTAL_BASE64 + MAX_MCP_BASE64_SLACK
    ) {
      pushText("[MCP attachment dropped: exceeds the attachment size limit]")
      return "dropped"
    }
    // Invalid base64 would persist a broken data URL into session history
    // and poison every later provider request, so validate before storing.
    // Measure first without copying: a hostile oversized payload is rejected
    // before the whitespace compaction allocates anything.
    const measured = measureBase64(data)
    if (!measured) return dropScanned(data.length, "[MCP attachment dropped: invalid base64 content]")
    if (
      measured.length > MAX_MCP_ATTACHMENT_BASE64 ||
      totalBase64 + measured.length > MAX_MCP_ATTACHMENTS_TOTAL_BASE64
    ) {
      return dropScanned(data.length, "[MCP attachment dropped: exceeds the attachment size limit]")
    }
    if (imageKind !== undefined && !mcpImageMagicOkRaw(imageKind, data)) {
      return dropScanned(data.length, `[MCP attachment dropped: image content does not match ${mime}]`)
    }
    const compact = measured.hasWhitespace ? data.replace(/\s/g, "") : data
    totalBase64 += compact.length
    attachments.push({
      type: "file",
      mime,
      url: `data:${mime};base64,${compact}`,
      ...(filename !== undefined ? { filename: filename.slice(0, MAX_MCP_FILENAME) } : {}),
    })
    return "stored"
  }

  for (const contentItem of content) {
    // Four stop conditions keep a hostile flood at O(capped) cost instead of
    // O(n): exhausted budgets (later pushes are no-ops), rejected-scan bytes
    // (returned as "stop"), scan-costly idle items that keep neither text
    // nor bytes, and O(1) skipped items (unsupported types, empty text).
    if (textCapped && (attachments.length >= MAX_MCP_ATTACHMENTS || totalBase64 >= MAX_MCP_ATTACHMENTS_TOTAL_BASE64))
      break
    const keptTexts = textParts.length
    const keptAttachments = attachments.length
    let stop = false
    if (contentItem.type === "text" && typeof contentItem.text === "string" && contentItem.text) {
      pushText(contentItem.text)
    } else if (contentItem.type === "image" && typeof contentItem.data === "string" && contentItem.data) {
      // Image attachments must stay inside the provider-supported set with
      // matching magic bytes: anything else would flow to renderers or
      // providers as an image part and poison every later request.
      const mimeType = validMcpMimeType(contentItem.mimeType, "image/png").toLowerCase()
      const kind = MCP_IMAGE_TYPES[mimeType]
      if (!kind) {
        pushText(`[MCP attachment dropped: unsupported image mime type ${mimeType}]`)
      } else {
        const outcome = pushAttachment(mimeType, contentItem.data, undefined, kind)
        // Label only what survived: announcing first would record a phantom
        // attachment when the drop reason itself hits the text cap.
        if (outcome === "stored") pushText(`[Image content: ${mimeType}]`)
        stop = outcome === "stop"
      }
    } else if (contentItem.type === "resource" && isRecord(contentItem.resource)) {
      const resource = contentItem.resource as McpToolContentItem["resource"] & Record<string, unknown>
      // A resource with neither text nor blob keeps nothing by construction;
      // routing it through idle would let 1024 uri-only resources silently
      // drop a trailing real summary while the budget is still open.
      if (
        !(typeof resource.text === "string" && resource.text) &&
        !(typeof resource.blob === "string" && resource.blob)
      ) {
        if (skipItem()) break
        continue
      }
      if (typeof resource.text === "string" && resource.text) pushText(resource.text)
      const uri = typeof resource.uri === "string" ? resource.uri.slice(0, MAX_MCP_FILENAME) : undefined
      if (typeof resource.blob === "string" && resource.blob) {
        // MIME types are case-insensitive; normalize before the image gate so
        // IMAGE/PNG cannot slip past the allowlist the image branch enforces.
        // Non-image MIME passes through deliberately: tool-output media with
        // an unknown type is dropped with a warning (Anthropic) or flattened
        // to inert JSON text (OpenAI-compatible), so it cannot poison later
        // requests — while image-data carries media_type straight to the API
        // and stays allowlisted above.
        const mimeType = validMcpMimeType(resource.mimeType, "application/octet-stream").toLowerCase()
        const imageKind = mimeType.startsWith("image/") ? MCP_IMAGE_TYPES[mimeType] : undefined
        if (mimeType.startsWith("image/") && !imageKind) {
          pushText(`[MCP attachment dropped: unsupported image mime type ${mimeType}]`)
        } else {
          const outcome = pushAttachment(mimeType, resource.blob, uri, imageKind)
          if (outcome === "stored") pushText(`[Binary MCP resource: ${uri ?? "unknown"} (${mimeType})]`)
          stop = outcome === "stop"
        }
      }
    } else {
      // Benign-but-unsupported content (resource_link, audio, empty text):
      // O(1) to skip with no scan cost, so it must not consume the
      // rejected-idle budget — otherwise a long benign list drops a
      // trailing real summary and misreports a rejection flood.
      if (skipItem()) break
      continue
    }
    if (stop) break
    if (textParts.length === keptTexts && attachments.length === keptAttachments) {
      // Every branch that reaches here pushed a marker, label, or payload
      // (content-less inputs skip earlier via skipItem), so keeping nothing
      // means the text budget is already capped: a marker push would be a
      // no-op. Break silently instead; the truncation notice already
      // explains the cut, and a rejection-flood marker here would mislead.
      idleItems++
      if (idleItems >= MAX_MCP_IDLE_ITEMS) break
    } else {
      idleItems = 0
    }
  }

  return { textParts, attachments }
}

const MCP_TEXT_TRUNCATED = `[Untrusted MCP content truncated at ${MAX_MCP_TEXT_BYTES} bytes]`
const MCP_TEXT_TRUNCATED_NOTICE = `\n\n${MCP_TEXT_TRUNCATED}`
const MCP_TEXT_TRUNCATED_NOTICE_BYTES = Buffer.byteLength(MCP_TEXT_TRUNCATED_NOTICE, "utf8")

/**
 * Hard cap for untrusted MCP text before the truncation preview. The full
 * text is also written to disk for later inspection, so an unbounded result
 * would exhaust the truncation directory regardless of the preview size.
 * Collection already budgets, this is the second layer for direct callers
 * (structuredContent fallback); it pre-slices so the encode buffer stays
 * bounded instead of copying a hostile multi-hundred-megabyte string. The
 * notice bytes reserve inside the cap, so output never exceeds the budget
 * and exactly one notice survives nested truncation: an inner complete
 * notice peels first (only small enough to be one), and anything shorter
 * than a full notice falls past the reserved cut on its own.
 */
export function boundMcpResultText(text: string): string {
  const total = Buffer.byteLength(text, "utf8")
  if (total <= MAX_MCP_TEXT_BYTES) return text
  const body =
    total <= MAX_MCP_TEXT_BYTES + MCP_TEXT_TRUNCATED_NOTICE_BYTES + 128 && text.endsWith(MCP_TEXT_TRUNCATED_NOTICE)
      ? text.slice(0, text.length - MCP_TEXT_TRUNCATED_NOTICE.length)
      : text
  return `${truncateUtf8Bytes(body, MAX_MCP_TEXT_BYTES - MCP_TEXT_TRUNCATED_NOTICE_BYTES)}${MCP_TEXT_TRUNCATED_NOTICE}`
}

/**
 * Server-provided result metadata, guarded: only a plain record passes
 * through, and only while small. A hostile string, array, circular, or
 * multi-megabyte metadata degrades to {} instead of exploding into the
 * persisted part metadata. The MCP transport schema already strips unknown
 * result keys; this is the second layer for direct and mocked dispatches.
 */
export function mcpResultMetadata(result: unknown): Record<string, unknown> {
  try {
    if (!isRecord(result) || !isRecord(result.metadata)) return {}
    // One budgeted serialization gates the copy: oversized, circular, or
    // bigint-bearing metadata degrades to {} before any full-size string or
    // key array exists. toJSON never runs, so caller code cannot smuggle
    // output past the estimate, and exotic objects serialize deterministically.
    const preview = boundedJsonStringify(result.metadata, MAX_MCP_SERVER_METADATA_BYTES)
    if (!preview || preview.truncated) return {}
    // Return the round-tripped copy, never the caller's object: no aliasing
    // with the transport result, and the in-memory shape already equals what
    // JSON session storage will persist.
    const roundTripped = parseJsonResult(preview.text)
    if (!roundTripped.ok || !isRecord(roundTripped.value)) return {}
    return roundTripped.value
  } catch {
    // Revoked proxies and throwing getters degrade to {}, matching the
    // old JSON.stringify-in-try/catch contract for direct inputs.
    return {}
  }
}

/**
 * Part metadata for an MCP tool result. Server metadata lives under its own
 * `mcpServer` namespace so it can never smuggle trusted keys (outputPath,
 * truncated, ...) into the persisted part; trusted keys are always written
 * unconditionally, matching the registry tool path.
 */
export function mcpResultPartMetadata(
  result: unknown,
  truncated: {
    truncated: boolean
    outputPath?: string
    fullOutputPath?: string
    originalSize?: number
    truncatedTo?: number
    contentHint?: string
  },
): Record<string, unknown> {
  const server = mcpResultMetadata(result)
  return {
    ...(Object.keys(server).length > 0 ? { mcpServer: server } : {}),
    truncated: truncated.truncated,
    outputPath: truncated.truncated ? truncated.outputPath : undefined,
    fullOutputPath: truncated.truncated ? truncated.fullOutputPath : undefined,
    originalSize: truncated.truncated ? truncated.originalSize : undefined,
    truncatedTo: truncated.truncated ? truncated.truncatedTo : undefined,
    contentHint: truncated.truncated ? truncated.contentHint : undefined,
  }
}

const JSON_ESCAPES: Record<number, string> = {
  8: "\\b",
  9: "\\t",
  10: "\\n",
  12: "\\f",
  13: "\\r",
  34: '\\"',
  92: "\\\\",
}

// Every object key visited (own, inherited, or skipped) counts toward this
// cap; past it the value aborts as truncated. Emitted keys would trip the
// byte budget first in any realistic shape (each costs several bytes), so
// the cap only bites floods of skipped or inherited keys. Array indices
// need no cap: every index emits at least one byte.
const MAX_MCP_JSON_KEYS = 1_000_000

export type BoundedJsonResult = { text: string; truncated: boolean }

/**
 * Compact JSON writer with a byte budget. Emits JSON.stringify-compatible
 * output for plain data while aborting past the budget, so a hostile
 * multi-hundred-megabyte structuredContent value never materializes as a
 * full string. Iterative (no call-stack depth risk), holds no retained key
 * or index array (array frames keep length plus position; object keys stream
 * through one generator), never invokes toJSON, and returns undefined for
 * circular, bigint-bearing, or getter/proxy-throwing values exactly like the
 * JSON.stringify path it replaces. Residual: V8 materializes one transient
 * key list when a hostile object's enumeration starts (verified: same cost
 * as Object.keys, freed after); the transport's own JSON parse already paid
 * that class of cost for network input, and direct callers are in-process.
 */
export function boundedJsonStringify(value: unknown, maxBytes: number): BoundedJsonResult | undefined {
  type Frame =
    | { kind: "array"; container: unknown[]; index: number }
    | { kind: "object"; container: Record<string, unknown>; enumerator: Generator<string>; emitted: number }
  const parts: string[] = []
  let bytes = 0
  let aborted = false
  let enumerated = 0
  const active = new Set<unknown>()
  // Streams every for-in key (own and inherited) without retaining them; the
  // walk filters by hasOwn and counts every visit toward the key cap.
  function* allKeys(node: Record<string, unknown>): Generator<string> {
    for (const key in node) yield key
  }
  const abort = (): false => {
    aborted = true
    return false
  }
  // Appends `text` while the budget holds; returns false once it ends.
  const emit = (text: string): boolean => {
    if (aborted) return false
    const size = Buffer.byteLength(text, "utf8")
    if (bytes + size > maxBytes) return abort()
    parts.push(text)
    bytes += size
    return true
  }
  const emitString = (text: string): boolean => {
    // Escape in small chunks: one giant control-char string must not expand
    // to a 6x copy before the budget check sees it.
    if (!emit('"')) return false
    for (let offset = 0; offset < text.length; ) {
      // Keep surrogate pairs inside one chunk: split halves byte-count as 3
      // bytes each while the joined pair costs 4, which would overcharge the
      // budget by 2 bytes per split pair.
      let end = Math.min(offset + 1024, text.length)
      if (
        end < text.length &&
        text.charCodeAt(end - 1) >= 0xd800 &&
        text.charCodeAt(end - 1) <= 0xdbff &&
        text.charCodeAt(end) >= 0xdc00 &&
        text.charCodeAt(end) <= 0xdfff
      ) {
        end++
      }
      const chunk = text.slice(offset, end)
      const start = offset
      offset = end
      let escaped = ""
      for (let index = 0; index < chunk.length; index++) {
        const code = chunk.charCodeAt(index)
        const named = JSON_ESCAPES[code]
        if (named !== undefined) escaped += named
        else if (code < 0x20) escaped += `\\u${code.toString(16).padStart(4, "0")}`
        else if (code >= 0xd800 && code <= 0xdfff) {
          // Paired surrogates pass through raw; unpaired ones escape, exactly
          // like JSON.stringify. Lookahead/behind run on the full text so a
          // pair split across chunks still matches.
          const position = start + index
          const paired =
            code <= 0xdbff
              ? text.charCodeAt(position + 1) >= 0xdc00 && text.charCodeAt(position + 1) <= 0xdfff
              : position > 0 && text.charCodeAt(position - 1) >= 0xd800 && text.charCodeAt(position - 1) <= 0xdbff
          escaped += paired ? chunk[index] : `\\u${code.toString(16).padStart(4, "0")}`
        } else escaped += chunk[index]
      }
      if (!emit(escaped)) {
        // Best effort: close the string even past the budget (one byte over).
        // Truncated output is display text; the caller appends its own
        // truncation notice and re-caps the total.
        parts.push('"')
        bytes += 1
        return false
      }
    }
    return emit('"')
  }
  const emitScalar = (node: unknown): boolean | undefined => {
    if (node === null) return emit("null")
    switch (typeof node) {
      case "string":
        return emitString(node)
      case "number":
        return emit(Number.isFinite(node) ? String(node) : "null")
      case "boolean":
        return emit(node ? "true" : "false")
      case "bigint":
        return undefined
      default:
        return true
    }
  }
  const stack: Frame[] = []
  // Pushes a value: true keeps walking, false aborts on budget, undefined
  // rejects the whole value (circular reference or bigint, like stringify).
  const pushValue = (node: unknown): boolean | undefined => {
    if (node === null || typeof node !== "object") return emitScalar(node)
    if (node instanceof Date) return Number.isNaN(node.getTime()) ? emit("null") : emitString(node.toISOString())
    if (active.has(node)) return undefined
    // A depth overrun aborts as truncated instead of emitting a
    // placeholder: callers treat truncated:false as a complete copy, so a
    // silent substitution would persist mutated data as intact metadata and
    // hide a lost structuredContent subtree from the truncation notice.
    if (active.size >= MAX_MCP_JSON_DEPTH) return abort()
    active.add(node)
    if (Array.isArray(node)) {
      stack.push({ kind: "array", container: node, index: 0 })
      return emit("[")
    }
    stack.push({
      kind: "object",
      container: node as Record<string, unknown>,
      enumerator: allKeys(node as Record<string, unknown>),
      emitted: 0,
    })
    return emit("{")
  }
  // Emits one child value; shares pushValue's true/false/undefined contract.
  const pushChild = (child: unknown, inArray: boolean): boolean | undefined => {
    if (child === null || typeof child !== "object") {
      if (child === undefined || typeof child === "function" || typeof child === "symbol") {
        return inArray ? emit("null") : true
      }
      return emitScalar(child)
    }
    return pushValue(child)
  }
  // Throwing getters and revoked proxies degrade to undefined, matching the
  // old JSON.stringify-in-try/catch contract for direct and mocked inputs.
  try {
    const seed = pushValue(value)
    if (seed === undefined) return undefined
    if (seed === false) return { text: parts.join(""), truncated: true }
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      if (!frame) break
      if (frame.kind === "array") {
        if (frame.index >= frame.container.length) {
          stack.pop()
          active.delete(frame.container)
          if (!emit("]")) break
          continue
        }
        if (frame.index > 0 && !emit(",")) break
        const child = frame.container[frame.index]
        frame.index++
        const done = pushChild(child, true)
        if (done === undefined) return undefined
        if (!done) break
        continue
      }
      const next = frame.enumerator.next()
      if (next.done) {
        stack.pop()
        active.delete(frame.container)
        if (!emit("}")) break
        continue
      }
      enumerated++
      if (enumerated > MAX_MCP_JSON_KEYS) {
        abort()
        break
      }
      if (!Object.hasOwn(frame.container, next.value)) continue
      const child = frame.container[next.value]
      if (child === undefined || typeof child === "function" || typeof child === "symbol") continue
      if (frame.emitted > 0 && !emit(",")) break
      frame.emitted++
      if (!emitString(next.value) || !emit(":")) break
      const done = pushChild(child, false)
      if (done === undefined) return undefined
      if (!done) break
    }
  } catch {
    return undefined
  }
  // No closers or notice here: truncated output stays a raw budgeted prefix
  // (at most one byte over for a mid-string cut), and the caller reports the
  // cut exactly once through its own notice and truncated flag.
  const text = parts.join("")
  if (text === "" && !aborted) return undefined
  return { text, truncated: aborted }
}

function formatMcpStructuredContent(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === "string") {
    // Bound before trimming: trim copies the kept range, so trimming a
    // hostile half-gigabyte body first would materialize it before the cap.
    // Small strings keep exact trim-then-use semantics.
    if (Buffer.byteLength(value, "utf8") <= MAX_MCP_TEXT_BYTES) {
      const trimmed = value.trim()
      return trimmed ? trimmed : undefined
    }
    return boundMcpResultText(value).trim()
  }
  const json = boundedJsonStringify(value, MAX_MCP_TEXT_BYTES)
  if (!json || json.text === "{}" || json.text === "[]") return undefined
  // The serializer reports the cut through its flag; note it here so the
  // fallback text carries the same signal as truncated text parts. The
  // caller's bound re-caps the total and keeps a single visible notice.
  if (!json.truncated) return json.text
  return `${json.text}${MCP_TEXT_TRUNCATED_NOTICE}`
}

function mcpContentUsable(collected: { textParts: string[]; attachments: unknown[] }): boolean {
  return collected.textParts.some((part) => part.trim().length > 0) || collected.attachments.length > 0
}

/** Prefer MCP `content`. Use `structuredContent` only when content is empty — never both. */
export function collectMcpToolResult(result: unknown) {
  const record = isRecord(result) ? result : {}
  const content = Array.isArray(record.content) ? (record.content as McpToolContentItem[]) : []
  const collected = collectMcpToolContent(content)
  if (mcpContentUsable(collected)) return collected
  const structured = formatMcpStructuredContent(record.structuredContent)
  return {
    textParts: structured ? [boundMcpResultText(structured)] : [],
    attachments: collected.attachments,
  }
}

export async function estimateRegistryToolSchemaTokens(input: {
  agent: Agent.Info
  model: Provider.Model
  tools?: Record<string, boolean>
  sessionPermission?: Permission.Ruleset
  /**
   * When true, the upcoming provider request will not send tool schemas
   * (forced text-only / response-only synthesis). An empty `tools: {}` map is
   * NOT enough — that means "no per-tool overrides" and still enables the full
   * registry for estimation.
   */
  omitToolSchemas?: boolean
}) {
  if (input.omitToolSchemas) return 0
  const ruleset = Permission.merge(
    input.agent.permission,
    input.sessionPermission ?? [],
    permissionRulesetFromLegacyTools(input.tools),
  )
  const registryTools = await ToolRegistry.tools(
    { modelID: ModelID.make(input.model.api.id), providerID: input.model.providerID },
    input.agent,
  )
  const disabledRegistryTools = Permission.disabled(
    registryTools.map((item) => item.id),
    ruleset,
  )
  return estimateToolDefinitionTokens(
    registryTools
      .filter((item) => input.tools?.[item.id] !== false && !disabledRegistryTools.has(item.id))
      .map((item) => ({
        id: item.id,
        description: item.description,
        inputSchema: ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters)),
      })),
  )
}

/**
 * Resolve and configure all available tools for a session turn.
 * Handles schema transformation, caching, isolation escalation, and MCP tools.
 */
export async function resolveTools(input: ResolveToolsInput) {
  using _ = log.time("resolveTools")
  const boundGoal = input.goalBinding ? { ...input.goalBinding } : undefined
  const tools: Record<string, AITool> = {}
  const isolation =
    input.isolation ?? Isolation.resolve((await Config.get()).isolation, Instance.directory, Instance.worktree)
  const ruleset = Permission.merge(
    input.agent.permission,
    input.session.permission ?? [],
    permissionRulesetFromLegacyTools(input.tools),
  )
  // Share transformed schemas across tool resolution calls.
  const cache = schemaCache()
  const modelSchemaIdentity = schemaFingerprint({
    id: input.model.id,
    providerID: input.model.providerID,
    apiID: input.model.api.id,
    npm: input.model.api.npm,
    url: input.model.api.url,
  })
  const schemaCacheKey = (toolId: string) => `${toolId}:${modelSchemaIdentity}`
  const isDisabledByConfig = (toolID: string) => input.tools?.[toolID] === false
  let registryDispatcher: Tool.Dispatcher | undefined

  type InvocationOptions = Pick<ToolCallOptions, "toolCallId" | "abortSignal">
  const context = (
    args: any,
    options: InvocationOptions,
    isolationOverride?: Isolation.State,
    exposeDispatcher = false,
  ): Tool.Context => ({
    sessionID: input.session.id,
    goalBinding: boundGoal,
    onGoalCreated: input.goalBinding
      ? (created) => {
          input.goalBinding!.created = created
        }
      : undefined,
    // The AI SDK normally passes an AbortSignal, but `abortSignal` is
    // typed as optional. Fall back to a fresh never-firing controller
    // signal so tools that read `context.abort.aborted` /
    // `addEventListener("abort", ...)` don't crash with
    // "cannot read properties of undefined" if the SDK ever omits it.
    abort: options.abortSignal ?? new AbortController().signal,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    extra: {
      model: input.model,
      bypassAgentCheck: input.bypassAgentCheck,
      isolation: isolationOverride ?? isolation,
      ...(exposeDispatcher ? { toolDispatcher: registryDispatcher } : {}),
    },
    agent: input.agent.name,
    messages: input.messages,
    metadata: async (val: { title?: string; metadata?: any }) => {
      const match = input.processor.partFromToolCall(options.toolCallId)
      if (match && match.state.status === "running") {
        await Session.updatePart({
          ...match,
          state: {
            title: val.title,
            metadata: val.metadata,
            status: "running",
            // Progress updates retain the processor's canonical, redacted
            // input; execution args may still contain credentials.
            input: match.state.input,
            time: {
              start: match.state.time?.start ?? Date.now(),
            },
          },
        })
      }
    },
    async ask(req) {
      await Permission.ask(
        {
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset,
          agent: input.agent.name,
        },
        { signal: options.abortSignal ?? undefined },
      )
    },
  })

  const registryTools = await ToolRegistry.tools(
    { modelID: ModelID.make(input.model.api.id), providerID: input.model.providerID },
    input.agent,
  )
  const disabledRegistryTools = Permission.disabled(
    registryTools.map((item) => item.id),
    ruleset,
  )
  const isolationDisabled = new Set<string>()
  if (isolation.mode === "read-only") {
    for (const id of ["edit", "write", "apply_patch", "multiedit", "bash"]) isolationDisabled.add(id)
  }
  if (!isolation.network) {
    for (const id of ["webfetch", "websearch", "codesearch"]) isolationDisabled.add(id)
  }
  const enabledRegistryTools = registryTools.filter(
    (item) => !isDisabledByConfig(item.id) && !disabledRegistryTools.has(item.id) && !isolationDisabled.has(item.id),
  )
  const batchableRegistryTools = new Map(
    enabledRegistryTools
      .filter((item) => item.id !== "batch" && item.id !== "task" && item.id !== "read_recipe")
      .map((item) => [item.id, item]),
  )

  async function invokeRegistryTool(inputTool: {
    item: (typeof registryTools)[number]
    args: any
    options: InvocationOptions
    isolationPolicy: "escalate" | "fail-closed"
  }): Promise<Tool.InvocationResult> {
    const { item, args, options, isolationPolicy } = inputTool
    const exposeDispatcher = (item.id === "batch" || item.id === "read_recipe") && isolationPolicy === "escalate"
    const ctx = context(args, options, undefined, exposeDispatcher)

    // Direct model calls in one step run concurrently in the AI SDK; the
    // write gate serializes mutating tools against everything else. Batch
    // workers (fail-closed policy) already run under Batch's own barrier and
    // inside the batch call's lane, so they must not re-enter the gate.
    const releaseLane =
      isolationPolicy === "escalate"
        ? await ToolWriteGate.acquire(
            ctx.sessionID,
            toolGateMode({
              toolID: item.id,
              args,
              childSafe: (call) => registryDispatcher?.concurrencySafe?.(call) === true,
            }),
            ctx.abort,
          )
        : undefined
    try {
      return await invokeRegistryToolLifecycle(inputTool, ctx)
    } finally {
      releaseLane?.()
    }
  }

  async function invokeRegistryToolLifecycle(
    inputTool: {
      item: (typeof registryTools)[number]
      args: any
      options: InvocationOptions
      isolationPolicy: "escalate" | "fail-closed"
    },
    ctx: Tool.Context,
  ): Promise<Tool.InvocationResult> {
    const { item, args, options, isolationPolicy } = inputTool
    const exposeDispatcher = (item.id === "batch" || item.id === "read_recipe") && isolationPolicy === "escalate"
    let hookFeedback: string | undefined
    const lifecycle = await runToolLifecycle({
      toolID: item.id,
      sessionID: ctx.sessionID,
      callID: ctx.callID,
      args,
      cwd: Instance.directory,
      // Batch workers run fail-closed: no interactive prompts from nested
      // workers, so a hook `ask` there degrades to a block like isolation.
      ask: isolationPolicy === "escalate" ? (req) => ctx.ask(req) : undefined,
      onFeedback: (feedback) => {
        hookFeedback = feedback
      },
      execute: async () => {
        let result: Awaited<ReturnType<typeof item.execute>> | undefined
        if (isolationPolicy === "fail-closed") {
          // Batch calls run concurrently. Never open interactive escalation
          // prompts from nested workers; an isolation denial is the result.
          result = await item.execute(args, ctx)
        } else {
          // Per-path bypass: when the user approves an isolation_escalation
          // for one path inside a multi-path tool call (e.g. apply_patch with
          // several hunks), exempt only that path and retry. Network denials
          // similarly enable only network access. Bound retries in case a tool
          // is non-deterministic about the first denied operation it touches.
          const bypass: string[] = []
          let networkBypass = false
          let lastError: Isolation.DeniedError | undefined
          for (let attempt = 0; attempt < 16; attempt++) {
            let attemptCtx = ctx
            if (attempt > 0 && ctx.extra?.isolation) {
              attemptCtx = context(
                args,
                options,
                isolationRetryState({
                  isolation: ctx.extra.isolation,
                  pathBypass: bypass,
                  networkBypass,
                }),
                exposeDispatcher,
              )
            }
            try {
              result = await item.execute(args, attemptCtx)
              break
            } catch (error) {
              if (!(error instanceof Isolation.DeniedError)) throw error
              if (ctx.extra?.isolation?.mode === "read-only") {
                throw new Error(`Tool denied in read-only mode: ${error.reason}`, { cause: error })
              }
              if (!error.path) {
                if (error.reason !== "network") throw error
                if (networkBypass) {
                  throw error
                }
                await ctx.ask({
                  permission: "isolation_escalation",
                  patterns: [error.message],
                  always: [],
                  metadata: { reason: error.reason, requireInteractive: true },
                })
                networkBypass = true
                lastError = error
                continue
              }
              if (bypass.includes(error.path)) {
                throw error
              }
              await ctx.ask({
                permission: "isolation_escalation",
                patterns: [error.message],
                always: [],
                metadata: { reason: error.reason, path: error.path, requireInteractive: true },
              })
              bypass.push(error.path)
              lastError = error
            }
          }
          if (result === undefined) throw lastError ?? new Error("Tool execution exhausted isolation retries")
        }

        return {
          ...result,
          attachments: result.attachments?.map((attachment) => ({
            ...attachment,
            id: PartID.ascending(),
            sessionID: ctx.sessionID,
            messageID: input.processor.message.id,
          })),
        }
      },
    })
    if (hookFeedback === undefined) return lifecycle
    return { ...lifecycle, output: `${lifecycle.output}${formatHookFeedback(hookFeedback)}` }
  }

  registryDispatcher = {
    ids: [...batchableRegistryTools.keys()],
    concurrencySafe(dispatch) {
      const item = batchableRegistryTools.get(dispatch.tool)
      if (!item?.concurrencySafe) return false
      try {
        return item.concurrencySafe(dispatch.parameters) === true
      } catch {
        // Fail closed: a throwing classifier means the call is a barrier.
        return false
      }
    },
    async execute(dispatch) {
      const item = batchableRegistryTools.get(dispatch.tool)
      if (!item) throw new Error(`Tool '${dispatch.tool}' is not enabled for Batch execution`)
      let args: unknown
      try {
        args = item.parameters.parse(dispatch.parameters)
      } catch (error) {
        if (error instanceof z.ZodError && item.formatValidationError) {
          throw new Error(item.formatValidationError(error), { cause: error })
        }
        throw error
      }
      return invokeRegistryTool({
        item,
        args,
        options: { toolCallId: dispatch.callID, abortSignal: dispatch.abort },
        isolationPolicy: "fail-closed",
      })
    },
  }

  for (const item of enabledRegistryTools) {
    const schemaJson = z.toJSONSchema(item.parameters)
    const cacheKey = schemaCacheKey(`${item.id}:${schemaFingerprint(schemaJson)}`)
    const cached = cache.get(cacheKey)
    const schema =
      cached !== undefined
        ? // LRU: move to end so recently-used entries survive eviction
          (touchSchemaCache(cache, cacheKey, cached), cached)
        : (() => {
            const s = ProviderTransform.schema(input.model, schemaJson)
            // Bound the cache to avoid a slow memory leak in long-running
            // processes (TUI/daemon) that accumulate tool×model entries
            // across session lifetimes. LRU eviction: when we reach the
            // cap, drop the 100 least-recently-used entries. Maps preserve
            // insertion order, so `.keys()` iterates oldest first.
            setSchemaCache(cache, cacheKey, s)
            return s
          })()
    tools[item.id] = tool({
      id: item.id as any,
      description: item.description,
      inputSchema: jsonSchema(schema as any),
      async execute(args, options) {
        return invokeRegistryTool({ item, args, options, isolationPolicy: "escalate" })
      },
    })
  }

  // Private invocation identity: nested workflow calls retain this session's
  // permission/lifecycle wrappers while reusing the workflow's exclusive lane.
  const browserCalls = new WeakMap<object, { result?: unknown }>()
  const mcpTools = await MCP.tools()
  const discoveryCatalog: ToolDiscovery.Entry[] = []
  const disabledMcpTools = Permission.disabled(Object.keys(mcpTools), ruleset)
  for (const [key, item] of Object.entries(mcpTools)) {
    if (isDisabledByConfig(key) || disabledMcpTools.has(key)) continue

    const execute = item.execute
    if (!execute) continue

    // `MCP.tools()` returns references to cached tool objects; mutating
    // `item.inputSchema` directly would re-transform the schema on every
    // loop iteration, double-wrapping the JSON schema and eventually
    // producing malformed input for the LLM. Clone to a fresh object so
    // the transformation is idempotent across iterations.
    const mcpTool = { ...item }
    const mcpCacheKey = schemaCacheKey(`mcp:${key}`)
    const transformed = await transformMcpInputSchema({
      cacheKey: mcpCacheKey,
      model: input.model,
      inputSchema: mcpTool.inputSchema,
    })
    mcpTool.inputSchema = jsonSchema(transformed)
    discoveryCatalog.push({ name: key, description: mcpTool.description ?? "", schema: transformed })
    // Wrap execute to add plugin hooks and format output
    mcpTool.execute = async (args, opts) => {
      const ctx = context(args, opts)
      let hookFeedback: string | undefined
      // @scan-suppress race_scan - This invocation-local token is installed synchronously by the workflow while it holds the exclusive session lane; only that nested call can reuse the lane.
      const nestedBrowser = browserCalls.get(opts)
      const releaseLane = nestedBrowser ? () => {} : await ToolWriteGate.acquire(ctx.sessionID, "exclusive", ctx.abort)
      using _lane = defer(releaseLane)
      const result = await runToolLifecycle({
        toolID: key,
        sessionID: ctx.sessionID,
        callID: opts.toolCallId,
        args,
        cwd: Instance.directory,
        ask: (req) => ctx.ask(req),
        onFeedback: (feedback) => {
          hookFeedback = feedback
        },
        execute: async () => {
          const policy = item.webmcp
          // ADR-168: a navigation to a well-formed but unallowlisted origin is
          // caught here (call time) or after dispatch (a redirect target the
          // bridge blocked). Both paths offer the same session-only grant; the
          // tool objects of this step hold the pre-relaunch client, so the
          // model retries on the next step.
          const grantOrigin = async (grantPolicy: WebMcpProfile.Policy, error: unknown): Promise<never> => {
            if (!(error instanceof WebMcpProfile.OriginNotGrantedError)) throw error
            // A managed or schema refusal fails here without a prompt.
            const allowed = await MCP.checkWebMcpOriginGrant(grantPolicy.server, error.origin)
            if (!allowed.ok) throw new Error(allowed.error)
            // ADR-168 amendment: offer the apex/www twin in the same prompt so a
            // site that redirects between them needs one restart, not two. The
            // twin must pass the same ceiling and cap, or the prompt stays single.
            const twin = WebMcpProfile.counterpartOrigin(error.origin)
            const alsoOrigin =
              twin && !grantPolicy.profile.allowedOrigins.includes(twin)
                ? (await MCP.checkWebMcpOriginGrants(grantPolicy.server, [error.origin, twin])).ok
                  ? twin
                  : undefined
                : undefined
            await ctx.ask({
              permission: "webmcp",
              patterns: [key],
              always: [],
              metadata: {
                originGrant: true,
                server: grantPolicy.server,
                origin: error.origin,
                ...(alsoOrigin ? { alsoOrigin } : {}),
                allowedOrigins: [...grantPolicy.profile.allowedOrigins],
                experimental: true,
              },
            })
            const granted = await MCP.grantWebMcpOrigin(grantPolicy.server, error.origin, alsoOrigin)
            if (!granted.ok) throw new Error(granted.error)
            throw new Error(
              `WebMCP origin ${alsoOrigin ? `${error.origin} and ${alsoOrigin}` : error.origin} was allowed for this session and the browser bridge was restarted; open pages were closed. Retry the call.`,
            )
          }
          // The read grant refusal precedes content dispatch. T1 can continue
          // once after approval with fresh origin/policy checks (ADR-176).
          const grantRead = async (readPolicy: WebMcpProfile.Policy, error: unknown): Promise<void> => {
            if (!(error instanceof WebMcpProfile.ReadNotGrantedError)) throw error
            // A managed or disabled refusal fails here without a prompt.
            const allowed = await MCP.checkWebMcpReadGrant(readPolicy.server, error.origin)
            if (!allowed.ok) throw new Error(allowed.error)
            const metadata = { readGrant: true, server: readPolicy.server, origin: error.origin, experimental: true }
            const candidate = await WebMcpApprovals.capture(readPolicy, { capability: "read", origin: error.origin })
            WebMcpApprovals.bind(metadata, candidate, {
              permission: key,
              patterns: McpPermissionPattern.derive(key, { origin: error.origin }).patterns,
            })
            await ctx.ask({ permission: "webmcp", patterns: [key], always: [], metadata })
            ctx.abort.throwIfAborted()
            await checkWebMcpDenials()
            // Saved read authority stays separate from session grants so revoke
            // takes effect without reconnecting the browser.
            // Preserve the user's reply type even if another client revokes
            // the record immediately: never turn a revoked save into a new
            // temporary grant.
            const saved = WebMcpApprovals.usedSavedApproval(metadata)
            if (!saved) {
              const granted = await MCP.grantWebMcpReadOrigin(
                readPolicy.server,
                error.origin,
                readPolicy.profile,
                ctx.abort,
              )
              if (!granted.ok) throw new Error(granted.error)
            }
            if (!WebMcpProfile.READ_SCOPE_TOOLS.some((name) => name === readPolicy.toolName)) {
              // wait_for belongs to T2 and retains its explicit retry and
              // per-turn reservation semantics.
              throw new Error(
                `WebMCP read access to ${error.origin} ${saved ? "was saved for this project" : "was allowed for this session"}. Retry the call.`,
              )
            }
            WebMcpApprovals.bindReadContinuation(call as object, error.origin, async () => {
              ctx.abort.throwIfAborted()
              if (!(await MCP.matchesWebMcpProfile(readPolicy.server, readPolicy.profile))) {
                throw new Error("WebMCP bridge changed while read approval was pending; request a fresh read")
              }
              if (candidate && !(await WebMcpApprovals.valid(candidate))) {
                throw new Error("WebMCP read approval is no longer valid; request a fresh read")
              }
              if (saved && (!candidate || !(await WebMcpApprovals.allowed(candidate)))) {
                throw new Error("Saved WebMCP read approval was revoked; request a fresh read")
              }
            })
          }
          // ADR-174: a T2 call against an origin with no session interact
          // grant, or whose budget is spent, throws before the bridge acts.
          // The prompt names the origin and what the grant covers; approval
          // records (or renews) the grant in memory, and the retry is
          // immediate — never a relaunch.
          const grantInteract = async (
            interactPolicy: WebMcpProfile.Policy,
            error: unknown,
            breaker: WebMcpProfile.InteractBreaker | undefined,
          ): Promise<never> => {
            if (!(error instanceof WebMcpProfile.InteractNotGrantedError)) throw error
            const allowed = await MCP.checkWebMcpInteractGrant(interactPolicy.server, error.origin)
            if (!allowed.ok) throw new Error(allowed.error)
            try {
              await ctx.ask({
                permission: "webmcp",
                patterns: [key],
                always: [],
                metadata: {
                  interactGrant: true,
                  renewal: error.renewal,
                  budget: WebMcpProfile.INTERACT_BUDGET,
                  server: interactPolicy.server,
                  origin: error.origin,
                  experimental: true,
                },
              })
            } catch (refusal) {
              if (
                breaker &&
                (refusal instanceof Permission.RejectedError || refusal instanceof Permission.CorrectedError)
              ) {
                breaker.refused(`interaction grant for ${error.origin}`)
              }
              throw refusal
            }
            breaker?.approved()
            const granted = await MCP.grantWebMcpInteractOrigin(interactPolicy.server, error.origin)
            if (!granted.ok) throw new Error(granted.error)
            throw new WebMcpProfile.GrantRetryError(
              `WebMCP interaction with ${error.origin} was ${error.renewal ? "renewed" : "allowed"} for this session (${WebMcpProfile.INTERACT_BUDGET} grant-covered actions). Retry the call.`,
            )
          }
          let call: Record<string, unknown> | unknown = args
          if (policy) {
            try {
              call = WebMcpProfile.validateCall(policy.profile, policy.toolName, args)
            } catch (error) {
              await grantOrigin(policy, error)
            }
          }
          // Capture the approval-time origin/descriptor binding before the
          // approval is requested, so the dispatch-time preflight verifies
          // the fresh listing against what the approver saw even if another
          // session rewrites the shared baseline while approval is pending.
          // Without a listing the approval is still requested (its dialog
          // warns that nothing was listed), but the call is marked so
          // dispatch cannot fall back to a baseline another session writes
          // while approval is pending.
          if (policy?.toolName === "execute_webmcp_tool") {
            const pageId = (call as { pageId?: unknown }).pageId
            const toolName = (call as { toolName?: unknown }).toolName
            const snapshot =
              typeof pageId === "number" && typeof toolName === "string"
                ? WebMcpProfile.captureApproval(policy.profile, pageId, toolName)
                : undefined
            if (snapshot) WebMcpProfile.bindApproval(call as Record<string, unknown>, snapshot)
            else WebMcpProfile.denyApproval(call as Record<string, unknown>)
          }
          const webmcp = policy
            ? WebMcpProfile.approvalMetadata(
                policy.server,
                policy.profile,
                policy.toolName,
                call as Record<string, unknown>,
                // Page annotations describe a named page tool, so only an
                // execute call carries them; bridge operations must not
                // inherit hints from a same-named page tool.
                policy.toolName === "execute_webmcp_tool"
                  ? WebMcpProfile.annotationsFor(
                      policy.profile,
                      (call as { pageId?: number }).pageId ?? -1,
                      (call as { toolName?: string }).toolName ?? policy.toolName,
                    )
                  : undefined,
              )
            : undefined
          // ADR-171/172: read-scope calls are approved by the per-origin
          // session read grant (the dispatch raises ReadNotGrantedError for a
          // missing grant and the prompt happens then), so they skip the
          // per-call asks.
          const readTierTool =
            policy !== undefined && WebMcpProfile.READ_SCOPE_TOOLS.some((name) => name === policy.toolName)
          // ADR-174: hover, wait_for and ordinary clicks run under the
          // per-origin interact grant (the dispatch raises
          // InteractNotGrantedError and the prompt happens then); fills, key
          // presses, dialogs and escalated clicks keep the per-call asks with
          // the target and full value in the metadata.
          const interactTool = policy !== undefined && WebMcpProfile.isInteractTool(policy.toolName)
          const breaker = interactTool ? webmcpTurnBreaker(input.processor) : undefined
          if (breaker?.tripped) throw new Error(breaker.tripped)
          // A wait reservation is refunded when the call stops at a grant
          // prompt before any waiting happened.
          let reservedWait = 0
          if (interactTool && policy && webmcp) {
            // A target nobody listed can never be approved meaningfully and
            // would fail closed at dispatch anyway; fail it here without
            // spending the user's attention on a doomed prompt.
            const target = isRecord(webmcp.target) ? webmcp.target : undefined
            const targets = Array.isArray(webmcp.targets) ? webmcp.targets : []
            if (target?.unlisted === true || targets.some((entry) => isRecord(entry) && entry.unlisted === true)) {
              breaker?.failed(webmcpTargetSummary(webmcp))
              throw new WebMcpProfile.TargetBindingError(
                policy.toolName === "press_key"
                  ? "WebMCP press_key needs a focused control in the latest snapshot of this page; take a new snapshot or click the control first"
                  : "WebMCP target is not in the latest snapshot of this page; take a new snapshot before acting",
              )
            }
            if (policy.toolName === "wait_for") {
              const requested = (call as { timeout?: unknown }).timeout
              const waitMs = typeof requested === "number" ? requested : WebMcpProfile.MAX_WAIT_TIMEOUT_MS
              if (breaker && !breaker.reserveWait(waitMs)) {
                throw new Error(
                  `WebMCP wait_for budget for this turn (${WebMcpProfile.MAX_WAIT_PER_TURN_MS / 1000} s cumulative) is exhausted; do not retry automatically`,
                )
              }
              reservedWait = waitMs
            }
          }
          const grantCovered =
            interactTool &&
            policy !== undefined &&
            !WebMcpProfile.perActionCall(policy.profile, policy.toolName, call as Record<string, unknown>)
          if (interactTool && policy) {
            // Bind the ask-time decision to the call so dispatch spends the
            // budget on exactly this decision, whatever the snapshot map
            // looks like after the bridge round-trips.
            WebMcpProfile.bindInteractDecision(call as object, !grantCovered)
            // A per-action tool on an origin with no interact grant would
            // pass both asks and then stop at the grant prompt; ask for the
            // grant first so the user confirms the action once, not twice.
            // The snapshot origin is the page origin at snapshot time; the
            // dispatch re-checks the live page.
            if (!grantCovered) {
              const pageId = (call as { pageId?: unknown }).pageId
              const origin =
                typeof pageId === "number"
                  ? WebMcpProfile.pageOriginOf(WebMcpProfile.snapshotUrlFor(policy.profile, pageId))
                  : undefined
              if (origin && !(policy.interactGrants?.() ?? new Map<string, number>()).has(origin)) {
                await grantInteract(policy, new WebMcpProfile.InteractNotGrantedError(origin), breaker)
              }
            }
          }
          const skipPerCall = readTierTool || grantCovered
          const permissionPattern = McpPermissionPattern.derive(key, webmcp ?? call, { worktree: Instance.worktree })
          const mcpMetadata = { mcp: true, ...permissionPattern.metadata }
          // Recheck both layers at admission and dispatch, including calls
          // covered by a read/session grant or a saved approval.
          const checkWebMcpDenials = async () => {
            if (!webmcp) return
            for (const request of [
              { permission: key, patterns: permissionPattern.patterns, metadata: mcpMetadata },
              { permission: "webmcp", patterns: [key], metadata: webmcp },
            ])
              await Permission.checkDenials({
                ...request,
                always: [],
                sessionID: input.session.id,
                ruleset,
                agent: input.agent.name,
              })
          }
          await checkWebMcpDenials()
          if (policy?.toolName === "close_page" && webmcp && policy.closePageOrigin) {
            ctx.abort.throwIfAborted()
            const origin = await policy.closePageOrigin((call as { pageId: number }).pageId, ctx.abort)
            if (origin) webmcp.pageOrigin = origin
            WebMcpApprovals.bindCloseTarget(call as { pageId: number }, origin)
          }
          const approvalCandidate =
            policy && webmcp ? await WebMcpApprovals.captureCall(policy, call as Record<string, unknown>) : undefined
          if (webmcp) {
            WebMcpApprovals.bind(webmcp, approvalCandidate, { permission: key, patterns: permissionPattern.patterns })
            WebMcpApprovals.bind(mcpMetadata, approvalCandidate, {
              permission: key,
              patterns: permissionPattern.patterns,
            })
          }
          try {
            if (!skipPerCall) {
              await ctx.ask({
                permission: key,
                metadata: mcpMetadata,
                patterns: permissionPattern.patterns,
                always: permissionPattern.always,
              })
            }
            if (webmcp && !skipPerCall) {
              await ctx.ask({
                permission: "webmcp",
                patterns: [key],
                always: [],
                metadata: webmcp,
              })
            }
          } catch (refusal) {
            if (
              breaker &&
              (refusal instanceof Permission.RejectedError || refusal instanceof Permission.CorrectedError)
            ) {
              breaker.refused(webmcpTargetSummary(webmcp))
            }
            throw refusal
          }
          if (webmcp) WebMcpApprovals.bindCall(call as object, webmcp, checkWebMcpDenials)
          if (breaker && !skipPerCall) breaker.approved()
          try {
            const outcome = await execute(call, opts)
            breaker?.succeeded()
            return outcome
          } catch (error) {
            // A redirect target the bridge blocked surfaces only after
            // dispatch; offer the same grant the call-time path would.
            if (policy) {
              if (
                breaker &&
                reservedWait > 0 &&
                (error instanceof WebMcpProfile.ReadNotGrantedError ||
                  error instanceof WebMcpProfile.InteractNotGrantedError)
              ) {
                breaker.refundWait(reservedWait)
              }
              if (error instanceof WebMcpProfile.ReadNotGrantedError) {
                await grantRead(policy, error)
                await checkWebMcpDenials()
                ctx.abort.throwIfAborted()
                await WebMcpApprovals.checkReadContinuation(call as object, error.origin)
                // Exactly one continuation outside this catch. Any bridge
                // failure or a second grant refusal propagates, never loops.
                return await execute(call, opts)
              } else if (error instanceof WebMcpProfile.InteractNotGrantedError)
                await grantInteract(policy, error, breaker)
              else {
                if (breaker && error instanceof WebMcpProfile.TargetBindingError) {
                  breaker.failed(webmcpTargetSummary(webmcp))
                }
                await grantOrigin(policy, error)
              }
            }
            throw error
          }
        },
      })

      if (nestedBrowser) nestedBrowser.result = result
      const { textParts, attachments } = collectMcpToolResult(result)

      const outputText = textParts.length ? `[Untrusted MCP tool content from ${key}]\n\n${textParts.join("\n\n")}` : ""
      // Each side capped separately, then joined: Truncate.output persists
      // everything it receives, so an unbounded side would bypass the text
      // budget, while a single shared cap would let hostile output squeeze
      // trusted hook feedback out entirely.
      const combined =
        hookFeedback === undefined
          ? boundMcpResultText(outputText)
          : `${boundMcpResultText(outputText)}${boundMcpHookFeedback(hookFeedback)}`
      const truncated = await Truncate.output(combined, {}, input.agent)
      const metadata = mcpResultPartMetadata(result, truncated)

      return {
        title: "",
        metadata,
        output: truncated.content,
        attachments: attachments.map((attachment) => ({
          ...attachment,
          id: PartID.ascending(),
          sessionID: ctx.sessionID,
          messageID: input.processor.message.id,
        })),
        content: [{ type: "text", text: truncated.content }] as any,
      }
    }
    tools[key] = mcpTool
  }

  if (
    Object.values(mcpTools).some((item) => item.webmcp) &&
    !isDisabledByConfig("browser_workflow") &&
    !Permission.disabled(["browser_workflow"], ruleset).has("browser_workflow")
  ) {
    if (Object.hasOwn(tools, "browser_workflow")) throw new Error("Browser workflow conflicts with an existing tool")
    const admittedBrowserTools = new Map(
      Object.entries(mcpTools)
        .filter(([key, item]) => item.webmcp && tools[key])
        .map(([key, item]) => [key, { policy: item.webmcp!, wrapped: tools[key]! }]),
    )
    tools.browser_workflow = tool({
      description: BrowserWorkflow.description,
      inputSchema: jsonSchema(ProviderTransform.schema(input.model, z.toJSONSchema(BrowserWorkflow.Parameters)) as any),
      async execute(raw, options) {
        const args = BrowserWorkflow.Parameters.parse(raw)
        const ctx = context(args, options)
        const release = await ToolWriteGate.acquire(ctx.sessionID, "exclusive", ctx.abort)
        using _lane = defer(release)
        let sequence = 0
        return runToolLifecycle({
          toolID: "browser_workflow",
          sessionID: ctx.sessionID,
          callID: options.toolCallId,
          args,
          cwd: Instance.directory,
          ask: (request) => ctx.ask(request),
          execute: () =>
            BrowserWorkflow.execute(BrowserWorkflow.Parameters.parse(args), {
              context: ctx,
              registry: registryDispatcher!,
              requireBridge(server) {
                const found = [...admittedBrowserTools.values()].find((entry) => entry.policy.server === server)
                if (
                  !found ||
                  !found.policy.profile.read ||
                  !found.policy.profile.interact ||
                  found.policy.profile.persistentProfile
                )
                  throw new Error("Browser workflow needs a connected isolated read/interact WebMCP bridge")
              },
              async browser(server, name, parameters, signal) {
                const entry = [...admittedBrowserTools.values()].find(
                  (entry) => entry.policy.server === server && entry.policy.toolName === name,
                )
                if (!entry?.wrapped.execute) throw new Error("Required browser tool is disabled or unavailable")
                const nested = {
                  toolCallId: `${options.toolCallId}:browser:${++sequence}`,
                  messages: options.messages,
                  abortSignal: signal,
                }
                const capture: { result?: unknown } = {}
                browserCalls.set(nested, capture)
                try {
                  try {
                    await entry.wrapped.execute(parameters, nested)
                  } catch (error) {
                    if (!(error instanceof WebMcpProfile.GrantRetryError)) throw error
                    // The grant path never dispatched the action. One continuation only.
                    await entry.wrapped.execute(parameters, nested)
                  }
                  if (capture.result === undefined) throw new Error("Browser operation produced no runtime evidence")
                  return capture.result
                } finally {
                  browserCalls.delete(nested)
                }
              },
            }),
        })
      },
    })
  }

  const discoveryEnabled = (await Config.get()).experimental?.mcp_tool_discovery === true
  // Revoke selections even when the entire admitted catalog disappears.
  const visible = ToolDiscovery.visible(input.session.id, discoveryEnabled ? discoveryCatalog : [])
  if (
    discoveryEnabled &&
    discoveryCatalog.length > 0 &&
    !isDisabledByConfig("tool_search") &&
    !Permission.disabled(["tool_search"], ruleset).has("tool_search")
  ) {
    if (Object.hasOwn(tools, "tool_search"))
      throw new Error("MCP discovery conflicts with an existing tool_search tool")
    for (const entry of discoveryCatalog) if (!visible.has(entry.name)) delete tools[entry.name]
    tools.tool_search = tool({
      description: ToolDiscovery.description(discoveryCatalog),
      inputSchema: ToolDiscovery.Query,
      async execute(args, options) {
        const ctx = context(args, options)
        return runToolLifecycle({
          toolID: "tool_search",
          sessionID: ctx.sessionID,
          callID: ctx.callID,
          args,
          cwd: Instance.directory,
          ask: (req) => ctx.ask(req),
          execute: async () => {
            ctx.abort.throwIfAborted()
            await ctx.ask({ permission: "tool_search", patterns: [args.query], always: ["*"], metadata: {} })
            ctx.abort.throwIfAborted()
            const result = ToolDiscovery.search(ctx.sessionID, discoveryCatalog, args)
            return {
              title: `Discovered ${result.tools.length} tools`,
              metadata: { count: result.tools.length },
              output: JSON.stringify(result),
            }
          },
        })
      },
    })
  }
  return tools
}
