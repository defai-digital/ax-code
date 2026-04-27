import { describe, expect, test } from "bun:test"
import type { Part, TextPart, ToolPart } from "@ax-code/sdk/v2"
import { groupParts, partDefaultOpen, relativizeProjectPath, renderable, sessionLink, urls } from "./message-part.logic"

function tool(tool: string, status: ToolPart["state"]["status"]): ToolPart {
  if (status === "pending") {
    return {
      id: `part_${tool}_${status}`,
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool",
      callID: "call_1",
      tool,
      state: { status, input: {}, raw: "" },
    }
  }

  if (status === "running") {
    return {
      id: `part_${tool}_${status}`,
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool",
      callID: "call_1",
      tool,
      state: { status, input: {}, time: { start: 1 } },
    }
  }

  if (status === "error") {
    return {
      id: `part_${tool}_${status}`,
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool",
      callID: "call_1",
      tool,
      state: {
        status,
        input: {},
        error: "boom",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    }
  }

  return {
    id: `part_${tool}_${status}`,
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool",
    callID: "call_1",
    tool,
    state: {
      status,
      input: {},
      output: "ok",
      title: "done",
      metadata: {},
      time: { start: 1, end: 2 },
    },
  }
}

function text(text: string): TextPart {
  return {
    id: "part_text",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "text",
    text,
  }
}

describe("message-part.logic", () => {
  test("relativizes project paths and trims the shared prefix", () => {
    expect(relativizeProjectPath("/repo/src/file.ts", "/repo")).toBe("/src/file.ts")
    expect(relativizeProjectPath("/repo", "/repo")).toBe("")
    expect(relativizeProjectPath("C:\\repo\\src\\file.ts", "C:\\repo")).toBe("\\src\\file.ts")
  })

  test("extracts unique URLs without trailing punctuation", () => {
    expect(
      urls(
        "See https://github.com/defai-digital/ax-code, then https://github.com/defai-digital/ax-code and https://example.com/test.",
      ),
    ).toEqual(["https://github.com/defai-digital/ax-code", "https://example.com/test"])
  })

  test("builds session links from the current route or custom href builder", () => {
    expect(sessionLink("ses_2", "/workspace/session/ses_1")).toBe("/workspace/session/ses_2")
    expect(sessionLink("ses_2", "/workspace/chat", (id) => `/custom/${id}`)).toBe("/custom/ses_2")
    expect(sessionLink("ses_2", "/workspace/chat")).toBeUndefined()
  })

  test("groups consecutive context tools and leaves other parts alone", () => {
    const parts = groupParts([
      { messageID: "msg_1", part: tool("read", "completed") },
      { messageID: "msg_1", part: tool("glob", "completed") },
      { messageID: "msg_2", part: text("done") },
      { messageID: "msg_2", part: tool("list", "completed") },
    ])

    expect(parts).toEqual([
      {
        key: "context:part_read_completed",
        type: "context",
        refs: [
          { messageID: "msg_1", partID: "part_read_completed" },
          { messageID: "msg_1", partID: "part_glob_completed" },
        ],
      },
      {
        key: "part:msg_2:part_text",
        type: "part",
        ref: { messageID: "msg_2", partID: "part_text" },
      },
      {
        key: "context:part_list_completed",
        type: "context",
        refs: [{ messageID: "msg_2", partID: "part_list_completed" }],
      },
    ])
  })

  test("filters hidden and empty parts while allowing registered component types", () => {
    const map = { file: {} }
    expect(renderable(tool("todowrite", "completed"), map)).toBe(false)
    expect(renderable(tool("question", "pending"), map)).toBe(false)
    expect(renderable(tool("question", "completed"), map)).toBe(true)
    expect(renderable(text("   "), map)).toBe(false)
    expect(renderable(text("hello"), map)).toBe(true)

    const file = {
      id: "part_file",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "file",
      mime: "text/plain",
      url: "file:///repo/file.txt",
    } satisfies Part
    expect(renderable(file, map)).toBe(true)
  })

  test("opens shell and edit tools only when the matching default is enabled", () => {
    expect(partDefaultOpen(tool("bash", "completed"), true, false)).toBe(true)
    expect(partDefaultOpen(tool("write", "completed"), false, true)).toBe(true)
    expect(partDefaultOpen(tool("write", "completed"), false, false)).toBe(false)
  })
})
