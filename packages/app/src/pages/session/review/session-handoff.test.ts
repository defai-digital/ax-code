import { describe, expect, test } from "bun:test"
import {
  copyText,
  getAssistantSummary,
  getDiffKind,
  getFirstLine,
  getHandoffChecks,
  getHandoffFlags,
  getHandoffOpen,
  getHandoffRisks,
  getHandoffSummary,
  getHandoffSteps,
  getHandoffText,
  getHandoffTitle,
  getHandoffVisible,
} from "./session-handoff"

describe("getFirstLine", () => {
  test("collapses whitespace", () => {
    expect(getFirstLine("  hello \n world  ")).toBe("hello world")
  })

  test("truncates long text", () => {
    const text = "x".repeat(260)
    expect(getFirstLine(text)?.length).toBe(222)
    expect(getFirstLine(text)?.endsWith("...")).toBe(true)
  })
})

describe("getAssistantSummary", () => {
  test("prefers non-synthetic text content", () => {
    const out = getAssistantSummary([
      { type: "text", text: "ignore me", synthetic: true },
      { type: "text", text: "hello\n\nworld" },
    ])

    expect(out).toBe("hello")
  })
})

describe("getDiffKind", () => {
  test("infers added and deleted changes", () => {
    expect(getDiffKind({ file: "a", after: "x" })).toBe("added")
    expect(getDiffKind({ file: "a", before: "x" })).toBe("deleted")
    expect(getDiffKind({ file: "a", before: "x", after: "y" })).toBe("modified")
  })
})

describe("handoff helpers", () => {
  const t = (key: string, vars?: Record<string, string | number | boolean>) => {
    if (key === "session.handoff.open.deleted") return "deleted files need review"
    if (key === "session.handoff.open.config") return "config changed"
    if (key === "session.handoff.open.added") return "new files added"
    if (key === "session.handoff.open.generic") return "check main risks"
    if (key === "session.handoff.verify.review") return "review changed files"
    if (key === "session.handoff.verify.deleted") return "verify deletions"
    if (key === "session.handoff.verify.config") return "verify config"
    if (key === "session.handoff.verify.checks") return "run checks"
    if (key === "session.handoff.verify.command") return `run ${vars?.command}`
    return key
  }

  test("derives flags and risks from diffs", () => {
    const flags = getHandoffFlags([
      { file: "package.json", before: "a", after: "b" },
      { file: "src/a.ts", before: "a" },
    ])

    expect(flags).toEqual({ config: true, deleted: true, added: false })
    expect(getHandoffRisks(["finish docs"], flags, t)).toEqual([
      "finish docs",
      "deleted files need review",
      "config changed",
    ])
  })

  test("deduplicates checks and builds steps", () => {
    const checks = getHandoffChecks(
      [{ command: "pnpm test", title: "Tests" }],
      [
        { id: "a", title: "Tests", command: "pnpm test" },
        { id: "b", title: "Lint", command: "pnpm lint" },
      ],
    )

    expect(checks.map((item) => item.command)).toEqual(["pnpm test", "pnpm lint"])
    expect(getHandoffSteps({ config: false, deleted: false, added: false }, checks, t)).toEqual([
      "review changed files",
      "run pnpm test",
      "run pnpm lint",
    ])
  })

  test("filters open todo items and builds copy text", () => {
    expect(
      getHandoffOpen([
        { status: "open", content: " ship it " },
        { status: "completed", content: "done" },
      ]),
    ).toEqual(["ship it"])

    expect(
      getHandoffText({
        eyebrow: "Handoff",
        title: "Title",
        summary: "Summary",
        stats: "1 file changed",
        openTitle: "Open",
        risks: ["risk"],
        verifyTitle: "Verify",
        steps: ["step"],
      }),
    ).toContain("Handoff: Title")
  })

  test("copies text through the DOM fallback", async () => {
    const exec = document.execCommand
    document.body.innerHTML = ""
    ;(document as Document & { execCommand: (cmd: string) => boolean }).execCommand = (cmd: string) => cmd === "copy"
    try {
      await expect(copyText("hello")).resolves.toBe(true)
      expect(document.querySelector("textarea")).toBeNull()
    } finally {
      ;(document as Document & { execCommand?: typeof exec }).execCommand = exec
    }
  })

  test("derives handoff visibility, title, and summary", () => {
    expect(
      getHandoffVisible({
        sessionID: "s",
        messagesReady: true,
        hasReview: true,
        lastUserID: "u1",
        busy: false,
      }),
    ).toBe(true)
    expect(
      getHandoffVisible({
        sessionID: "s",
        messagesReady: true,
        hasReview: true,
        busy: false,
      }),
    ).toBe(false)

    expect(
      getHandoffTitle({
        user: { id: "u1", summary: { title: " Ship it ", body: "Body" } },
        sessionTitle: "Session",
        fallback: "Fallback",
        line: () => "line",
      }),
    ).toBe("Ship it")

    expect(
      getHandoffTitle({
        user: { id: "u1", summary: { body: "Explain this" } },
        sessionTitle: "Session",
        fallback: "Fallback",
        line: () => "line",
      }),
    ).toBe("Explain this")

    expect(
      getHandoffTitle({
        user: { id: "u1" },
        sessionTitle: "Session",
        fallback: "Fallback",
        line: () => "line text",
      }),
    ).toBe("line text")

    expect(
      getHandoffSummary({
        user: { summary: { body: "Body text" } },
        title: "Title",
        assistant: "Assistant",
      }),
    ).toBe("Body text")

    expect(
      getHandoffSummary({
        user: { summary: { body: "Title" } },
        title: "Title",
        assistant: "Assistant",
      }),
    ).toBe("Assistant")
  })
})
