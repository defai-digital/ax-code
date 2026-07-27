import { describe, expect, test } from "vitest"

import {
  buildTaskSessionMessagesSignature,
  buildTaskSummaryEntriesFromSession,
  getTaskSummaryLabel,
  normalizeTaskSummaryEntries,
  parseTaskMetadataBlock,
  readTaskSessionIdFromOutput,
  readTaskSessionIdFromRecord,
  shouldRenderGitPathLabel,
  stripTaskMetadataFromOutput,
  type SessionMessageWithParts,
} from "./taskToolSummary"

function messageRecord(
  info: Record<string, unknown>,
  parts: Array<Record<string, unknown>>,
): SessionMessageWithParts {
  return { info, parts } as SessionMessageWithParts
}

describe("parseTaskMetadataBlock", () => {
  test("returns empty results for missing or blank output", () => {
    expect(parseTaskMetadataBlock(undefined)).toEqual({ summaryEntries: [] })
    expect(parseTaskMetadataBlock("")).toEqual({ summaryEntries: [] })
    expect(parseTaskMetadataBlock("no metadata here")).toEqual({ summaryEntries: [] })
  })

  test("returns empty entries for malformed JSON blocks", () => {
    expect(parseTaskMetadataBlock("<task_metadata>not json</task_metadata>")).toEqual({ summaryEntries: [] })
    expect(parseTaskMetadataBlock("<task_metadata>   </task_metadata>")).toEqual({ summaryEntries: [] })
  })

  test("parses session id and summary entries from the block", () => {
    const output = [
      "task output",
      '<task_metadata>{"sessionId":" session-1 ","summary":[{"tool":"bash","state":{"status":"completed","title":"ls"}}]}</task_metadata>',
    ].join("\n")

    const parsed = parseTaskMetadataBlock(output)

    expect(parsed.sessionId).toBe("session-1")
    expect(parsed.summaryEntries).toEqual([{ id: undefined, tool: "bash", state: { status: "completed", title: "ls", input: undefined } }])
  })

  test("falls back to sessionID and alternate summary keys", () => {
    const parsed = parseTaskMetadataBlock('<task_metadata>{"sessionID":"S2","calls":["did a thing"]}</task_metadata>')

    expect(parsed.sessionId).toBe("S2")
    expect(parsed.summaryEntries).toEqual([
      { id: undefined, tool: "tool", state: { status: "completed", title: "did a thing", input: undefined } },
    ])
  })
})

describe("stripTaskMetadataFromOutput", () => {
  test("strips a trailing metadata block and trailing whitespace", () => {
    const output = "result text\n\n<task_metadata>{\"sessionId\":\"s\"}</task_metadata>\n  "

    expect(stripTaskMetadataFromOutput(output)).toBe("result text")
  })

  test("keeps metadata blocks that are not trailing", () => {
    const output = "<task_metadata>{}</task_metadata>\nreal output"

    expect(stripTaskMetadataFromOutput(output)).toBe(output)
  })

  test("trims trailing whitespace even without a block", () => {
    expect(stripTaskMetadataFromOutput("hello  \n")).toBe("hello")
  })
})

describe("readTaskSessionIdFromOutput", () => {
  test("prefers the session id from the metadata block", () => {
    const output = 'task_id: wrong\n<task_metadata>{"sessionId":"from-block"}</task_metadata>'

    expect(readTaskSessionIdFromOutput(output)).toBe("from-block")
  })

  test("matches task_id before session id patterns", () => {
    expect(readTaskSessionIdFromOutput("task_id: abc123\nsession_id: xyz")).toBe("abc123")
    expect(readTaskSessionIdFromOutput("Session ID: sess-9 done")).toBe("sess-9")
  })

  test("returns undefined for blank output", () => {
    expect(readTaskSessionIdFromOutput(undefined)).toBeUndefined()
    expect(readTaskSessionIdFromOutput("   ")).toBeUndefined()
    expect(readTaskSessionIdFromOutput("no ids here")).toBeUndefined()
  })
})

describe("readTaskSessionIdFromRecord", () => {
  test("reads and trims sessionID before sessionId", () => {
    expect(readTaskSessionIdFromRecord({ sessionID: " a ", sessionId: "b" })).toBe("a")
    expect(readTaskSessionIdFromRecord({ sessionId: "b" })).toBe("b")
    expect(readTaskSessionIdFromRecord({ sessionID: 5, sessionId: "x" })).toBe("x")
  })

  test("returns undefined for non-record or empty values", () => {
    expect(readTaskSessionIdFromRecord(null)).toBeUndefined()
    expect(readTaskSessionIdFromRecord("session-1")).toBeUndefined()
    expect(readTaskSessionIdFromRecord({ sessionID: "   " })).toBeUndefined()
  })
})

describe("normalizeTaskSummaryEntries", () => {
  test("returns an empty array for non-array input", () => {
    expect(normalizeTaskSummaryEntries(undefined)).toEqual([])
    expect(normalizeTaskSummaryEntries("nope")).toEqual([])
  })

  test("normalizes string entries into completed tool entries", () => {
    expect(normalizeTaskSummaryEntries(["did x"])).toEqual([
      { tool: "tool", state: { status: "completed", title: "did x" } },
    ])
  })

  test("prefers nested state fields and keeps object inputs", () => {
    const entries = normalizeTaskSummaryEntries([
      null,
      "plain",
      { tool: "bash", status: "error", title: "fallback" },
      { id: "i1", tool: "read", state: { status: "running", title: "nested", input: { filePath: "f.ts" } } },
      { state: { input: "not-an-object" } },
    ])

    expect(entries).toEqual([
      { tool: "tool", state: { status: "completed", title: "plain" } },
      { id: undefined, tool: "bash", state: { status: "error", title: "fallback", input: undefined } },
      { id: "i1", tool: "read", state: { status: "running", title: "nested", input: { filePath: "f.ts" } } },
      { id: undefined, tool: "tool", state: { status: undefined, title: undefined, input: undefined } },
    ])
  })
})

describe("getTaskSummaryLabel", () => {
  test("prefers a non-blank title", () => {
    expect(getTaskSummaryLabel({ state: { title: "the title", input: { filePath: "f.ts" } } })).toBe("the title")
  })

  test("falls back to path candidates and then url", () => {
    expect(getTaskSummaryLabel({ state: { title: "  ", input: { filePath: " f.ts " } } })).toBe("f.ts")
    expect(getTaskSummaryLabel({ state: { input: { file_path: "g.ts" } } })).toBe("g.ts")
    expect(getTaskSummaryLabel({ state: { input: { path: "h.ts" } } })).toBe("h.ts")
    expect(getTaskSummaryLabel({ state: { input: { url: " https://example.com " } } })).toBe("https://example.com")
  })

  test("returns an empty string when nothing is usable", () => {
    expect(getTaskSummaryLabel({})).toBe("")
    expect(getTaskSummaryLabel({ state: { input: { filePath: 5 } } })).toBe("")
  })
})

describe("shouldRenderGitPathLabel", () => {
  test("only renders for file-path tools", () => {
    expect(shouldRenderGitPathLabel("bash", "src/a.ts")).toBe(false)
    expect(shouldRenderGitPathLabel("EDIT", "src/a.ts")).toBe(true)
  })

  test("rejects placeholder labels", () => {
    expect(shouldRenderGitPathLabel("apply_patch", "Patch")).toBe(false)
    expect(shouldRenderGitPathLabel("apply_patch", "3 files")).toBe(false)
    expect(shouldRenderGitPathLabel("edit", "   ")).toBe(false)
  })

  test("accepts path-like and file-like labels", () => {
    expect(shouldRenderGitPathLabel("read", "src/a.ts")).toBe(true)
    expect(shouldRenderGitPathLabel("read", "README.md")).toBe(true)
    expect(shouldRenderGitPathLabel("read", ".gitignore")).toBe(true)
    expect(shouldRenderGitPathLabel("read", "src")).toBe(true)
    expect(shouldRenderGitPathLabel("read", "some label!")).toBe(false)
  })
})

describe("buildTaskSummaryEntriesFromSession", () => {
  test("collects tool parts from assistant messages only", () => {
    const messages = [
      messageRecord({ id: "m1", role: "user" }, [
        { id: "p0", type: "tool", tool: "bash", state: { status: "completed", title: "ignored" } },
      ]),
      messageRecord({ id: "m2", role: "assistant" }, [
        { id: "p1", type: "text", text: "hello" },
        { id: "p2", type: "tool", tool: "bash", state: { status: "completed", title: "ls", input: { command: "ls" } } },
        { id: "p3", type: "tool", tool: "task", state: { status: "completed" } },
        { id: "p4", type: "tool", tool: "mcp.todowrite", state: { status: "completed" } },
        { id: "p5", type: "tool", tool: "mcp.read", state: { status: "running", input: "not-an-object" } },
      ]),
    ]

    expect(buildTaskSummaryEntriesFromSession(messages)).toEqual([
      { id: "p2", tool: "bash", state: { status: "completed", title: "ls", input: { command: "ls" } } },
      { id: "p5", tool: "mcp.read", state: { status: "running", title: undefined, input: undefined } },
    ])
  })
})

describe("buildTaskSessionMessagesSignature", () => {
  test("returns 0 for empty message lists", () => {
    expect(buildTaskSessionMessagesSignature([])).toBe("0")
  })

  test("prefers the completed timestamp and describes the tail part", () => {
    const messages = [
      messageRecord({ id: "m1", role: "assistant", time: { created: 5, completed: 9 } }, [
        { id: "p1", type: "text", text: "hello" },
      ]),
    ]

    expect(buildTaskSessionMessagesSignature(messages)).toBe("1:m1:9:1:text:p1:5")
  })

  test("falls back to created timestamps and tool status length", () => {
    const messages = [
      messageRecord({ id: "m1", role: "assistant", time: { created: 5 } }, [
        { id: "p2", type: "tool", state: { status: "running" } },
      ]),
    ]

    expect(buildTaskSessionMessagesSignature(messages)).toBe("1:m1:5:1:tool:p2:7")
  })

  test("handles messages without parts or timestamps", () => {
    const messages = [messageRecord({ id: "m1", role: "assistant" }, [])]

    expect(buildTaskSessionMessagesSignature(messages)).toBe("1:m1:0:0:::0")
  })
})
