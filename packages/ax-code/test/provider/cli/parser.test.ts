import { describe, expect, test } from "vitest"
import {
  antigravityCliParser,
  claudeCodeParser,
  CliOutputError,
  codexCliParser,
  geminiCliParser,
  grokBuildCliParser,
  kimiCliParser,
  parseCliJsonEventLine,
  qoderCliParser,
} from "../../../src/provider/cli/parser"

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
    expect(geminiCliParser.parseStreamLine('{"type":"message","role":"assistant","content":123,"text":"OK"}')).toBe(
      "OK",
    )
    expect(
      geminiCliParser.parseStreamLine('{"type":"message","role":"assistant","content":123,"text":false}'),
    ).toBeNull()
  })

  test("codex parser decodes item content blocks without accepting malformed text", () => {
    expect(
      codexCliParser.parseComplete(
        '{"type":"item.completed","item":{"content":[{"type":"text","text":123},{"type":"text","text":"OK"}]}}',
      ),
    ).toEqual({ text: "OK" })
    expect(codexCliParser.parseStreamLine('{"type":"item.completed","item":{"text":123,"content":"OK"}}')).toBe("OK")
  })

  test("codex parser surfaces JSON error events instead of treating them as assistant text", () => {
    const output = [
      '{"type":"item.completed","item":{"type":"error","message":"Model metadata is unavailable"}}',
      '{"type":"error","message":"{\\"type\\":\\"error\\",\\"error\\":{\\"message\\":\\"The selected model requires a newer Codex CLI\\"}}"}',
      '{"type":"turn.failed","error":{"message":"{\\"type\\":\\"error\\",\\"error\\":{\\"message\\":\\"The selected model requires a newer Codex CLI\\"}}"}}',
    ].join("\n")

    expect(() => codexCliParser.parseComplete(output)).toThrow(CliOutputError)
    expect(() => codexCliParser.parseComplete(output)).toThrow("The selected model requires a newer Codex CLI")
  })
})

describe("provider CLI raw stream text", () => {
  test("qoder, grok, and antigravity parsers preserve whitespace in non-JSON stream lines", () => {
    expect(qoderCliParser.parseStreamLine("  indented output  ")).toBe("  indented output  ")
    expect(grokBuildCliParser.parseStreamLine("  indented output  ")).toBe("  indented output  ")
    expect(antigravityCliParser.parseStreamLine("  indented output  ")).toBe("  indented output  ")
    expect(kimiCliParser.parseStreamLine("  indented output  ")).toBe("  indented output  ")
  })

  test("raw complete fallback preserves model whitespace", () => {
    expect(claudeCodeParser.parseComplete("  indented output  \n")).toEqual({ text: "  indented output  " })
    expect(geminiCliParser.parseComplete("  indented output  \n")).toEqual({ text: "  indented output  " })
    expect(codexCliParser.parseComplete("  indented output  \n")).toEqual({ text: "  indented output  " })
    expect(qoderCliParser.parseComplete("  indented output  \n")).toEqual({ text: "  indented output  " })
    expect(grokBuildCliParser.parseComplete("  indented output  \n")).toEqual({ text: "  indented output  " })
    expect(antigravityCliParser.parseComplete("  indented output  \n")).toEqual({ text: "  indented output  " })
    expect(kimiCliParser.parseComplete("  indented output  \n")).toEqual({ text: "  indented output  " })
  })
})

describe("kimiCliParser", () => {
  test("keeps only assistant messages and ignores tool/meta noise", () => {
    const output = [
      '{"role":"assistant","content":"Let me check.","tool_calls":[{"type":"function","id":"tc_1"}]}',
      '{"role":"tool","tool_call_id":"tc_1","content":"file1.py"}',
      '{"role":"assistant","content":"There is one Python file."}',
      '{"role":"meta","type":"session.resume_hint","content":"To resume this session: kimi -r session_x"}',
    ].join("\n")

    expect(kimiCliParser.parseComplete(output)).toEqual({ text: "There is one Python file." })
  })

  test("streams assistant content and skips meta lines", () => {
    expect(kimiCliParser.parseStreamLine('{"role":"assistant","content":"OK."}')).toBe("OK.")
    expect(
      kimiCliParser.parseStreamLine(
        '{"role":"meta","type":"session.resume_hint","content":"To resume this session: kimi -r session_x"}',
      ),
    ).toBeNull()
    expect(kimiCliParser.parseStreamLine('{"role":"tool","tool_call_id":"tc_1","content":"stdout"}')).toBeNull()
  })

  test("supports array-form assistant content blocks", () => {
    expect(
      kimiCliParser.parseStreamLine(
        '{"role":"assistant","content":[{"type":"text","text":"Hello "},{"type":"text","text":"world"}]}',
      ),
    ).toBe("Hello world")
  })

  test("does not leak meta or tool JSON when no assistant text is present", () => {
    expect(
      kimiCliParser.parseComplete(
        '{"role":"meta","type":"session.resume_hint","content":"To resume this session: kimi -r session_x"}',
      ),
    ).toEqual({ text: "" })

    const toolOnly = [
      '{"role":"assistant","content":"","tool_calls":[{"type":"function","id":"tc_1"}]}',
      '{"role":"tool","tool_call_id":"tc_1","content":"file1.py"}',
      '{"role":"meta","content":"To resume this session: kimi -r session_x"}',
    ].join("\n")
    expect(kimiCliParser.parseComplete(toolOnly)).toEqual({ text: "" })
  })
})
