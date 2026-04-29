import { describe, expect, test } from "bun:test"
import { claudeCodeParser } from "../../../src/provider/cli/parser"

describe("claudeCodeParser", () => {
  test("streams delta events without duplicating final assistant output", () => {
    expect(claudeCodeParser.parseStreamLine('{"type":"content_block_delta","delta":{"text":"OK"}}')).toBe("OK")
    expect(
      claudeCodeParser.parseStreamLine(
        '{"type":"assistant","message":{"content":[{"type":"text","text":"OK"}]}}',
      ),
    ).toBeNull()
    expect(claudeCodeParser.parseStreamLine('{"type":"result","result":"OK"}')).toBe("OK")
  })

  test("complete parsing still extracts the final response text", () => {
    const output = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}',
      '{"type":"result","result":"Hello"}',
    ].join("\n")

    expect(claudeCodeParser.parseComplete(output)).toEqual({ text: "Hello" })
  })
})
