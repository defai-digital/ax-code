import { describe, expect, test } from "bun:test"
import { parseStashLine } from "../../../src/cli/cmd/tui/component/prompt/stash-util"

describe("prompt stash persistence", () => {
  test("parses valid stash jsonl rows", () => {
    expect(
      parseStashLine(
        JSON.stringify({
          id: "stash-1",
          input: "hello",
          parts: [{ type: "text", text: "hello" }],
          timestamp: 1234,
          extra: true,
        }),
        () => "generated",
      ),
    ).toEqual({
      id: "stash-1",
      input: "hello",
      parts: [{ type: "text", text: "hello" }],
      timestamp: 1234,
    })
  })

  test("generates missing stash ids while preserving valid payloads", () => {
    expect(
      parseStashLine(
        JSON.stringify({
          input: "hello",
          parts: [{ type: "text", text: "hello" }],
          timestamp: 1234,
        }),
        () => "generated",
      )?.id,
    ).toBe("generated")

    expect(
      parseStashLine(
        JSON.stringify({
          id: 123,
          input: "hello",
          parts: [{ type: "text", text: "hello" }],
          timestamp: 1234,
        }),
        () => "generated",
      )?.id,
    ).toBe("generated")
  })

  test("rejects malformed stash jsonl rows", () => {
    expect(parseStashLine("not json", () => "generated")).toBeUndefined()
    expect(
      parseStashLine(JSON.stringify({ id: "stash-1", input: 1, parts: [], timestamp: 1 }), () => "x"),
    ).toBeUndefined()
    expect(
      parseStashLine(JSON.stringify({ id: "stash-1", input: "hi", parts: "bad", timestamp: 1 }), () => "x"),
    ).toBeUndefined()
    expect(
      parseStashLine(
        JSON.stringify({ id: "stash-1", input: "hi", parts: [{ text: "missing type" }], timestamp: 1 }),
        () => "x",
      ),
    ).toBeUndefined()
    expect(
      parseStashLine(JSON.stringify({ id: "stash-1", input: "hi", parts: [], timestamp: -1 }), () => "x"),
    ).toBeUndefined()
    expect(parseStashLine(JSON.stringify(["stash-1", "hi"]), () => "x")).toBeUndefined()
  })
})
