import { isRecord } from "@/util/record"
import { MAX_SNAPSHOT_VISITS, type SnapshotNode } from "./webmcp-snapshot"

const MAX_READ_TEXT_BYTES = 32 * 1024
// Room kept inside the read budget for the runtime notes a cut snapshot can
// carry after its text: the truncation note, the sign-in hand-off note
// (ADR-277, the longest at about 490 bytes) and the blocking-dialog note.
// 512 covered the first and last; the three together need about 950.
const SNAPSHOT_NOTE_RESERVE = 1024
const truncatedSnapshots = new WeakSet<object>()

/**
 * Cut an oversized snapshot at a line boundary instead of refusing it. Refusing left
 * the model without any uid on real sites (most large pages pass 32 KiB), and every
 * binding error then sent it back to a snapshot that overflowed again. Only the uids
 * left in the text may be recorded afterwards (visibleSnapshotNodes).
 */
function truncateSnapshot(result: Record<string, unknown>, contents: unknown[]): void {
  let remaining = MAX_READ_TEXT_BYTES - SNAPSHOT_NOTE_RESERVE
  let omitted = 0
  for (const part of contents) {
    if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") continue
    const bytes = Buffer.byteLength(part.text, "utf8")
    if (bytes <= remaining) {
      remaining -= bytes
      continue
    }
    const lines = part.text.split("\n")
    let kept = 0
    for (const line of lines) {
      const size = Buffer.byteLength(line, "utf8") + 1
      if (size > remaining) break
      remaining -= size
      kept += 1
    }
    omitted += lines.length - kept
    part.text = lines.slice(0, kept).join("\n")
    remaining = 0
  }
  contents.push({
    type: "text",
    text: `[AX Code] Snapshot truncated to the ${MAX_READ_TEXT_BYTES / 1024} KiB read budget; ${omitted} lines were omitted. Only uids shown above can be targeted. Another snapshot of the same page is cut the same way: act on what is shown, use wait_for with specific text, or report BLOCKED.`,
  })
  result.content = contents
  truncatedSnapshots.add(result)
}

/**
 * The snapshot nodes the model can see: all of them, or, for a truncated text, the prefix
 * of the structured tree (pre-order, the bridge's render order) whose own lines survived.
 * Each node's line is searched only after the previous node's, and the walk stops at the
 * first node not found, so a page name holding a newline and "uid=..." cannot make a
 * node from the cut part look visible (Codex review).
 */
export function visibleSnapshotNodes(
  result: unknown,
  nodes: Map<string, SnapshotNode>,
): Map<string, SnapshotNode> | undefined {
  if (!isRecord(result) || !truncatedSnapshots.has(result)) return nodes
  const structured = isRecord(result.structuredContent) ? result.structuredContent : undefined
  if (!structured || !isRecord(structured.snapshot)) return undefined
  const contents = Array.isArray(result.content) ? result.content : []
  const text = contents
    .flatMap((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : []))
    .join("\n")
  const visible = new Map<string, SnapshotNode>()
  const stack: unknown[] = [structured.snapshot]
  let cursor = 0
  let visited = 0
  while (stack.length > 0 && ++visited <= MAX_SNAPSHOT_VISITS) {
    const raw = stack.pop()
    if (!isRecord(raw)) continue
    if (Array.isArray(raw.children)) for (let i = raw.children.length - 1; i >= 0; i--) stack.push(raw.children[i])
    const node = typeof raw.id === "string" ? nodes.get(raw.id) : undefined
    if (!node) continue
    const line = new RegExp(
      `(?:^|\\n)[ \\t]*uid=${node.uid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[ \\t\\n]|$)`,
      "g",
    )
    line.lastIndex = cursor
    const found = line.exec(text)
    if (!found) break
    visible.set(node.uid, node)
    cursor = found.index + found[0].length
  }
  return visible.size > 0 ? visible : undefined
}

const CONSOLE_TAIL = 50

/**
 * The last `count` lines of a console blob, prefixed by the omitted count.
 * Scans for newlines instead of splitting: a huge dump must not
 * materialize a line array many times the size of the tail that is kept.
 */
function consoleTail(text: string): string {
  let total = 1
  let index = text.indexOf("\n")
  while (index !== -1) {
    total += 1
    index = text.indexOf("\n", index + 1)
  }
  if (total <= CONSOLE_TAIL) return text
  let cut = text.length
  for (let i = 0; i < CONSOLE_TAIL; i++) cut = text.lastIndexOf("\n", cut - 1)
  return `... ${total - CONSOLE_TAIL} earlier console messages omitted\n${text.slice(cut + 1)}`
}

/**
 * Secret-like query keys redacted from network/console URLs; ordinary query
 * strings stay (signed CDN URLs must remain downloadable). Userinfo and
 * fragments never leave the bridge (ADR-172).
 */
const SECRET_QUERY_KEY =
  /^(?:token|access_token|auth|sig|signature|session|secret|password|passwd|api_key|apikey|credential|key)$/i

function redactUrlText(text: string): string {
  return text
    .replace(/:\/\/[^\s/]*@/g, "://")
    .replace(/(https?:\/\/[^\s#]+)#[^\s]*/g, "$1")
    .replace(/([?&])([^=&\s]+)=([^&\s]*)/g, (match, separator: string, key: string) => {
      // Query names are decoded by URL consumers. Keep the original bytes
      // for ordinary parameters, but classify encoded names before deciding
      // whether their values may leave the bridge.
      let decoded: string
      try {
        decoded = decodeURIComponent(key.replace(/\+/g, " "))
      } catch {
        return match
      }
      return SECRET_QUERY_KEY.test(decoded) ? `${separator}${key}=[redacted]` : match
    })
}

/**
 * Local paths in console stack frames (ADR-192): a `file://` frame or a home
 * directory prefix names the developer's machine layout, which has no
 * business in the model context or the session log. Frame URLs on http(s)
 * origins stay (they are the page's own scripts) minus secret query keys.
 */
const LOCAL_FILE_URL = /file:\/\/[^\s)'"]*/g
// A home prefix counts only at the start of a path token (line start,
// whitespace, an opening parenthesis or a quote): `/home/` or `/Users/` inside
// an http(s) URL path is the page's own route and stays intact.
const HOME_PREFIX = /(?<![^\s("'])(?:(?:\/Users|\/home)\/[^/\s'"]+|[A-Za-z]:\\[Uu][Ss][Ee][Rr][Ss]\\[^\\\s'"]+)/g

function redactLocalPaths(text: string): string {
  return text.replace(LOCAL_FILE_URL, "file://[local path redacted]").replace(HOME_PREFIX, "~")
}

/**
 * Header names that must never leave the bridge, even when the upstream
 * `--redactNetworkHeaders` allowlist misses one (ADR-194). Substring match so
 * variants (`cookie2`, `x-session-token`, `refresh-token`) are covered;
 * `access-control-*` and `www-authenticate` carry no secret and are exactly
 * what CORS and 401 debugging need.
 */
export const SENSITIVE_HEADER = /cookie|authorization|authentication|token|session|secret|api[-_]?key|csrf|xsrf|passw/i
export function sensitiveHeader(name: string): boolean {
  const lower = name.trim().toLowerCase()
  if (lower.startsWith("access-control-") || lower === "www-authenticate") return false
  return SENSITIVE_HEADER.test(lower)
}

const NETWORK_BODY_OMITTED = "[omitted: request and response bodies are not admitted by the WebMCP bridge]"
const NETWORK_BODY_KEYS = ["requestBody", "responseBody", "requestBodyFilePath", "responseBodyFilePath"] as const

/**
 * Omit request and response bodies from the formatter text (ADR-194). A body
 * is untrusted bytes and can contain any line, including a forged section
 * heading, so no heading inside it can be trusted to mark where it ends.
 * Fail closed: everything from the first body heading to the end of the text
 * is replaced by one placeholder. Sections that precede a body (status, request
 * headers, and response headers of a bodiless-request call) are kept; anything
 * the formatter prints after a body (response headers after a request body, the
 * failure text, the redirect chain) is carried by the structured content, which
 * is stripped of bodies separately.
 */
function omitNetworkBodies(text: string): string {
  const lines = text.split("\n")
  const index = lines.findIndex((line) => {
    const trimmed = line.replace(/\r$/, "")
    return trimmed === "### Request Body" || trimmed === "### Response Body"
  })
  if (index === -1) return text
  return [...lines.slice(0, index), lines[index]!.replace(/\r$/, ""), NETWORK_BODY_OMITTED].join("\n")
}

/** Redact sensitive header values in `- name:value` lines. */
function redactSensitiveHeaders(text: string): string {
  return text.replace(/^- ([^:]+):(.*)$/gm, (match, name: string) =>
    sensitiveHeader(name) ? `- ${name.trim()}:[redacted]` : match,
  )
}

/**
 * Drop request/response bodies and file-path keys anywhere in structured
 * network detail, and redact sensitive header entries (ADR-194). Depth and
 * visit caps bound a hostile payload.
 */
function stripNetworkBodies(result: Record<string, unknown>): void {
  const seen = new WeakSet<object>()
  let visited = 0
  let capped = false
  const walk = (node: unknown, depth: number): void => {
    if (node === null || typeof node !== "object") return
    if (visited >= 2000 || depth > 6) {
      // Beyond the caps nothing was inspected: do not let it through.
      capped = true
      return
    }
    if (seen.has(node)) return
    seen.add(node)
    visited += 1
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    if (!isRecord(node)) return
    for (const key of NETWORK_BODY_KEYS) delete node[key]
    for (const [key, child] of Object.entries(node)) {
      if ((key === "requestHeaders" || key === "responseHeaders") && isRecord(child)) {
        for (const name of Object.keys(child)) {
          if (sensitiveHeader(name)) child[name] = "[redacted]"
        }
      }
      walk(child, depth + 1)
    }
  }
  walk(result.structuredContent, 0)
  if (capped) delete result.structuredContent
}

const CONSOLE_TOOLS = new Set<string>(["list_console_messages", "get_console_message"])

/**
 * Bound and label a read-tier result (ADR-171, extended by ADR-172).
 * Page-derived output is untrusted: the origin is labeled on the content,
 * snapshot text over 32 KiB is truncated with targetable uids bounded to
 * the visible prefix; oversized network lists are rejected with narrowing guidance, console output keeps only
 * the last 50 messages, network/console URLs lose userinfo, fragments and
 * secret-like query keys, and the upstream "Saved screenshot to <path>"
 * auto-save response fails closed — the path must never enter the log or
 * the model context.
 */
export function boundReadResult(name: string, result: unknown, origin: string): void {
  if (!isRecord(result)) return
  const contents = Array.isArray(result.content) ? result.content : []
  const redactUrls =
    name === "list_network_requests" ||
    name === "get_network_request" ||
    name === "get_css_styles" ||
    CONSOLE_TOOLS.has(name)
  let textBytes = 0
  for (const part of contents) {
    if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") continue
    if (part.text.startsWith("Saved screenshot to ")) {
      throw new Error(
        "WebMCP screenshot exceeded the inline budget and the bridge wrote it to a temporary file; do not read the file. Narrow the target (use uid) or lower the jpeg quality and retry.",
      )
    }
    let text = part.text
    // Tail console text before redacting it: the discarded prefix is
    // neither scanned nor redacted.
    if (name === "list_console_messages") text = consoleTail(text)
    if (name === "get_network_request") {
      text = omitNetworkBodies(text)
      text = redactSensitiveHeaders(text)
    }
    if (redactUrls) {
      text = redactUrlText(text)
    }
    // Request detail can name local files too (content-disposition, a file:// redirect entry; DeepSeek review).
    if (CONSOLE_TOOLS.has(name) || name === "get_network_request" || name === "get_css_styles")
      text = redactLocalPaths(text)
    part.text = text
    textBytes += Buffer.byteLength(text, "utf8")
  }
  if (name === "get_network_request") stripNetworkBodies(result)
  // The model only sees structuredContent when content is empty, and the origin
  // label below guarantees it is not; still, nothing parses these two results'
  // structured form, so it is dropped rather than left unsanitized (Grok review).
  if (name === "get_css_styles" || name === "get_console_message") delete result.structuredContent
  // wait_for always carries a fresh snapshot (ADR-174 rule 9), so it is
  // bounded exactly like take_snapshot.
  if ((name === "take_snapshot" || name === "wait_for") && textBytes > MAX_READ_TEXT_BYTES)
    truncateSnapshot(result, contents)
  else if (
    (name === "list_network_requests" ||
      name === "get_console_message" ||
      name === "get_network_request" ||
      name === "get_css_styles") &&
    textBytes > MAX_READ_TEXT_BYTES
  ) {
    const what =
      name === "list_network_requests"
        ? "network list"
        : name === "get_console_message"
          ? "console message"
          : name === "get_network_request"
            ? "network request"
            : "CSS styles"
    // A single console message or request has no narrowing argument, so a retry is identical.
    if (name === "get_console_message" || name === "get_network_request")
      throw new Error(
        `WebMCP ${what} exceeded the ${MAX_READ_TEXT_BYTES / 1024} KiB read budget. Do not retry ${name}; report the size limit.`,
      )
    throw new Error(
      `WebMCP ${what} exceeded the ${MAX_READ_TEXT_BYTES / 1024} KiB read budget; narrow the request and retry`,
    )
  }
  if (name === "list_console_messages") {
    const structured = isRecord(result.structuredContent) ? result.structuredContent : undefined
    if (structured && Array.isArray(structured.messages) && structured.messages.length > CONSOLE_TAIL) {
      structured.messages = structured.messages.slice(-CONSOLE_TAIL)
    }
    // The tail bounds the message count, not their size: one oversized line
    // would otherwise pass through whole.
    let tailBytes = 0
    for (const part of contents) {
      if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
        tailBytes += Buffer.byteLength(part.text, "utf8")
      }
    }
    if (tailBytes > MAX_READ_TEXT_BYTES) {
      throw new Error(
        `WebMCP console output exceeded the ${MAX_READ_TEXT_BYTES / 1024} KiB read budget; narrow the request and retry`,
      )
    }
  }
  contents.unshift({ type: "text", text: `[Untrusted web content from ${origin}]` })
  result.content = contents
}

/**
 * Label an action result (ADR-174 rules 6 and 9): untrusted-origin label,
 * plus a drift note when the action navigated. An origin change means the
 * next action there needs its own grant; a same-origin URL change only
 * invalidates the uid map.
 */
export function boundActionResult(
  result: unknown,
  origin: string,
  afterOrigin: string | undefined,
  urlChanged: boolean,
): void {
  if (!isRecord(result)) return
  const contents = Array.isArray(result.content) ? result.content : []
  const note =
    afterOrigin !== origin
      ? `[AX Code] The page navigated to ${afterOrigin ?? "a non-web address"}; further actions there need an interaction grant, and the previous snapshot no longer applies. Take a new snapshot before acting.`
      : urlChanged
        ? "[AX Code] The page URL changed after this action; the previous snapshot no longer applies. Take a new snapshot before acting."
        : undefined
  result.content = [
    { type: "text", text: `[Untrusted web content from ${origin}]` },
    ...contents,
    ...(note ? [{ type: "text", text: note }] : []),
  ]
}
