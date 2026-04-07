import { test, expect, describe } from "bun:test"
import { claudeCodeParser, geminiCliParser, codexCliParser } from "../../../src/provider/cli/parser"

describe("claudeCodeParser", () => {
  describe("parseComplete", () => {
    test("extracts result event", () => {
      const output = [
        '{"type":"system","apiKeySource":"api_key"}',
        '{"type":"content_block_delta","delta":{"text":"Hello"}}',
        '{"type":"result","result":"Hello world"}',
      ].join("\n")
      expect(claudeCodeParser.parseComplete(output)).toEqual({ text: "Hello world" })
    })

    test("extracts assistant message content", () => {
      const output = [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Part 1"},{"type":"text","text":"Part 2"}]}}',
      ].join("\n")
      expect(claudeCodeParser.parseComplete(output)).toEqual({ text: "Part 1\nPart 2" })
    })

    test("falls back to raw output when no parseable events", () => {
      expect(claudeCodeParser.parseComplete("  just plain text  ")).toEqual({ text: "just plain text" })
    })

    test("skips non-JSON lines", () => {
      const output = [
        "Loading...",
        '{"type":"result","result":"done"}',
        "some trailing text",
      ].join("\n")
      expect(claudeCodeParser.parseComplete(output)).toEqual({ text: "done" })
    })

    test("handles malformed JSON gracefully", () => {
      const output = [
        '{"type":"result", broken',
        '{"type":"result","result":"ok"}',
      ].join("\n")
      expect(claudeCodeParser.parseComplete(output)).toEqual({ text: "ok" })
    })
  })

  describe("parseStreamLine", () => {
    test("extracts content_block_delta text", () => {
      expect(claudeCodeParser.parseStreamLine('{"type":"content_block_delta","delta":{"text":"hi"}}')).toBe("hi")
    })

    test("extracts assistant message text", () => {
      const line = '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}'
      expect(claudeCodeParser.parseStreamLine(line)).toBe("hello")
    })

    test("extracts result string", () => {
      expect(claudeCodeParser.parseStreamLine('{"type":"result","result":"done"}')).toBe("done")
    })

    test("returns null for non-JSON lines", () => {
      expect(claudeCodeParser.parseStreamLine("not json")).toBeNull()
    })

    test("returns null for empty line", () => {
      expect(claudeCodeParser.parseStreamLine("")).toBeNull()
    })

    test("returns null for unrecognized event types", () => {
      expect(claudeCodeParser.parseStreamLine('{"type":"system","apiKeySource":"key"}')).toBeNull()
    })
  })
})

describe("geminiCliParser", () => {
  describe("parseComplete", () => {
    test("extracts result with text field", () => {
      const output = '{"type":"result","text":"Gemini says hello"}'
      expect(geminiCliParser.parseComplete(output)).toEqual({ text: "Gemini says hello" })
    })

    test("extracts result with content field", () => {
      const output = '{"type":"result","content":"response here"}'
      expect(geminiCliParser.parseComplete(output)).toEqual({ text: "response here" })
    })

    test("extracts message content from non-user role", () => {
      const output = '{"type":"message","role":"assistant","content":"hi from assistant"}'
      expect(geminiCliParser.parseComplete(output)).toEqual({ text: "hi from assistant" })
    })

    test("skips user role messages", () => {
      const output = [
        '{"type":"message","role":"user","content":"user prompt"}',
        '{"type":"message","role":"assistant","text":"reply"}',
      ].join("\n")
      expect(geminiCliParser.parseComplete(output)).toEqual({ text: "reply" })
    })

    test("falls back to raw output", () => {
      expect(geminiCliParser.parseComplete("raw text")).toEqual({ text: "raw text" })
    })
  })

  describe("parseStreamLine", () => {
    test("extracts result content", () => {
      expect(geminiCliParser.parseStreamLine('{"type":"result","content":"chunk"}')).toBe("chunk")
    })

    test("extracts result text", () => {
      expect(geminiCliParser.parseStreamLine('{"type":"result","text":"chunk"}')).toBe("chunk")
    })

    test("extracts message content from assistant", () => {
      expect(geminiCliParser.parseStreamLine('{"type":"message","role":"assistant","content":"hi"}')).toBe("hi")
    })

    test("returns null for user message", () => {
      expect(geminiCliParser.parseStreamLine('{"type":"message","role":"user","content":"hi"}')).toBeNull()
    })

    test("returns null for non-JSON", () => {
      expect(geminiCliParser.parseStreamLine("plain text")).toBeNull()
    })
  })
})

describe("codexCliParser", () => {
  describe("parseComplete", () => {
    test("extracts item.completed with text", () => {
      const output = '{"type":"item.completed","item":{"text":"codex response"}}'
      expect(codexCliParser.parseComplete(output)).toEqual({ text: "codex response" })
    })

    test("extracts item.completed with content array", () => {
      const output = '{"type":"item.completed","item":{"content":[{"type":"text","text":"part1"},{"type":"image","url":"x"},{"type":"text","text":"part2"}]}}'
      expect(codexCliParser.parseComplete(output)).toEqual({ text: "part1part2" })
    })

    test("extracts item.completed with string content", () => {
      const output = '{"type":"item.completed","item":{"content":"string content"}}'
      expect(codexCliParser.parseComplete(output)).toEqual({ text: "string content" })
    })

    test("collects content fields from multiple events", () => {
      const output = [
        '{"content":"chunk1"}',
        '{"content":"chunk2"}',
      ].join("\n")
      expect(codexCliParser.parseComplete(output)).toEqual({ text: "chunk1\nchunk2" })
    })

    test("falls back to raw output", () => {
      expect(codexCliParser.parseComplete("raw")).toEqual({ text: "raw" })
    })
  })

  describe("parseStreamLine", () => {
    test("extracts item.completed text", () => {
      expect(codexCliParser.parseStreamLine('{"type":"item.completed","item":{"text":"done"}}')).toBe("done")
    })

    test("extracts item.completed string content", () => {
      expect(codexCliParser.parseStreamLine('{"type":"item.completed","item":{"content":"hello"}}')).toBe("hello")
    })

    test("extracts top-level content", () => {
      expect(codexCliParser.parseStreamLine('{"content":"delta"}')).toBe("delta")
    })

    test("extracts top-level text", () => {
      expect(codexCliParser.parseStreamLine('{"text":"delta"}')).toBe("delta")
    })

    test("returns null for empty line", () => {
      expect(codexCliParser.parseStreamLine("")).toBeNull()
    })
  })
})
