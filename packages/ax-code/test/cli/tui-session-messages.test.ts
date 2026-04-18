import { describe, expect, test } from "bun:test"
import {
  lastUserMessageID,
  promptState,
  redoMessageID,
  undoMessageID,
} from "../../src/cli/cmd/tui/routes/session/messages"

describe("tui session message helpers", () => {
  test("finds the last user message with visible text", () => {
    expect(
      lastUserMessageID(
        [
          { id: "a", role: "user" },
          { id: "b", role: "assistant" },
          { id: "c", role: "user" },
        ],
        {
          a: [{ type: "text", synthetic: true }],
          c: [{ type: "text", text: "hello" }],
        },
      ),
    ).toBe("c")
  })

  test("selects the correct undo target before the revert marker", () => {
    expect(
      undoMessageID(
        [
          { id: "a", role: "user" },
          { id: "b", role: "assistant" },
          { id: "c", role: "user" },
        ],
        "c",
      ),
    ).toBe("a")
  })

  test("selects the correct redo target after the revert marker", () => {
    expect(
      redoMessageID(
        [
          { id: "a", role: "user" },
          { id: "b", role: "assistant" },
          { id: "c", role: "user" },
        ],
        "a",
      ),
    ).toBe("c")
  })

  test("reconstructs prompt state from text, file, and agent parts", () => {
    expect(
      promptState([
        { type: "text", text: "hello " },
        { type: "text", text: "hidden", synthetic: true },
        { type: "text", text: "ignored", ignored: true },
        { type: "file", filename: "a.ts", url: "file:///a.ts", mime: "text/plain" },
        {
          type: "agent",
          name: "reviewer",
          source: { start: 6, end: 15, value: "@reviewer" },
        },
        { type: "text", text: "world" },
      ]),
    ).toMatchObject({
      input: "hello world",
      parts: [{ type: "file", filename: "a.ts" }, { type: "agent", name: "reviewer" }],
    })
  })
})
