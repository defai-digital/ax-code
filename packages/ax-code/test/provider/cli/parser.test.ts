import { describe, expect, test } from "vitest"
import {
  antigravityCliParser,
  claudeCodeParser,
  CliOutputError,
  codexCliParser,
  grokBuildCliParser,
  kimiCliParser,
  museCliParser,
  parseCliJsonEventLine,
} from "../../../src/provider/cli/parser"

describe("antigravityCliParser", () => {
  const init = JSON.stringify({ event: "init", conversation_id: "root" })
  const step = (type: string, text: unknown, id = "root") =>
    JSON.stringify({
      event: "step_update",
      step_update: { conversation_id: id, step_type: type, state: "ACTIVE", text_delta: text },
    })
  const result = (data: Record<string, unknown> = {}) =>
    JSON.stringify({ event: "result", result: { conversation_id: "root", status: "SUCCESS", ...data } })

  test("streams only root assistant deltas without repeating the final response", () => {
    const lines = [
      init,
      step("user_input", "prompt"),
      step("tool", "private tool data"),
      step("agent_thought", "private reasoning"),
      step("agent_response", "nested", "child"),
      step("agent_response", "Hello "),
      step("agent_response", 42),
      step("agent_response", "世界\n"),
      result({ response: "Hello 世界\n" }),
    ]
    const state = {}
    expect(lines.map((line) => antigravityCliParser.parseStreamLine(line, state) ?? "").join("")).toBe("Hello 世界\n")
    expect(antigravityCliParser.parseComplete(lines.join("\n"))).toEqual({ text: "Hello 世界\n" })
  })

  test("uses the root terminal response when no deltas were emitted", () => {
    expect(antigravityCliParser.parseComplete([init, result({ response: "OK" })].join("\n"))).toEqual({ text: "OK" })
    expect(antigravityCliParser.parseComplete(init)).toEqual({ text: "" })
    expect(antigravityCliParser.parseStreamLine("{bad json")).toBeNull()
    expect(antigravityCliParser.parseStreamLine('{"event":"future"}')).toBeNull()
  })

  test.each([
    { status: "ERROR", error: "authentication required" },
    { status: "CANCELLED" },
    { status: "SUCCESS", finished_reason: "print_timeout" },
    { status: "SUCCESS", finished_reason: "interrupted" },
  ])("surfaces terminal failure $status $finished_reason", (data) => {
    expect(() => antigravityCliParser.parseComplete(result({ response: "partial", ...data }))).toThrow(CliOutputError)
  })

  test("does not accept a truncated stream as a successful answer", () => {
    expect(() => antigravityCliParser.parseComplete([init, step("agent_response", "partial")].join("\n"))).toThrow(
      "ended without a result",
    )
  })

  test("uses root terminal usage without counting per-step usage again", () => {
    const usage = { input_tokens: 100, output_tokens: 26, thinking_tokens: 16, cache_read_tokens: 80 }
    const lines = [
      init,
      JSON.stringify({ event: "step_update", step_update: { step_type: "checkpoint", usage } }),
      result({ response: "OK", usage }),
      result({ conversation_id: "child", response: "nested", usage: { input_tokens: 999, output_tokens: 999 } }),
    ]
    expect(antigravityCliParser.parseComplete(lines.join("\n"))).toEqual({ text: "OK" })
    expect(antigravityCliParser.parseUsage?.(lines.join("\n"))).toEqual({
      inputTokens: 100,
      outputTokens: 26,
      cacheReadTokens: 80,
      reasoningTokens: 16,
    })
    expect(antigravityCliParser.parseUsage?.(result({ usage: { input_tokens: -1, output_tokens: 1 } }))).toBeUndefined()
  })
})

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
    // The final `result` repeats the streamed deltas; returning it would
    // duplicate the answer. Legacy CLIs without partial events are covered by
    // the model's complete-parse fallback when nothing streamed.
    expect(claudeCodeParser.parseStreamLine('{"type":"result","result":"OK"}')).toBeNull()
  })

  test("streams wrapped partial-message text deltas for the top-level conversation only", () => {
    const wrap = (parent: string | null, event: unknown) =>
      JSON.stringify({ type: "stream_event", event, parent_tool_use_id: parent, session_id: "ses_test" })
    const delta = (value: unknown) => ({ type: "content_block_delta", index: 0, delta: value })

    expect(claudeCodeParser.parseStreamLine(wrap(null, delta({ type: "text_delta", text: "ALPHA" })))).toBe("ALPHA")
    expect(claudeCodeParser.parseStreamLine(wrap("toolu_test", delta({ type: "text_delta", text: "SUB" })))).toBeNull()
    // Non-text deltas (for example thinking) are not answer text.
    expect(claudeCodeParser.parseStreamLine(wrap(null, delta({ type: "thinking_delta", thinking: "hmm" })))).toBeNull()
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

  test("does not leak control JSON when no assistant text is present", () => {
    expect(claudeCodeParser.parseComplete('{"type":"system","subtype":"init","session_id":"session_1"}')).toEqual({
      text: "",
    })
  })

  test("surfaces an error result instead of treating it as the answer", () => {
    const output = [
      '{"type":"system","subtype":"init"}',
      '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Claude Code CLI crashed"}',
    ].join("\n")

    expect(() => claudeCodeParser.parseComplete(output)).toThrow(CliOutputError)
    expect(() => claudeCodeParser.parseComplete(output)).toThrow("Claude Code CLI crashed")
    expect(claudeCodeParser.parseStreamLine(output.split("\n")[1]!)).toBeNull()
  })

  test("surfaces an error result without text using a fallback message", () => {
    expect(() => claudeCodeParser.parseComplete('{"type":"result","subtype":"error_max_turns"}')).toThrow(
      "Claude Code CLI reported an error",
    )
    expect(() =>
      claudeCodeParser.parseComplete('{"type":"result","is_error":true,"result":"","error":"authentication failed"}'),
    ).toThrow("authentication failed")
  })
})

describe("provider CLI parser nested content", () => {
  test.each(["reasoning", "command_execution", "mcp_tool_call", "error"])(
    "codex parser excludes %s items from complete and streamed answers",
    (type) => {
      const hidden = JSON.stringify({
        type: "item.completed",
        item: { type, text: "private detail", content: "noise" },
      })
      const answer = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Answer" } })
      expect(codexCliParser.parseComplete([hidden, answer, '{"type":"turn.completed"}'].join("\n"))).toEqual({
        text: "Answer",
      })
      expect(codexCliParser.parseComplete([hidden, '{"type":"turn.completed"}'].join("\n"))).toEqual({ text: "" })
      expect(codexCliParser.parseStreamLine(hidden)).toBeNull()
    },
  )

  test("codex streams assistant content blocks in the same way as complete answers", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", content: [{ type: "text", text: "Answer" }] },
    })
    expect(codexCliParser.parseStreamLine(line)).toBe(codexCliParser.parseComplete(line).text)
  })

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

// Captured from `grok --output-format streaming-json` 1.0.77 (ids/paths removed).
const GROK_STREAMING_JSON_OK = [
  '{"type":"available_commands","tools":["read_file"],"commands":["compact"]}',
  '{"type":"text","data":"ALPHA"}',
  '{"type":"text","data":"\\n"}',
  '{"type":"text","data":"{\\""}',
  '{"type":"text","data":"k"}',
  '{"type":"text","data":"\\":"}',
  '{"type":"text","data":"1"}',
  '{"type":"text","data":"}"}',
  '{"type":"usage","usage":{"input_tokens":7065,"output_tokens":53,"cache_read_input_tokens":10112,"cache_creation_input_tokens":0,"reasoning_tokens":46}}',
  '{"type":"end","stopReason":"end_turn","sessionId":"ses_test","requestId":"req_test"}',
].join("\n")

describe("grokBuildCliParser streaming-json", () => {
  test("concatenates text deltas exactly, including a JSON-looking reply", () => {
    expect(grokBuildCliParser.parseComplete(GROK_STREAMING_JSON_OK)).toEqual({ text: 'ALPHA\n{"k":1}' })

    const streamed = GROK_STREAMING_JSON_OK.split("\n")
      .map((line) => grokBuildCliParser.parseStreamLine(line))
      .filter((delta): delta is string => delta !== null)
      .join("")
    expect(streamed).toBe('ALPHA\n{"k":1}')
  })

  test("an error event throws CliOutputError", () => {
    const output = '{"type":"error","message":"unknown model id","cwd":"/workspace"}'
    expect(() => grokBuildCliParser.parseComplete(output)).toThrow(CliOutputError)
    expect(() => grokBuildCliParser.parseComplete(output)).toThrow("unknown model id")
    expect(() => grokBuildCliParser.parseStreamLine(output)).toThrow("unknown model id")
  })

  test("a structured transcript with no text is empty, not the JSON transport", () => {
    expect(
      grokBuildCliParser.parseComplete(
        '{"type":"available_commands","tools":[],"commands":[]}\n{"type":"end","stopReason":"end_turn"}',
      ),
    ).toEqual({ text: "" })
  })

  test("older plain-text stdout still falls back to raw text", () => {
    expect(grokBuildCliParser.parseComplete("PONG\n")).toEqual({ text: "PONG" })
    expect(grokBuildCliParser.parseComplete('ALPHA\n{"k":1}')).toEqual({ text: 'ALPHA\n{"k":1}' })
    expect(grokBuildCliParser.parseStreamLine("PONG")).toBe("PONG")
    expect(grokBuildCliParser.parseStreamLine('{"k":1}')).toBe('{"k":1}')
  })
})

describe("CLI usage extraction", () => {
  test("grok usage event and end event", () => {
    expect(grokBuildCliParser.parseUsage?.(GROK_STREAMING_JSON_OK)).toEqual({
      inputTokens: 7065 + 10112,
      outputTokens: 53,
      cacheReadTokens: 10112,
      cacheWriteTokens: 0,
      reasoningTokens: 46,
    })
  })

  test("claude final result usage", () => {
    const output = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"OK"}]}}',
      '{"type":"result","subtype":"success","is_error":false,"result":"OK","usage":{"input_tokens":2,"cache_creation_input_tokens":6379,"cache_read_input_tokens":13368,"output_tokens":14,"output_tokens_details":{"thinking_tokens":0}}}',
    ].join("\n")
    expect(claudeCodeParser.parseUsage?.(output)).toEqual({
      inputTokens: 2 + 6379 + 13368,
      outputTokens: 14,
      cacheReadTokens: 13368,
      cacheWriteTokens: 6379,
      reasoningTokens: 0,
    })
  })

  test("codex turn.completed usage (input already includes cache)", () => {
    // Captured from `codex exec --json` (thread id removed).
    const output = [
      '{"type":"thread.started","thread_id":"thread_test"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}',
      '{"type":"turn.completed","usage":{"input_tokens":21089,"cached_input_tokens":12288,"cache_write_input_tokens":0,"output_tokens":6,"reasoning_output_tokens":0}}',
    ].join("\n")
    expect(codexCliParser.parseUsage?.(output)).toEqual({
      inputTokens: 21089,
      outputTokens: 6,
      cacheReadTokens: 12288,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    })
  })

  test("returns undefined when the CLI reports no usage", () => {
    expect(grokBuildCliParser.parseUsage?.("PONG\n")).toBeUndefined()
    expect(claudeCodeParser.parseUsage?.('{"type":"assistant","message":{"content":[]}}')).toBeUndefined()
  })
})

describe("kimiCliParser multi-message streaming", () => {
  test("separates distinct assistant messages but not within one message", () => {
    const state = {}
    expect(kimiCliParser.parseStreamLine('{"role":"assistant","content":"Let me check."}', state)).toBe("Let me check.")
    expect(kimiCliParser.parseStreamLine('{"role":"tool","content":"file1.py"}', state)).toBeNull()
    expect(kimiCliParser.parseStreamLine('{"role":"assistant","content":"There is one Python file."}', state)).toBe(
      "\n\nThere is one Python file.",
    )
    // parseComplete intentionally keeps only the final answer.
    const output = [
      '{"role":"assistant","content":"Let me check."}',
      '{"role":"tool","tool_call_id":"tc_1","content":"file1.py"}',
      '{"role":"assistant","content":"There is one Python file."}',
    ].join("\n")
    expect(kimiCliParser.parseComplete(output)).toEqual({ text: "There is one Python file." })
  })
})

describe("museCliParser terminal event", () => {
  test("recognizes run.terminal.completed as terminal", () => {
    expect(
      museCliParser.isTerminalEvent?.(
        '{"payload_type":"run.terminal.completed","payload":{"terminal":"completed","text":"PONG"}}',
      ),
    ).toBe(true)
    expect(museCliParser.isTerminalEvent?.('{"payload_type":"run.output.delta","payload":{"text":"PONG"}}')).toBe(false)
    expect(museCliParser.isTerminalEvent?.("plain text")).toBe(false)
  })

  test("does not treat a failed terminal as a clean terminal event", () => {
    expect(
      museCliParser.isTerminalEvent?.(
        '{"payload_type":"run.terminal.completed","payload":{"terminal":"failed","reason":"boom"}}',
      ),
    ).toBe(false)
    expect(museCliParser.isTerminalEvent?.('{"payload_type":"run.terminal.failed","payload":{"reason":"boom"}}')).toBe(
      false,
    )
  })

  test("providers without a terminal event do not opt in", () => {
    expect(claudeCodeParser.isTerminalEvent).toBeUndefined()
    expect(codexCliParser.isTerminalEvent).toBeUndefined()
  })
})
