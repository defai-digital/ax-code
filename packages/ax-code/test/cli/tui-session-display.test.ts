import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Part, UserMessage } from "@ax-code/sdk/v2"
import { lastAssistantText, scrollDelta, scrollTo, transcriptItems } from "../../src/cli/cmd/tui/routes/session/display"

function user(id: string): UserMessage {
  return {
    id,
    sessionID: "s",
    role: "user",
    time: { created: 1 },
    agent: "main",
    model: {
      providerID: "openai",
      modelID: "gpt-5",
    },
  }
}

function assistant(id: string, parentID = "u"): AssistantMessage {
  return {
    id,
    sessionID: "s",
    role: "assistant",
    time: { created: 1, completed: 2 },
    parentID,
    modelID: "gpt-5",
    providerID: "openai",
    mode: "chat",
    agent: "main",
    path: {
      cwd: "/tmp",
      root: "/tmp",
    },
    tokens: {
      input: 1,
      output: 1,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
  }
}

function text(id: string, messageID: string, value: string): Part {
  return {
    id,
    sessionID: "s",
    messageID,
    type: "text",
    text: value,
  }
}

describe("tui session display helpers", () => {
  test("computes scroll deltas for viewport actions", () => {
    expect(scrollDelta("page-up", 100)).toBe(-50)
    expect(scrollDelta("page-down", 100)).toBe(50)
    expect(scrollDelta("line-up", 100)).toBe(-1)
    expect(scrollDelta("line-down", 100)).toBe(1)
    expect(scrollDelta("half-page-up", 100)).toBe(-25)
    expect(scrollDelta("half-page-down", 100)).toBe(25)
  })

  test("computes absolute scroll targets", () => {
    expect(scrollTo("first", 999)).toBe(0)
    expect(scrollTo("last", 999)).toBe(999)
  })

  test("extracts last assistant text before revert marker", () => {
    expect(
      lastAssistantText(
        [
          assistant("a"),
          assistant("b"),
          user("c"),
        ],
        {
          a: [text("p1", "a", "old")],
          b: [text("p2", "b", "new")],
        },
        "c",
      ),
    ).toEqual({ text: "new" })
  })

  test("returns an error when no assistant text is available", () => {
    expect(lastAssistantText([user("a")], {}, undefined)).toEqual({
      error: "No assistant messages found",
    })
    expect(
      lastAssistantText(
        [assistant("a")],
        {
          a: [
            {
              type: "tool",
            },
          ],
        },
        undefined,
      ),
    ).toEqual({
      error: "No text content found in last assistant message",
    })
  })

  test("builds transcript items with part fallback", () => {
    expect(
      transcriptItems(
        [
          user("a"),
          assistant("b"),
        ],
        { a: [text("p1", "a", "hello")] },
      ),
    ).toEqual([
      { info: user("a"), parts: [text("p1", "a", "hello")] },
      { info: assistant("b"), parts: [] },
    ])
  })
})
