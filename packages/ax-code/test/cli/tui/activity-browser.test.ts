import { describe, expect, test } from "vitest"
import type { Part } from "@ax-code/sdk/v2"
import {
  buildEntries,
  buildRows,
  defaultExpanded,
  detailFor,
  filterLabel,
  formatStamp,
  groupBadge,
  groupKeys,
  linkedDecisions,
  governedCalls,
  matchesQuery,
  nextFilter,
  summarize,
  summaryText,
  truncateBlock,
  redact,
  type Entry,
} from "../../../src/cli/tui/routes/session/activity-browser"

const T0 = Date.UTC(2026, 9, 2, 21, 38, 0)

function tool(id: string, name: string, state: Record<string, unknown>, extra: Record<string, unknown> = {}): Part {
  return {
    id,
    sessionID: "s",
    messageID: `m-${id}`,
    type: "tool",
    callID: `call-${id}`,
    tool: name,
    state,
    ...extra,
  } as unknown as Part
}
function row(time: number, event: Record<string, unknown>) {
  return { time_created: time, event_data: { sessionID: "s", ...event } } as never
}
const safety = (time: number, action: string, extra: Record<string, unknown> = {}) =>
  row(time, {
    type: "agent.safety.decided",
    action,
    risk: "medium",
    reason: "autonomous_risky_permission",
    permission: "bash",
    tool: "bash",
    checkpointRequired: false,
    ...extra,
  })

function fixture() {
  const parts = [
    tool("p1", "bash", {
      status: "completed",
      title: "Show current date and time",
      input: { command: "date" },
      output: "Fri Oct 2",
      metadata: {},
      time: { start: T0 + 2000, end: T0 + 2500 },
    }),
    tool("p2", "edit", {
      status: "error",
      input: { path: "a.ts" },
      error: "no match",
      time: { start: T0 + 9000, end: T0 + 9100 },
    }),
    tool("p3", "read", {
      status: "completed",
      title: "read a.ts",
      input: { path: "a.ts" },
      output: "x",
      metadata: {},
      time: { start: T0 + 4000, end: T0 + 4010 },
    }),
  ]
  const rows = [
    safety(T0 + 1000, "ask"),
    row(T0 + 1500, { type: "permission.ask", permission: "bash", patterns: ["date"], tool: "bash", messageID: "m-p1" }),
    row(T0 + 1800, { type: "permission.reply", permission: "bash", reply: "once" }),
    row(T0 + 3000, { type: "agent.phase.changed", phase: "execute", reason: "plan approved" }),
    row(T0 + 5000, {
      type: "agent.route",
      routeMode: "switch",
      fromAgent: "build",
      toAgent: "debug",
      matched: ["fix"],
      messageID: "m-p3",
    }),
    row(T0 + 6000, { type: "error", errorType: "ProviderError", message: "overloaded", messageID: "m-p2" }),
    safety(T0 + 8000, "deny", { tool: "edit", permission: "edit" }),
    row(T0 + 8500, { type: "permission.reply", permission: "edit", reply: "reject" }),
  ]
  return { parts, rows }
}
const entries = () => buildEntries(fixture().parts, fixture().rows)

describe("activity browser: entries", () => {
  test("merges tool calls, routing, agent control, permissions and errors, newest first", () => {
    const list = entries()
    const times = list.map((entry) => entry.time ?? 0)
    expect(times).toEqual([...times].sort((a, b) => b - a))
    expect(new Set(list.map((entry) => entry.kind))).toEqual(
      new Set(["tool", "route", "phase", "safety", "permission", "error"]),
    )
    expect(new Set(list.map((entry) => entry.id)).size).toBe(list.length)
  })

  test("classifies what a reviewer should look at first", () => {
    expect(entries().find((e) => e.id === "p2")!.attention).toBe("error")
    expect(entries().find((e) => e.id === "p1")!.attention).toBeUndefined()
    expect(entries().find((e) => e.kind === "safety" && e.status === "ask")!.attention).toBe("approval")
    expect(entries().find((e) => e.kind === "safety" && e.status === "deny")!.attention).toBe("denied")
    expect(entries().find((e) => e.label.startsWith("Permission asked"))!.attention).toBe("approval")
    expect(entries().find((e) => e.label.startsWith("Permission rejected"))!.attention).toBe("denied")
    expect(entries().find((e) => e.label.startsWith("Permission approved"))!.attention).toBe("approval")
    expect(entries().find((e) => e.kind === "error")!.attention).toBe("error")
    expect(entries().find((e) => e.kind === "phase")!.attention).toBeUndefined()
    expect(entries().find((e) => e.kind === "route")!.attention).toBeUndefined()
  })

  test("shadow decisions are visible but never counted as something to approve", () => {
    const rows = [
      safety(T0, "ask", { shadow: true }),
      safety(T0 + 10, "deny", { shadow: true }),
      safety(T0 + 20, "ask"),
    ]
    const list = buildEntries([], rows)
    expect(list.filter((e) => e.attention).map((e) => e.attention)).toEqual(["approval"])
    const summary = summarize(list)
    expect(summary).toMatchObject({ approvals: 1, denied: 0, shadow: 2 })
    expect(summaryText(summary)).toContain("2 shadow")
    expect(defaultExpanded(list.filter((e) => e.event?.shadow === true)).size).toBe(0)
    const shadow = list.find((e) => e.event?.shadow === true)!
    const text = detailFor(shadow, list).sections[0]!.lines.join("\n")
    expect(text).toContain("Enforcement: shadow: recorded only, nothing was asked or blocked")
    const enforced = list.find((e) => e.event?.shadow !== true)!
    expect(detailFor(enforced, list).sections[0]!.lines.join("\n")).toContain("Enforcement: enforced")
    expect(
      buildRows({ entries: list, mode: "table", filter: "approvals", query: "", expanded: new Set() }),
    ).toHaveLength(1)
    expect(
      buildRows({ entries: list, mode: "table", filter: "all", query: "shadow", expanded: new Set() }).length,
    ).toBeGreaterThan(0)
  })

  test("keeps the message id so an entry can be located in the conversation", () => {
    expect(entries().find((e) => e.id === "p1")!.messageID).toBe("m-p1")
    expect(entries().find((e) => e.kind === "route")!.messageID).toBe("m-p3")
    expect(entries().find((e) => e.kind === "error")!.messageID).toBe("m-p2")
  })

  test("an empty session yields no entries and a sane summary", () => {
    expect(buildEntries([], [])).toEqual([])
    expect(summaryText(summarize([]))).toBe("0 events · 0 errors · 0 approvals · 0 denied")
  })
})

describe("activity browser: filters and search", () => {
  test("filter cycles all, errors, approvals and back", () => {
    expect([nextFilter("all"), nextFilter("errors"), nextFilter("approvals")]).toEqual(["errors", "approvals", "all"])
    expect(filterLabel("approvals")).toBe("Approvals and denials")
  })

  test("errors and approvals filters keep only matching entries", () => {
    const base = { entries: entries(), mode: "table" as const, query: "", expanded: new Set<string>() }
    const errors = buildRows({ ...base, filter: "errors" }).flatMap((r) =>
      r.type === "entry" ? [r.entry.attention] : [],
    )
    expect(errors.length).toBeGreaterThan(0)
    expect(new Set(errors)).toEqual(new Set(["error"]))
    const asks = buildRows({ ...base, filter: "approvals" }).flatMap((r) =>
      r.type === "entry" ? [r.entry.attention] : [],
    )
    expect(new Set(asks)).toEqual(new Set(["approval", "denied"]))
  })

  test("search requires every word and looks at status, tool, group and reason", () => {
    const list = entries()
    const edit = list.find((entry) => entry.id === "p2")!
    expect(matchesQuery(edit, "edit err")).toBe(true)
    expect(matchesQuery(edit, "edit ok")).toBe(false)
    expect(matchesQuery(list.find((e) => e.kind === "safety")!, "autonomous_risky")).toBe(true)
    expect(matchesQuery(edit, "")).toBe(true)
    expect(matchesQuery(edit, "   ")).toBe(true)
  })
})

describe("activity browser: table and tree rows", () => {
  test("table is flat, newest first, with no group rows", () => {
    const rows = buildRows({ entries: entries(), mode: "table", filter: "all", query: "", expanded: new Set() })
    expect(rows.every((row) => row.type === "entry")).toBe(true)
    expect(rows).toHaveLength(entries().length)
  })

  test("tree puts approvals and errors first, phases and routing last, and counts attention", () => {
    const rows = buildRows({ entries: entries(), mode: "tree", filter: "all", query: "", expanded: new Set() })
    const headers = rows.flatMap((row) => (row.type === "group" ? [row] : []))
    expect(headers.map((h) => h.label)[0]).toBe("Safety & approvals")
    expect(headers.map((h) => h.label)[1]).toBe("Errors")
    expect(headers.map((h) => h.label).slice(-2)).toEqual(["Phases & plans", "Routing"])
    expect(headers.some((h) => h.label === "Tool · bash")).toBe(true)
    const approvals = headers[0]!
    expect(approvals.count).toBe(5)
    expect(approvals.approvals).toBe(5)
    expect(groupBadge(approvals)).toBe("5 · 5 ask")
    expect(groupBadge(headers.find((h) => h.label === "Tool · edit")!)).toBe("1 · 1 ERR")
  })

  test("collapsed groups hide their entries and expanded groups show them indented", () => {
    const collapsed = buildRows({ entries: entries(), mode: "tree", filter: "all", query: "", expanded: new Set() })
    expect(collapsed.every((row) => row.type === "group")).toBe(true)
    const open = buildRows({
      entries: entries(),
      mode: "tree",
      filter: "all",
      query: "",
      expanded: new Set(["Tool · bash"]),
    })
    const index = open.findIndex((row) => row.type === "group" && row.label === "Tool · bash")
    expect(open[index]).toMatchObject({ open: true })
    expect(open[index + 1]).toMatchObject({ type: "entry", indent: true })
  })

  test("groups holding errors or approvals start expanded", () => {
    const open = defaultExpanded(entries())
    expect(open.has("Safety & approvals")).toBe(true)
    expect(open.has("Errors")).toBe(true)
    expect(open.has("Tool · edit")).toBe(true)
    expect(open.has("Tool · read")).toBe(false)
    expect(open.has("Routing")).toBe(false)
    expect(groupKeys(entries())).toContain("Phases & plans")
  })

  test("a search or filter opens every group that still has a match", () => {
    const hit = buildRows({ entries: entries(), mode: "tree", filter: "all", query: "read", expanded: new Set() })
    expect(hit.some((row) => row.type === "entry" && row.entry.tool === "read")).toBe(true)
    const filtered = buildRows({ entries: entries(), mode: "tree", filter: "errors", query: "", expanded: new Set() })
    expect(filtered.some((row) => row.type === "entry")).toBe(true)
    expect(filtered.every((row) => row.type === "entry" || row.open)).toBe(true)
  })

  test("summary counts add up", () => {
    const summary = summarize(entries())
    expect(summary.total).toBe(entries().length)
    expect(summary.errors).toBe(2)
    expect(summary.denied).toBe(2)
    expect(summary.approvals).toBe(3)
  })
})

describe("activity browser: detail", () => {
  const find = (id: string): Entry => entries().find((entry) => entry.id === id)!

  test("a tool call shows when, how long, which call, its input, output and error", () => {
    const ok = detailFor(find("p1"), entries())
    const text = ok.sections.map((s) => `${s.heading}\n${s.lines.join("\n")}`).join("\n")
    expect(text).toContain("Tool: bash")
    expect(text).toContain("Started: 2026-10-02 21:38:02 UTC")
    expect(text).toContain("Duration: 500ms")
    expect(text).toContain("Call ID: call-p1")
    expect(text).toContain("Message ID: m-p1")
    expect(text).toContain('"command": "date"')
    expect(text).toContain("Fri Oct 2")
    expect(ok.messageID).toBe("m-p1")
    const bad = detailFor(find("p2"), entries())
    expect(bad.sections.some((s) => s.heading === "Error" && s.lines.join("\n") === "no match")).toBe(true)
    expect(bad.sections[0]!.lines.join("\n")).toContain("Needs attention: error")
  })

  test("secrets are redacted from input, output and the copy text", () => {
    // Assembled at runtime: these are fake values shaped like real credentials.
    const fakeGithubToken = ["ghp", "_", "abcdefghijklmnopqrstuvwxyz", "0123456789"].join("")
    const fakeApiKey = ["sk", "-live-", "1234567890abcdef"].join("")
    const part = tool("p9", "bash", {
      status: "completed",
      input: {
        command: "curl -H 'Authorization: Bearer abc123secret' https://x",
        apiKey: fakeApiKey,
        note: "keep me",
      },
      output: `token=${fakeGithubToken} done`,
      metadata: {},
      time: { start: T0, end: T0 + 1 },
    })
    const entry = buildEntries([part], []).find((e) => e.id === "p9")!
    const detail = detailFor(entry, [entry])
    const everything = JSON.stringify(detail.sections) + detail.copyText
    expect(everything).not.toContain("abc123secret")
    expect(everything).not.toContain(fakeApiKey)
    expect(everything).not.toContain(fakeGithubToken)
    expect(everything).toContain("[redacted]")
    expect(everything).toContain("keep me")
    expect(redact("plain text")).toBe("plain text")
  })

  test("long output is cut for display with an exact omission note, but copy keeps everything", () => {
    const output = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n")
    const part = tool("p8", "bash", {
      status: "completed",
      input: { c: "x" },
      output,
      metadata: {},
      time: { start: T0, end: T0 + 1 },
    })
    const entry = buildEntries([part], []).find((e) => e.id === "p8")!
    const detail = detailFor(entry, [entry])
    const shown = detail.sections.find((s) => s.heading === "Output")!.lines
    expect(shown.length).toBeLessThan(80)
    expect(shown.some((line) => line.includes("140 lines") && line.includes("omitted"))).toBe(true)
    expect(shown).toContain("line 0")
    expect(shown).toContain("line 199")
    expect(shown).not.toContain("line 100")
    expect(detail.copyText).toContain("line 100")
  })

  test("truncateBlock leaves short text alone and clips giant single lines", () => {
    expect(truncateBlock("a\nb")).toEqual({ lines: ["a", "b"] })
    const giant = "x".repeat(20_000)
    const cut = truncateBlock(giant)
    expect(cut.omitted?.chars).toBeGreaterThan(10_000)
    expect(cut.lines.join("").length).toBeLessThan(9000)
  })

  test("a safety decision shows the recorded fields and links to the call it likely governed", () => {
    const decision = entries().find((e) => e.kind === "safety" && e.status === "ask")!
    const detail = detailFor(decision, entries())
    const text = detail.sections.map((s) => s.lines.join("\n")).join("\n")
    expect(text).toContain("autonomous_risky_permission")
    expect(text).toContain('"risk": "medium"')
    expect(text).toContain("Likely governed (inferred by tool and time)")
    expect(text).not.toContain("sessionID")
  })

  test("a tool call links back to the nearest earlier decision for the same tool only", () => {
    const list = entries()
    const bash = list.find((e) => e.id === "p1")!
    const linked = linkedDecisions(bash, list)
    expect(linked.length).toBeGreaterThan(0)
    expect(linked.every((e) => e.event?.tool === undefined || e.event.tool === "bash")).toBe(true)
    const read = list.find((e) => e.id === "p3")!
    expect(linkedDecisions(read, list).every((e) => e.event?.tool !== "edit")).toBe(true)
    expect(governedCalls(list.find((e) => e.kind === "tool")!, list)).toEqual([])
    const old = { ...bash, time: T0 + 10 * 60_000 }
    expect(linkedDecisions(old, list)).toEqual([])
  })

  test("stamps are UTC and tolerate bad input", () => {
    expect(formatStamp(T0)).toBe("2026-10-02 21:38:00 UTC")
    expect(formatStamp(undefined)).toBe("unknown")
    expect(formatStamp(Number.NaN)).toBe("unknown")
  })
})
