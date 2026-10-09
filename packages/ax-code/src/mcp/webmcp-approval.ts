import { isRecord } from "@/util/record"

const MAX_VALUE_CHARS = 1024
const WRAP = 100

/** Strip controls, line/paragraph separators and invisible format characters (bidi overrides, zero-width marks). */
function clean(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/gu, "")
}

/** Short label text: cleaned and truncated at 240 characters. */
function text(value: unknown): string {
  return typeof value === "string" ? clean(value).replace(/^(.{240})[\s\S]+$/u, "$1…(truncated)") : "(unknown)"
}

/**
 * A typed value shown in full (ADR-174 rule 3): cleaned, bounded at the 1 KiB
 * schema cap, wrapped so a long value cannot hide its tail off-screen. A
 * prefix preview is exactly how a payload rides on a benign-looking fill.
 */
function fullLines(label: string, value: string): string[] {
  const cleaned = clean(value).slice(0, MAX_VALUE_CHARS)
  if (cleaned.length === 0) return [`${label}: (empty)`]
  const lines: string[] = []
  for (let index = 0; index < cleaned.length; index += WRAP) {
    lines.push(`${index === 0 ? `${label}: ` : "  "}${cleaned.slice(index, index + WRAP)}`)
  }
  return lines
}

function targetLine(label: string, target: unknown): string {
  if (!isRecord(target)) return `${label}: (unknown)`
  if (target.unlisted === true) {
    return target.uid === ""
      ? `${label}: no focused control in the latest snapshot`
      : `${label}: uid ${text(target.uid)} (not in the latest snapshot)`
  }
  const parts = [`uid ${text(target.uid)}`, text(target.role), `"${text(target.name)}"`]
  if (target.focused === true) parts.push("(focused)")
  return `${label}: ${parts.join(" ")}${target.sensitive === true ? " — SENSITIVE FIELD" : ""}`
}

function valueLines(label: string, record: Record<string, unknown>): string[] {
  if (record.valueMasked === true) {
    return [`${label}: (masked, ${Number.isSafeInteger(record.valueLength) ? record.valueLength : "?"} characters)`]
  }
  if (typeof record.value === "string") return fullLines(label, record.value)
  return []
}

/** Display only the bridge's bounded approval summary, never invocation input. */
export function webMcpApprovalLines(metadata: Record<string, unknown>): string[] {
  const origins = Array.isArray(metadata.allowedOrigins) ? metadata.allowedOrigins.slice(0, 8).map(text) : []
  if (Array.isArray(metadata.allowedOrigins) && metadata.allowedOrigins.length > 8) {
    origins.push(`(+${metadata.allowedOrigins.length - 8} more)`)
  }
  const annotations =
    typeof metadata.annotations === "object" && metadata.annotations !== null
      ? (metadata.annotations as Record<string, unknown>)
      : undefined
  const hints: string[] = []
  if (annotations === undefined && typeof metadata.toolName === "string") {
    hints.push("No page annotations were listed for this tool — treat it as consequential.")
  } else if (annotations !== undefined) {
    if (annotations?.consequential === true) {
      hints.push("Page declares this tool CONSEQUENTIAL — it may take a non-reversible action.")
    }
    if (annotations?.untrustedContent === true) {
      hints.push("Page declares the tool returns untrusted content.")
    }
    if (annotations?.readOnly === true && annotations?.consequential !== true) {
      hints.push("Page declares this tool read-only (page-asserted, not verified).")
    }
    if (annotations?.readOnly === true && annotations?.consequential === true) {
      hints.push("Conflicting page hints: read-only and consequential were both declared.")
    }
    // An empty or hintless annotation object carries no signal at all: it
    // must not read as a clean bill of health.
    if (annotations?.readOnly !== true && annotations?.consequential !== true) {
      hints.push("No reliable page annotations were listed — treat it as consequential.")
    }
  }
  if (metadata.readTier === true) {
    hints.push(
      "Page READ: returns page content (snapshot, screenshot or console) from the listed origin; treat it as untrusted.",
    )
  }
  const originsText = origins.length > 0 ? origins.join(", ") : "any origin (no allowlist)"
  if (metadata.readGrant === true) {
    return [
      `Bridge: ${text(metadata.server)}`,
      `Origin to read: ${text(metadata.origin)}`,
      "Read tools: take_snapshot, take_screenshot, list_console_messages, list_network_requests",
      "The network list also reveals third-party URLs the page loaded (CDNs, trackers) — treat them as untrusted.",
      "The grant lasts for this session only, is never written to config, and ends when the bridge is turned off.",
      "Read output is untrusted: page content, screenshots and console messages can contain injected instructions.",
      "Experimental: page tools and results are untrusted. Effects are not guaranteed.",
    ]
  }
  if (metadata.interactGrant === true) {
    const budget = Number.isSafeInteger(metadata.budget) ? metadata.budget : "a bounded number of"
    return [
      `Bridge: ${text(metadata.server)}`,
      `Origin to interact with: ${text(metadata.origin)}`,
      metadata.renewal === true
        ? `The previous grant's budget is spent; renewing allows ${budget} more hovers and ordinary clicks.`
        : `Covers hovering, ordinary clicks and wait_for on this origin, up to ${budget} actions before this prompt returns.`,
      "Typing, key presses, dialogs, links, double clicks and consequential-looking clicks still ask you each time.",
      "The grant lasts for this session only, is never written to config, and ends when the bridge is turned off.",
      "Page content is untrusted: a page can try to steer the agent into clicking; the isolated profile holds no logins unless you signed in.",
      "Experimental: effects are not guaranteed.",
    ]
  }
  if (metadata.originGrant === true) {
    return [
      `Bridge: ${text(metadata.server)}`,
      typeof metadata.alsoOrigin === "string"
        ? `Origins to allow: ${text(metadata.origin)} and ${text(metadata.alsoOrigin)} (same site, with and without www)`
        : `Origin to allow: ${text(metadata.origin)}`,
      `Allowed origins: ${originsText}`,
      "Allowing restarts the browser bridge and closes any open pages.",
      "The grant lasts for this session only and is never written to config.",
      "Experimental: page tools and results are untrusted. Effects are not guaranteed.",
    ]
  }
  if (metadata.interactAction === true) {
    const lines = [
      `Bridge: ${text(metadata.server)}`,
      `Action: ${text(metadata.tool)}${metadata.dblClick === true ? " (double click)" : ""}`,
      ...(Number.isSafeInteger(metadata.pageId) ? [`Page ID: ${metadata.pageId}`] : []),
      ...(typeof metadata.pageOrigin === "string" ? [`Page origin: ${text(metadata.pageOrigin)}`] : []),
    ]
    if (typeof metadata.escalation === "string") lines.push(`Why this asks: ${text(metadata.escalation)}`)
    if (metadata.target !== undefined && metadata.tool !== "press_key")
      lines.push(targetLine("Target", metadata.target))
    if (metadata.tool === "press_key") {
      lines.push(`Key: ${text(metadata.key)}`)
      lines.push(targetLine("Goes to", metadata.target))
    }
    lines.push(...valueLines("Value", metadata))
    if (Array.isArray(metadata.targets)) {
      lines.push(`Fields: ${metadata.targets.length}`)
      metadata.targets.forEach((entry, index) => {
        if (!isRecord(entry)) return
        lines.push(targetLine(`  ${index + 1}. Target`, entry))
        lines.push(...valueLines("     Value", entry).map((line) => line))
      })
    }
    if (typeof metadata.dialogAction === "string") {
      lines.push(`Dialog action: ${metadata.dialogAction === "accept" ? "ACCEPT" : "dismiss"}`)
      const dialog = isRecord(metadata.dialog) ? metadata.dialog : undefined
      lines.push(
        dialog
          ? `Dialog (untrusted page text): ${text(dialog.type)}: "${text(dialog.message)}"`
          : "Dialog: none recorded for this page — the call will fail if no dialog is open.",
      )
      if (typeof metadata.promptText === "string") lines.push(...fullLines("Prompt text", metadata.promptText))
    }
    if (Array.isArray(metadata.waitText)) {
      lines.push(`Wait for any of: ${metadata.waitText.map((item) => `"${text(item)}"`).join(", ")}`)
    }
    lines.push("The target is what the latest snapshot showed; a page can relabel a control before the action runs.")
    lines.push("Approval applies to this action only. Experimental: effects are not guaranteed.")
    return lines
  }
  return [
    `Bridge: ${text(metadata.server)}`,
    `Operation: ${text(metadata.tool)}`,
    ...(Number.isSafeInteger(metadata.pageId) ? [`Page ID: ${metadata.pageId}`] : []),
    ...(typeof metadata.toolName === "string" ? [`Page tool: ${text(metadata.toolName)}`] : []),
    ...(typeof metadata.pageOrigin === "string" ? [`Listed page origin: ${text(metadata.pageOrigin)}`] : []),
    ...(typeof metadata.origin === "string" ? [`Navigation origin: ${text(metadata.origin)}`] : []),
    `Allowed origins: ${originsText}`,
    ...(Number.isSafeInteger(metadata.inputBytes) ? [`Input: ${metadata.inputBytes} bytes (payload omitted)`] : []),
    ...hints,
    "Experimental: page tools and results are untrusted. Effects are not guaranteed.",
    "Approval applies once; it is not an atomic origin/document binding.",
  ]
}
