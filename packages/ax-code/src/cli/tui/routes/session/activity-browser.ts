import type { Part } from "@ax-code/sdk/v2"
import type { ReplayEvent } from "@/replay/event"
import { AgentControlReplayQuery } from "@/replay/agent-control-query"
import { Env } from "@/util/env"
import { asRecord } from "@/util/record"
import { activityItems, statusLabel, type Activity } from "./activity"
import type { AgentInfo } from "./route"

/**
 * View model for the Activity History browser. Everything here is pure so the
 * grouping, filtering, redaction and detail rules can be tested without
 * rendering. The browser exists so a person can audit a run: open any entry and
 * see what happened, when, why and with what result, with secrets redacted and
 * huge outputs truncated rather than dumped.
 */
export type EntryKind =
  | "tool"
  | "route"
  | "phase"
  | "reasoning"
  | "plan"
  | "validation"
  | "blocked"
  | "completed"
  | "safety"
  | "permission"
  | "error"

/** What a reviewer should look at first. Undefined for routine entries. */
export type Attention = "error" | "approval" | "denied"

export type Entry = Activity & {
  kind: EntryKind
  /** Tree group; also what the table can be filtered by. */
  group: string
  attention?: Attention
  part?: Part
  event?: Record<string, unknown>
  messageID?: string
}

export type ActivityMode = "table" | "tree"
export type ActivityFilter = "all" | "errors" | "approvals"

type Row = { event_data: ReplayEvent; time_created: number }

const GROUP_APPROVALS = "Safety & approvals"
const GROUP_ERRORS = "Errors"
const GROUP_PHASES = "Phases & plans"
const GROUP_ROUTING = "Routing"
const toolGroup = (tool: string) => `Tool · ${tool}`

const CONTROL_KINDS = new Set(["phase", "reasoning", "plan", "validation", "blocked", "completed", "safety"])

function kindOf(item: Activity): EntryKind {
  if (item.tool.startsWith("route.")) return "route"
  if (item.tool.startsWith("agent.")) {
    const kind = item.tool.slice("agent.".length)
    return CONTROL_KINDS.has(kind) ? (kind as EntryKind) : "phase"
  }
  return "tool"
}

function groupOf(kind: EntryKind, tool: string): string {
  switch (kind) {
    case "safety":
    case "permission":
      return GROUP_APPROVALS
    case "error":
      return GROUP_ERRORS
    case "route":
      return GROUP_ROUTING
    case "tool":
      return toolGroup(tool)
    default:
      return GROUP_PHASES
  }
}

function attentionOf(kind: EntryKind, status: string, event?: Record<string, unknown>): Attention | undefined {
  if (kind === "tool") return status === "error" ? "error" : undefined
  if (kind === "error" || kind === "blocked") return "error"
  if (kind === "validation") return status === "failed" ? "error" : undefined
  if (kind === "safety") {
    // A shadow decision records what the policy would have done; nothing was asked or blocked, so it is not
    // something a reviewer must act on. It stays visible and searchable, and is counted separately.
    if (event?.shadow === true) return undefined
    return status === "deny" ? "denied" : status === "ask" ? "approval" : undefined
  }
  if (kind === "permission") {
    if (event?.type === "permission.reply") return event.reply === "reject" ? "denied" : "approval"
    return "approval"
  }
  return undefined
}

/**
 * Entries newest first: the activity the sidebar shows (tool calls, routing,
 * agent control) plus permission asks and replies and error events, which are
 * what an auditor asks about first and which the sidebar does not list.
 */
export function buildEntries(parts: Part[], rows: Row[], agents?: AgentInfo[]): Entry[] {
  const partById = new Map<string, Part>()
  for (const part of parts) {
    if (part.type !== "tool") continue
    // Call-scoped index: at most one entry per input, dropped when this call returns.
    if (partById.size >= parts.length) break
    partById.set(part.id, part)
  }
  const eventById = new Map<string, Record<string, unknown>>()
  const extra: Entry[] = []
  rows.forEach((row, index) => {
    const event = row.event_data as unknown as Record<string, unknown>
    const type = typeof event?.type === "string" ? event.type : ""
    if (type === "agent.route") {
      const mode = event.routeMode ?? "switch"
      if (eventById.size < rows.length) {
        eventById.set(
          `route:${row.time_created}:${mode === "complexity" ? "complexity" : String(event.toAgent)}`,
          event,
        )
      }
    } else if (AgentControlReplayQuery.isAgentControlEvent(event)) {
      if (eventById.size < rows.length) eventById.set(`agent-control:${row.time_created}:${index}`, event)
    } else if (type === "permission.ask" || type === "permission.reply") {
      const reply = type === "permission.reply" ? String(event.reply ?? "") : ""
      const status = type === "permission.ask" ? "ask" : reply === "reject" ? "rejected" : "approved"
      const patterns = Array.isArray(event.patterns) ? (event.patterns as unknown[]).map(String).join(", ") : ""
      extra.push({
        id: `permission:${row.time_created}:${index}`,
        icon: "!",
        label:
          type === "permission.ask"
            ? `Permission asked: ${String(event.permission ?? "")}`
            : `Permission ${reply === "reject" ? "rejected" : `approved (${reply})`}: ${String(event.permission ?? "")}`,
        status,
        tool: typeof event.tool === "string" ? event.tool : "permission",
        time: row.time_created,
        description: patterns || undefined,
        category: "permission",
        kind: "permission",
        group: GROUP_APPROVALS,
        attention: attentionOf("permission", status, event),
        event,
        messageID: typeof event.messageID === "string" ? event.messageID : undefined,
      })
    } else if (type === "error") {
      extra.push({
        id: `error:${row.time_created}:${index}`,
        icon: "✗",
        label: `Error: ${String(event.errorType ?? "error")}`,
        status: "error",
        tool: "error",
        time: row.time_created,
        description: typeof event.message === "string" ? event.message : undefined,
        category: "error",
        kind: "error",
        group: GROUP_ERRORS,
        attention: "error",
        event,
        messageID: typeof event.messageID === "string" ? event.messageID : undefined,
      })
    }
  })

  const base = activityItems(parts, rows, agents).map((item): Entry => {
    const kind = kindOf(item)
    const part = partById.get(item.id)
    const event = eventById.get(item.id)
    return {
      ...item,
      kind,
      group: groupOf(kind, item.tool),
      attention: attentionOf(kind, item.status, event),
      part,
      event,
      messageID: part?.messageID ?? (typeof event?.messageID === "string" ? event.messageID : undefined),
    }
  })
  // Stable merge: newest first, ties keep production order.
  return [...base, ...extra]
    .map((entry) => ({
      ...entry,
      label: redact(entry.label),
      description: entry.description === undefined ? undefined : redact(entry.description),
    }))
    .toSorted((a, b) => (b.time ?? 0) - (a.time ?? 0))
}

export function nextFilter(filter: ActivityFilter): ActivityFilter {
  return filter === "all" ? "errors" : filter === "errors" ? "approvals" : "all"
}

export function filterLabel(filter: ActivityFilter): string {
  return filter === "all" ? "All" : filter === "errors" ? "Errors" : "Approvals and denials"
}

function passesFilter(entry: Entry, filter: ActivityFilter) {
  if (filter === "all") return true
  if (filter === "errors") return entry.attention === "error"
  return entry.attention === "approval" || entry.attention === "denied"
}

function searchable(entry: Entry) {
  return [
    entry.label,
    entry.description,
    statusLabel(entry.status),
    entry.status,
    entry.tool,
    entry.kind,
    entry.group,
    entry.messageID,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

export function matchesQuery(entry: Entry, query: string) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const text = searchable(entry)
  return tokens.every((token) => text.includes(token))
}

export type Summary = { total: number; errors: number; approvals: number; denied: number; shadow: number }

export function summarize(entries: readonly Entry[]): Summary {
  const summary: Summary = { total: entries.length, errors: 0, approvals: 0, denied: 0, shadow: 0 }
  for (const entry of entries) {
    if (entry.kind === "safety" && entry.event?.shadow === true) summary.shadow++
    if (entry.attention === "error") summary.errors++
    else if (entry.attention === "approval") summary.approvals++
    else if (entry.attention === "denied") summary.denied++
  }
  return summary
}

export function summaryText(summary: Summary) {
  return [
    `${summary.total} ${summary.total === 1 ? "event" : "events"}`,
    `${summary.errors} ${summary.errors === 1 ? "error" : "errors"}`,
    `${summary.approvals} ${summary.approvals === 1 ? "approval" : "approvals"}`,
    `${summary.denied} denied`,
    ...(summary.shadow > 0 ? [`${summary.shadow} shadow`] : []),
  ].join(" · ")
}

export type ViewRow =
  | { type: "group"; key: string; label: string; count: number; errors: number; approvals: number; open: boolean }
  | { type: "entry"; entry: Entry; indent: boolean }

const GROUP_ORDER = [GROUP_APPROVALS, GROUP_ERRORS]

function groupRank(group: string) {
  const fixed = GROUP_ORDER.indexOf(group)
  if (fixed >= 0) return fixed
  if (group === GROUP_PHASES) return 1000
  if (group === GROUP_ROUTING) return 1001
  return 10
}

/** Groups that hold something a reviewer should open first start expanded. */
export function defaultExpanded(entries: readonly Entry[]): Set<string> {
  return new Set(entries.filter((entry) => entry.attention).map((entry) => entry.group))
}

export function groupKeys(entries: readonly Entry[]): string[] {
  return [...new Set(entries.map((entry) => entry.group))]
}

/**
 * Rows for the table (flat, newest first) or the tree (category -> entries).
 * A search or a non-default filter opens every group that still has a match so a
 * hit is never hidden behind a collapsed header.
 */
export function buildRows(input: {
  entries: readonly Entry[]
  mode: ActivityMode
  filter: ActivityFilter
  query: string
  expanded: ReadonlySet<string>
}): ViewRow[] {
  const entries = input.entries.filter((entry) => passesFilter(entry, input.filter) && matchesQuery(entry, input.query))
  if (input.mode === "table") return entries.map((entry) => ({ type: "entry", entry, indent: false }))
  const forceOpen = input.query.trim().length > 0 || input.filter !== "all"
  const groups = new Map<string, Entry[]>()
  for (const entry of entries) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry])
  const ordered = [...groups.entries()].toSorted(
    (a, b) => groupRank(a[0]) - groupRank(b[0]) || b[1].length - a[1].length || a[0].localeCompare(b[0]),
  )
  return ordered.flatMap(([key, items]): ViewRow[] => {
    const open = forceOpen || input.expanded.has(key)
    const summary = summarize(items)
    const header: ViewRow = {
      type: "group",
      key,
      label: key,
      count: items.length,
      errors: summary.errors,
      approvals: summary.approvals + summary.denied,
      open,
    }
    return open ? [header, ...items.map((entry): ViewRow => ({ type: "entry", entry, indent: true }))] : [header]
  })
}

/**
 * Whether every group row currently rendered is open. Derived from buildRows
 * output rather than the raw entry list so a search or filter (which forces
 * matching groups open) is reflected instead of reporting a hidden state.
 */
export function allGroupsOpen(rows: readonly ViewRow[]): boolean {
  const groups = rows.filter((row) => row.type === "group")
  return groups.length > 0 && groups.every((row) => row.open)
}

export function groupBadge(row: Extract<ViewRow, { type: "group" }>) {
  return [`${row.count}`, row.errors > 0 ? `${row.errors} ERR` : "", row.approvals > 0 ? `${row.approvals} ask` : ""]
    .filter(Boolean)
    .join(" · ")
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export type DetailSection = { heading: string; lines: string[] }
export type Detail = {
  title: string
  sections: DetailSection[]
  /** Complete redacted text for the clipboard. Display sections may be truncated; this is not. */
  copyText: string
  messageID?: string
}

const HEAD_LINES = 40
const TAIL_LINES = 20
const MAX_CHARS = 8000

export function redact(text: string): string {
  return Env.redactForRecord(text)
}

/** Keep the first and last lines of a long block and say exactly how much was left out. */
export function truncateBlock(text: string): {
  lines: string[]
  omitted?: { lines: number; chars: number; after: number }
} {
  const lines = text.split("\n")
  const tooMany = lines.length > HEAD_LINES + TAIL_LINES
  const tooBig = text.length > MAX_CHARS
  if (!tooMany && !tooBig) return { lines }
  // Enforce both caps: keeping sixty giant lines still overwhelms the renderer.
  let head = lines.slice(0, HEAD_LINES).join("\n")
  let tail = lines.slice(-TAIL_LINES).join("\n")
  if (head.length + tail.length + 1 > MAX_CHARS) {
    head = head.slice(0, MAX_CHARS - 1000)
    tail = tail.slice(-800)
  }
  const headLines = head.split("\n")
  const tailLines = tail.split("\n")
  return {
    lines: [...headLines, ...tailLines],
    omitted: {
      lines: Math.max(0, lines.length - headLines.length - tailLines.length),
      chars: text.length - head.length - tail.length,
      after: headLines.length,
    },
  }
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

export function formatStamp(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "unknown"
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? "unknown" : `${date.toISOString().replace("T", " ").slice(0, 19)} UTC`
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "unknown"
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

const MS_WINDOW = 5 * 60_000

/** Nearest earlier safety/permission entry for the same tool; the event log has no call id to join on, so this is inferred. */
export function linkedDecisions(entry: Entry, entries: readonly Entry[]): Entry[] {
  if (entry.kind !== "tool" || entry.time === undefined) return []
  const start = entry.time
  return entries
    .filter(
      (other) =>
        (other.kind === "safety" || other.kind === "permission") &&
        other.time !== undefined &&
        other.time <= start &&
        start - other.time <= MS_WINDOW &&
        (other.event?.tool === undefined || other.event.tool === entry.tool),
    )
    .toSorted((a, b) => (b.time ?? 0) - (a.time ?? 0))
    .slice(0, 3)
}

/** The tool calls a decision most likely governed: same tool, soon after. */
export function governedCalls(entry: Entry, entries: readonly Entry[]): Entry[] {
  if ((entry.kind !== "safety" && entry.kind !== "permission") || entry.time === undefined) return []
  const tool = typeof entry.event?.tool === "string" ? entry.event.tool : undefined
  const at = entry.time
  return entries
    .filter(
      (other) =>
        other.kind === "tool" &&
        other.time !== undefined &&
        other.time >= at &&
        other.time - at <= MS_WINDOW &&
        (tool === undefined || other.tool === tool),
    )
    .toSorted((a, b) => (a.time ?? 0) - (b.time ?? 0))
    .slice(0, 3)
}

function field(lines: string[], name: string, value: unknown) {
  if (value === undefined || value === null || value === "") return
  lines.push(`${name}: ${typeof value === "string" ? value : stringify(value)}`)
}

function block(heading: string, text: string, sections: DetailSection[], full: DetailSection[]) {
  const clean = redact(text)
  const cut = truncateBlock(clean)
  const shown = [...cut.lines]
  if (cut.omitted) {
    const note =
      cut.omitted.lines > 0
        ? `… ${cut.omitted.lines} lines (${cut.omitted.chars.toLocaleString()} chars) omitted. Copy keeps the full redacted text.`
        : `… ${cut.omitted.chars.toLocaleString()} chars omitted. Copy keeps the full redacted text.`
    shown.splice(cut.omitted.after, 0, note)
  }
  sections.push({ heading, lines: shown })
  full.push({ heading, lines: clean.split("\n") })
}

export function detailFor(entry: Entry, entries: readonly Entry[] = []): Detail {
  const sections: DetailSection[] = []
  const full: DetailSection[] = []
  const overview: string[] = []
  field(overview, "What", entry.label)
  field(overview, "Status", statusLabel(entry.status))
  if (entry.attention) {
    field(
      overview,
      "Needs attention",
      entry.attention === "error" ? "error" : entry.attention === "denied" ? "denied" : "approval",
    )
  }
  field(overview, "Kind", entry.kind)
  if (entry.kind === "safety") {
    field(
      overview,
      "Enforcement",
      entry.event?.shadow === true ? "shadow: recorded only, nothing was asked or blocked" : "enforced",
    )
  }

  if (entry.part && entry.part.type === "tool") {
    const state = asRecord(entry.part.state)
    const time = asRecord(state.time)
    const start = typeof time.start === "number" ? time.start : entry.time
    const end = typeof time.end === "number" ? time.end : undefined
    field(overview, "Tool", entry.part.tool)
    field(overview, "Started", formatStamp(start))
    if (end !== undefined) field(overview, "Ended", formatStamp(end))
    if (start !== undefined && end !== undefined) field(overview, "Duration", formatDuration(end - start))
    field(overview, "Call ID", entry.part.callID)
    field(overview, "Message ID", entry.part.messageID)
    if (typeof state.title === "string") field(overview, "Title", state.title)
    block("Overview", overview.join("\n"), sections, full)
    if (Object.keys(asRecord(state.input)).length > 0) block("Input", stringify(state.input), sections, full)
    if (typeof state.output === "string" && state.output.length > 0) block("Output", state.output, sections, full)
    if (typeof state.error === "string" && state.error.length > 0) block("Error", state.error, sections, full)
    const meta = asRecord(state.metadata)
    if (Object.keys(meta).length > 0) block("Metadata", stringify(meta), sections, full)
  } else {
    field(overview, "Time", formatStamp(entry.time))
    field(overview, "Message ID", entry.messageID)
    block("Overview", overview.join("\n"), sections, full)
    const raw = entry.event ? eventFields(entry.event) : {}
    if (entry.description) block("Detail", entry.description, sections, full)
    if (Object.keys(raw).length > 0) block("Recorded fields", stringify(raw), sections, full)
  }

  const related = [
    ...linkedDecisions(entry, entries).map(
      (other) =>
        `Decided before (inferred by tool and time): ${other.label} [${statusLabel(other.status)}] ${formatStamp(other.time)}`,
    ),
    ...governedCalls(entry, entries).map(
      (other) =>
        `Likely governed (inferred by tool and time): ${other.label} [${statusLabel(other.status)}] ${formatStamp(other.time)}`,
    ),
  ]
  if (related.length > 0) {
    block("Related", related.join("\n"), sections, full)
  }

  const copyText = full.map((section) => `## ${section.heading}\n${section.lines.join("\n")}`).join("\n\n")
  return { title: redact(`${entry.icon} ${entry.label}`), sections, copyText, messageID: entry.messageID }
}

/** Recorded event fields without bookkeeping noise. */
function eventFields(event: Record<string, unknown>) {
  const { sessionID: _sessionID, deterministic: _deterministic, properties: _properties, ...rest } = event
  return rest
}
