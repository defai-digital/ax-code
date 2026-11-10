import { describe, expect, test } from "vitest"
import {
  claudeCodeParser,
  CliOutputError,
  codexCliParser,
  grokBuildCliParser,
  kimiCliParser,
  museCliParser,
  minimaxCliParser,
  parseCliJsonEventLine,
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
  test("codex parser decodes item content blocks without accepting malformed text", () => {
    expect(
      codexCliParser.parseComplete(
        '{"type":"item.completed","item":{"content":[{"type":"text","text":123},{"type":"text","text":"OK"}]}}',
      ),
    ).toEqual({ text: "OK" })
    expect(codexCliParser.parseStreamLine('{"type":"item.completed","item":{"text":123,"content":"OK"}}')).toBe("OK")
  })

  test("codex parser keeps non-fatal error items and returns the completed turn", () => {
    const output = [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Under-development features enabled: chronicle. Under-development features are incomplete and may behave unpredictably. To suppress this warning, set `suppress_unstable_features_warning = true` in /Users/example/.codex/config.toml."}}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Hello"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0}}',
    ].join("\n")

    expect(codexCliParser.parseComplete(output)).toEqual({ text: "Hello" })
    expect(codexCliParser.parseStreamLine(output.split("\n")[1]!)).toBeNull()

    const trailing = [
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Hello"}}',
      '{"type":"item.completed","item":{"id":"item_2","type":"error","message":"model rerouted: a -> b"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0}}',
    ].join("\n")
    expect(codexCliParser.parseComplete(trailing)).toEqual({ text: "Hello" })
  })

  test("codex parser prefers a completed turn over an error Codex retried", () => {
    const output = [
      '{"type":"error","message":"stream disconnected before completion"}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Hello"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0}}',
    ].join("\n")

    expect(codexCliParser.parseComplete(output)).toEqual({ text: "Hello" })
  })

  test("codex parser fails a transcript that never completes", () => {
    const output = [
      '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"config warning"}}',
      '{"type":"error","message":"stream disconnected before completion"}',
    ].join("\n")

    expect(() => codexCliParser.parseComplete(output)).toThrow(CliOutputError)
    expect(() => codexCliParser.parseComplete(output)).toThrow("stream disconnected before completion")
  })

  test("codex parser fails a completed transcript that also reports a failed turn", () => {
    const output = [
      '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"config warning"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Hello"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0}}',
      '{"type":"turn.failed","error":{"message":"turn failed"}}',
    ].join("\n")

    expect(() => codexCliParser.parseComplete(output)).toThrow(CliOutputError)
    expect(() => codexCliParser.parseComplete(output)).toThrow("turn failed")
  })

  test("codex parser does not expose a warning-only JSONL transcript as assistant text", () => {
    const output = [
      '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"config warning"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0}}',
    ].join("\n")

    expect(codexCliParser.parseComplete(output)).toEqual({ text: "" })
  })

  test("codex parser surfaces terminal JSON error events instead of treating them as assistant text", () => {
    const output = [
      '{"type":"error","message":"{\\"type\\":\\"error\\",\\"error\\":{\\"message\\":\\"The selected model requires a newer Codex CLI\\"}}"}',
      '{"type":"turn.failed","error":{"message":"{\\"type\\":\\"error\\",\\"error\\":{\\"message\\":\\"The selected model requires a newer Codex CLI\\"}}"}}',
    ].join("\n")

    expect(() => codexCliParser.parseComplete(output)).toThrow(CliOutputError)
    expect(() => codexCliParser.parseComplete(output)).toThrow("The selected model requires a newer Codex CLI")
  })
})

describe("provider CLI raw stream text", () => {
  test("grok and kimi parsers preserve whitespace in non-JSON stream lines", () => {
    expect(grokBuildCliParser.parseStreamLine("  indented output  ")).toBe("  indented output  ")
    expect(kimiCliParser.parseStreamLine("  indented output  ")).toBe("  indented output  ")
  })

  test("raw complete fallback preserves model whitespace", () => {
    expect(claudeCodeParser.parseComplete("  indented output  \n")).toEqual({ text: "  indented output  " })
    expect(codexCliParser.parseComplete("  indented output  \n")).toEqual({ text: "  indented output  " })
    expect(grokBuildCliParser.parseComplete("  indented output  \n")).toEqual({ text: "  indented output  " })
    expect(kimiCliParser.parseComplete("  indented output  \n")).toEqual({ text: "  indented output  " })
    expect(museCliParser.parseComplete("  indented output  \n")).toEqual({ text: "  indented output  " })
    expect(minimaxCliParser.parseComplete("  indented output  \n")).toEqual({ text: "  indented output  " })
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

describe("museCliParser", () => {
  test("concatenates output deltas and ignores control events", () => {
    const output = [
      '{"payload_type":"runtime.command.accepted","payload":{"kind":"command_accepted"}}',
      '{"payload_type":"run.output.delta","payload":{"kind":"run_output_delta","text":"Hello "}}',
      '{"payload_type":"task.lifecycle.started","payload":{"kind":"task_lifecycle"}}',
      '{"payload_type":"run.output.delta","payload":{"kind":"run_output_delta","text":"world"}}',
      '{"payload_type":"run.terminal.completed","payload":{"kind":"run_terminal","terminal":"completed","text":"Hello world"}}',
    ].join("\n")

    expect(museCliParser.parseComplete(output)).toEqual({ text: "Hello world" })
  })

  test("streams only output deltas", () => {
    expect(museCliParser.parseStreamLine('{"payload_type":"run.output.delta","payload":{"text":"OK"}}')).toBe("OK")
    expect(
      museCliParser.parseStreamLine(
        '{"payload_type":"run.terminal.completed","payload":{"terminal":"completed","text":"OK"}}',
      ),
    ).toBeNull()
    expect(museCliParser.parseStreamLine('{"payload_type":"task.lifecycle.started","payload":{}}')).toBeNull()
    expect(museCliParser.parseStreamLine("muse: workspace root: /tmp")).toBeNull()
  })

  test("falls back to terminal text when no deltas were emitted", () => {
    expect(
      museCliParser.parseComplete(
        '{"payload_type":"run.terminal.completed","payload":{"terminal":"completed","text":"OK\\n"}}',
      ),
    ).toEqual({ text: "OK\n" })
  })

  test("does not leak control JSON when no assistant text is present", () => {
    expect(
      museCliParser.parseComplete('{"payload_type":"runtime.command.accepted","payload":{"kind":"command_accepted"}}'),
    ).toEqual({ text: "" })
  })

  test("surfaces a failed terminal as a CLI output error", () => {
    const output = [
      '{"payload_type":"run.output.delta","payload":{"text":"partial"}}',
      '{"payload_type":"run.terminal.completed","payload":{"terminal":"failed","reason":"authentication required"}}',
    ].join("\n")

    expect(() => museCliParser.parseComplete(output)).toThrow(CliOutputError)
    expect(() => museCliParser.parseComplete(output)).toThrow("authentication required")
    expect(() =>
      museCliParser.parseComplete('{"payload_type":"run.terminal.failed","payload":{"reason":"login required"}}'),
    ).toThrow("login required")
  })
})

describe("minimaxCliParser", () => {
  test("keeps the last assistant message and ignores tool items", () => {
    const output = [
      '{"type":"exec.started","schemaVersion":1}',
      '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"ls"}}',
      '{"type":"item.completed","item":{"id":"item_2","type":"assistant_message","text":"Hello world"}}',
      '{"type":"exec.completed","status":"succeeded","output":"Hello world"}',
    ].join("\n")

    expect(minimaxCliParser.parseComplete(output)).toEqual({ text: "Hello world" })
  })

  test("falls back to exec.result output when no assistant item is present", () => {
    expect(
      minimaxCliParser.parseComplete('{"schemaVersion":1,"type":"exec.result","status":"succeeded","output":"OK\\n"}'),
    ).toEqual({ text: "OK\n" })
  })

  test("streams assistant item deltas and does not replay item.completed text", () => {
    expect(
      minimaxCliParser.parseStreamLine(
        '{"type":"item.updated","item":{"id":"item_2","type":"assistant_message","delta":"OK"}}',
      ),
    ).toBe("OK")
    expect(
      minimaxCliParser.parseStreamLine(
        '{"type":"item.completed","item":{"id":"item_2","type":"assistant_message","text":"OK"}}',
      ),
    ).toBeNull()
    expect(minimaxCliParser.parseStreamLine('{"type":"exec.started","schemaVersion":1}')).toBeNull()
    expect(
      minimaxCliParser.parseStreamLine(
        '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"ls"}}',
      ),
    ).toBeNull()
  })

  test("does not leak control JSON when no assistant text is present", () => {
    expect(minimaxCliParser.parseComplete('{"type":"exec.started","schemaVersion":1}')).toEqual({ text: "" })
  })

  test("surfaces a failed exec result as a CLI output error", () => {
    expect(() =>
      minimaxCliParser.parseComplete(
        '{"type":"exec.result","status":"failed","error":{"message":"authentication required"}}',
      ),
    ).toThrow(CliOutputError)
    expect(() => minimaxCliParser.parseComplete('{"type":"turn.failed","error":{"message":"login required"}}')).toThrow(
      "login required",
    )
  })
})

