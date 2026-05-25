import { describe, expect, test } from "bun:test"
import { claudeCodeParser, codexCliParser, geminiCliParser, parseCliJsonEventLine } from "../../../src/provider/cli/parser"

describe("claudeCodeParser", () => {
  test("decodes CLI JSON event lines with non-JSON fallback", () => {
    expect(parseCliJsonEventLine('  {"type":"result","result":"OK"}  ')).toEqual({
      type: "result",
      result: "OK",
    })
    expect(parseCliJsonEventLine("plain text")).toBeUndefined()
    expect(parseCliJsonEventLine("{not json")).toBeUndefined()
    expect(parseCliJsonEventLine("")).toBeUndefined()
  })

  test("streams delta events without duplicating final assistant output", () => {
    expect(claudeCodeParser.parseStreamLine('{"type":"content_block_delta","delta":{"text":"OK"}}')).toBe("OK")
    expect(
      claudeCodeParser.parseStreamLine('{"type":"assistant","message":{"content":[{"type":"text","text":"OK"}]}}'),
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

  test("ignores malformed nested assistant content blocks", () => {
    const output = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":123},{"type":"image","text":"ignored"}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"OK"}]}}',
    ].join("\n")

    expect(claudeCodeParser.parseComplete(output)).toEqual({ text: "OK" })
    expect(claudeCodeParser.parseStreamLine('{"type":"content_block_delta","delta":{"text":123}}')).toBeNull()
  })
})

describe("provider CLI parser nested content", () => {
  test("gemini parser narrows text fields before returning them", () => {
    expect(geminiCliParser.parseStreamLine('{"type":"message","role":"assistant","content":123,"text":"OK"}')).toBe("OK")
    expect(geminiCliParser.parseStreamLine('{"type":"message","role":"assistant","content":123,"text":false}')).toBeNull()
  })

  test("codex parser decodes item content blocks without accepting malformed text", () => {
    expect(
      codexCliParser.parseComplete(
        '{"type":"item.completed","item":{"content":[{"type":"text","text":123},{"type":"text","text":"OK"}]}}',
      ),
    ).toEqual({ text: "OK" })
    expect(codexCliParser.parseStreamLine('{"type":"item.completed","item":{"text":123,"content":"OK"}}')).toBe("OK")
  })
})
