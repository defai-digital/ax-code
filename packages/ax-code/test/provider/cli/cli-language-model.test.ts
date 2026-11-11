import { test, expect, describe, vi, beforeEach } from "vitest"
import {
  buildCliCommand,
  CliLanguageModel,
  extractJsonPayload,
  rejectedOptionalCliFlag,
  resetRejectedOptionalCliFlags,
} from "../../../src/provider/cli/cli-language-model"
import { CLI_PROVIDER_DEFINITIONS } from "../../../src/provider/cli/config"
import { claudeCodeParser, grokBuildCliParser, museCliParser, minimaxCliParser } from "../../../src/provider/cli/parser"
import { usageSource } from "../../../src/provider/usage"
import { Process } from "../../../src/util/process"
import { Shell } from "../../../src/shell/shell"
import { existsSync } from "node:fs"
import { PassThrough } from "node:stream"
import { EventEmitter } from "node:events"
import { Instance } from "../../../src/project/instance"
import { tmpdir } from "../../fixture/fixture"

beforeEach(() => resetRejectedOptionalCliFlags())

function failedChild(stderr: string, code = 2, stdout = "") {
  const stdoutStream = new PassThrough()
  const stderrStream = new PassThrough()
  const exited = new Promise<number>((resolve) => {
    setTimeout(() => {
      if (stdout) stdoutStream.write(stdout)
      stdoutStream.end()
      stderrStream.end(stderr)
      resolve(code)
    }, 0)
  })
  return {
    stdout: stdoutStream,
    stderr: stderrStream,
    exited,
    exitCode: null,
    signalCode: null,
    kill: () => true,
    pid: 124,
    stdin: null,
  } as any
}

function museModel(overrides?: Partial<ConstructorParameters<typeof CliLanguageModel>[0]>) {
  return makeModel({
    providerID: "muse-cli",
    modelID: "muse-cli",
    binary: "muse",
    args: ["exec", "--json"],
    optionalArgs: ["--disable-reminders"],
    parser: museCliParser,
    promptMode: "arg",
    promptFlag: "-p",
    ...overrides,
  })
}

const MUSE_OK = '{"payload_type":"run.output.delta","payload":{"text":"PONG"}}\n'
const MUSE_OK_TERMINAL =
  MUSE_OK + '{"payload_type":"run.terminal.completed","payload":{"terminal":"completed","text":"PONG"}}\n'
const MUSE_REJECTED = "error: unexpected argument '--disable-reminders' found\n"

function makeModel(overrides?: Partial<ConstructorParameters<typeof CliLanguageModel>[0]>) {
  return new CliLanguageModel({
    providerID: "test-cli",
    modelID: "test-model",
    binary: "echo",
    args: [],
    parser: claudeCodeParser,
    promptMode: "arg",
    promptFlag: "-p",
    ...overrides,
  })
}

function successfulChild(output = '{"type":"result","result":"ok"}\n') {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const exited = new Promise<number>((resolve) => {
    setTimeout(() => {
      stdout.end(output)
      stderr.end()
      resolve(0)
    }, 0)
  })
  return {
    stdout,
    stderr,
    exited,
    exitCode: null,
    signalCode: null,
    kill: () => true,
    pid: 123,
    stdin: null,
  } as any
}

describe("CliLanguageModel", () => {
  const originalAutonomous = process.env.AX_CODE_AUTONOMOUS

  function restoreAutonomous() {
    if (originalAutonomous === undefined) delete process.env.AX_CODE_AUTONOMOUS
    else process.env.AX_CODE_AUTONOMOUS = originalAutonomous
  }

  test("implements LanguageModelV3 spec", () => {
    const model = makeModel()
    expect(model.specificationVersion).toBe("v3")
    expect(model.provider).toBe("test-cli")
    expect(model.modelId).toBe("test-model")
    expect(model.supportedUrls).toEqual({})
  })

  test("doGenerate returns V3 usage format", async () => {
    // Use a simple echo command that outputs a Claude-format result
    const model = makeModel({
      binary: "echo",
      args: [],
      parser: {
        parseComplete: () => ({ text: "hello" }),
        parseStreamLine: () => null,
      },
      promptMode: "arg",
    })

    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    expect(result.content).toEqual([{ type: "text", text: "hello" }])
    expect(result.finishReason).toEqual({ unified: "stop", raw: undefined })
    expect(result.usage).toEqual({
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    })
    expect(usageSource(result.usage)).toBe("estimated")
    expect(result.warnings).toEqual([])
  })

  test("stays estimated after the AI SDK rebuilds the usage object", async () => {
    const model = makeModel({
      binary: "echo",
      args: [],
      parser: {
        parseComplete: () => ({ text: "hello" }),
        parseStreamLine: () => null,
      },
      promptMode: "arg",
    })
    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    // ai@6 asLanguageModelUsage() builds a fresh object and copies `usage.raw`
    // by reference, dropping the non-enumerable top-level marker. The CLI model
    // mirrors its marker in `raw`, so the rebuilt estimate is not read as exact
    // (which would anchor the token ledger and ratchet the observed window).
    const rebuilt = {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      raw: (result.usage as { raw?: unknown }).raw,
    }
    expect(usageSource(rebuilt)).toBe("estimated")
  })

  test("doStream returns V3 stream with proper events", async () => {
    const model = makeModel({
      binary: "echo",
      args: [],
      parser: {
        parseComplete: () => ({ text: "" }),
        parseStreamLine: (line: string) => line.trim() || null,
      },
      promptMode: "arg",
    })

    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    const parts: any[] = []
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }

    const streamStart = parts.find((p) => p.type === "stream-start")
    expect(streamStart).toBeDefined()
    expect(streamStart.warnings).toEqual([])

    const textStart = parts.find((p) => p.type === "text-start")
    expect(textStart).toBeDefined()
    expect(textStart.id).toBe("cli-0")

    const textEnd = parts.find((p) => p.type === "text-end")
    expect(textEnd).toBeDefined()

    const finish = parts.find((p) => p.type === "finish")
    expect(finish).toBeDefined()
    expect(finish.finishReason).toEqual({ unified: "stop", raw: undefined })
    expect(finish.usage.inputTokens).toEqual({ total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 })
    expect(finish.usage.outputTokens.total).toBeGreaterThan(0)
    expect(finish.usage.outputTokens.text).toBe(finish.usage.outputTokens.total)
    expect(finish.usage.outputTokens.reasoning).toBe(0)
    expect(usageSource(finish.usage)).toBe("estimated")
  })

  test("doStream preserves newlines for plain-text CLI output", async () => {
    await using tmp = await tmpdir()
    // `grok -p` prints plain multi-line text (no JSONL events). The stdout
    // line split must not eat the newlines that carry markdown structure.
    const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => successfulChild("LINE1\nLINE2\n\nLINE3\n"))

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const model = makeModel({ parser: grokBuildCliParser })
          const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
          })
          let text = ""
          const reader = stream.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (value.type === "text-delta") text += value.delta
          }
          expect(text).toBe("LINE1\nLINE2\n\nLINE3\n")
        },
      })
    } finally {
      spawn.mockRestore()
    }
  })

  test("doStream does not inject separators into structured JSONL output", async () => {
    await using tmp = await tmpdir()
    const jsonl =
      '{"type":"content_block_delta","delta":{"text":"Hello"}}\n' +
      '{"type":"content_block_delta","delta":{"text":" world"}}\n'
    const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => successfulChild(jsonl))

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const model = makeModel({ parser: claudeCodeParser })
          const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
          })
          let text = ""
          const reader = stream.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (value.type === "text-delta") text += value.delta
          }
          expect(text).toBe("Hello world")
        },
      })
    } finally {
      spawn.mockRestore()
    }
  })

  test("doStream concatenates grok streaming-json deltas and keeps a JSON-looking reply", async () => {
    await using tmp = await tmpdir()
    const jsonl =
      [
        '{"type":"available_commands","tools":["read_file"],"commands":["compact"]}',
        '{"type":"text","data":"ALPHA"}',
        '{"type":"text","data":"\\n"}',
        '{"type":"text","data":"{\\""}',
        '{"type":"text","data":"k"}',
        '{"type":"text","data":"\\":"}',
        '{"type":"text","data":"1"}',
        '{"type":"text","data":"}"}',
        '{"type":"usage","usage":{"input_tokens":10,"output_tokens":2,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"reasoning_tokens":0}}',
        '{"type":"end","stopReason":"end_turn"}',
      ].join("\n") + "\n"
    const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => successfulChild(jsonl))

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const model = makeModel({ parser: grokBuildCliParser })
          const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
          })
          let text = ""
          let finish: any
          const reader = stream.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (value.type === "text-delta") text += value.delta
            if (value.type === "finish") finish = value
          }
          expect(text).toBe('ALPHA\n{"k":1}')
          expect(finish.usage).toEqual({
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 2, text: 2, reasoning: 0 },
          })
          expect(usageSource(finish.usage)).toBe("exact")
        },
      })
    } finally {
      spawn.mockRestore()
    }
  })

  test("doStream keeps the newline on a plain-text reply line that looks like JSON", async () => {
    await using tmp = await tmpdir()
    const stdout = 'ALPHA\n{"k":1}\ndone\n'
    const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => successfulChild(stdout))

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const model = makeModel({ parser: grokBuildCliParser })
          const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
          })
          let text = ""
          const reader = stream.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (value.type === "text-delta") text += value.delta
          }
          expect(grokBuildCliParser.parseComplete(stdout).text).toBe('ALPHA\n{"k":1}\ndone')
          expect(text).toBe('ALPHA\n{"k":1}\ndone\n')
        },
      })
    } finally {
      spawn.mockRestore()
    }
  })

  test("doStream does not duplicate the unterminated tail when a terminal event arrives", async () => {
    await using tmp = await tmpdir()
    // The terminal event and the unterminated fragment arrive in one chunk, so
    // the fragment is already part of the raw stdout buffer.
    const raw = '{"type":"terminal"}\nTAIL'
    const seen: string[] = []
    const parser = {
      parseComplete: () => ({ text: "" }),
      parseStreamLine: (line: string) => line.trim() || null,
      parseUsage: (output: string) => {
        seen.push(output)
        return undefined
      },
      parseModelMismatch: (output: string) => {
        seen.push(output)
        return undefined
      },
      isTerminalEvent: (line: string) => line.includes('"terminal"'),
    }
    const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => successfulChild(raw))

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const model = makeModel({ parser })
          const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
          })
          const reader = stream.getReader()
          for (;;) {
            const { done } = await reader.read()
            if (done) break
          }
          expect(seen.length).toBeGreaterThan(0)
          for (const output of seen) expect(output).toBe(raw)
        },
      })
    } finally {
      spawn.mockRestore()
    }
  })

  test("claude partial-message stream does not duplicate text and ignores sub-agent output", async () => {
    await using tmp = await tmpdir()
    const jsonl =
      [
        '{"type":"system","subtype":"init","session_id":"ses_test"}',
        '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ALPHA\\n{\\""}},"parent_tool_use_id":null,"session_id":"ses_test"}',
        '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"k\\":1}"}},"parent_tool_use_id":null,"session_id":"ses_test"}',
        '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"SUBAGENT"}},"parent_tool_use_id":"toolu_test","session_id":"ses_test"}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"ALPHA\\n{\\"k\\":1}"}]},"parent_tool_use_id":null,"session_id":"ses_test"}',
        '{"type":"result","subtype":"success","is_error":false,"result":"ALPHA\\n{\\"k\\":1}","usage":{"input_tokens":2,"cache_creation_input_tokens":6379,"cache_read_input_tokens":13368,"output_tokens":14,"output_tokens_details":{"thinking_tokens":0}},"session_id":"ses_test"}',
      ].join("\n") + "\n"
    const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => successfulChild(jsonl))

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const model = makeModel({ parser: claudeCodeParser })
          const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
          })
          let text = ""
          let finish: any
          const reader = stream.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (value.type === "text-delta") text += value.delta
            if (value.type === "finish") finish = value
          }
          // Exactly once: not again from the whole assistant message or result.
          expect(text).toBe('ALPHA\n{"k":1}')
          expect(text).not.toContain("SUBAGENT")
          expect(finish.usage).toEqual({
            inputTokens: { total: 2 + 6379 + 13368, noCache: 2, cacheRead: 13368, cacheWrite: 6379 },
            outputTokens: { total: 14, text: 14, reasoning: 0 },
          })
          expect(usageSource(finish.usage)).toBe("exact")
        },
      })
    } finally {
      spawn.mockRestore()
    }
  })

  test("claude legacy stream without partial events falls back to the final text once", async () => {
    await using tmp = await tmpdir()
    const jsonl =
      [
        '{"type":"system","subtype":"init","session_id":"ses_test"}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"ALPHA\\n{\\"k\\":1}"}]},"parent_tool_use_id":null,"session_id":"ses_test"}',
        '{"type":"result","subtype":"success","is_error":false,"result":"ALPHA\\n{\\"k\\":1}","session_id":"ses_test"}',
      ].join("\n") + "\n"
    const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => successfulChild(jsonl))

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const model = makeModel({ parser: claudeCodeParser })
          const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
          })
          let text = ""
          const reader = stream.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (value.type === "text-delta") text += value.delta
          }
          expect(text).toBe('ALPHA\n{"k":1}')
        },
      })
    } finally {
      spawn.mockRestore()
    }
  })

  test("doGenerate uses real parser usage and falls back to an estimate", async () => {
    const real = makeModel({
      binary: "echo",
      parser: {
        parseComplete: () => ({ text: "hello" }),
        parseStreamLine: () => null,
        parseUsage: () => ({
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheWriteTokens: 10,
          reasoningTokens: 5,
        }),
      },
      promptMode: "arg",
    })
    const exact = await real.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })
    expect(exact.usage).toEqual({
      inputTokens: { total: 100, noCache: 60, cacheRead: 30, cacheWrite: 10 },
      outputTokens: { total: 20, text: 15, reasoning: 5 },
    })
    expect(usageSource(exact.usage)).toBe("exact")

    const estimated = await makeModel({
      binary: "echo",
      parser: { parseComplete: () => ({ text: "hello" }), parseStreamLine: () => null },
      promptMode: "arg",
    }).doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })
    expect(usageSource(estimated.usage)).toBe("estimated")
  })

  test("doGenerate resets its idle timeout on stdout activity", async () => {
    const originalSetTimeout = globalThis.setTimeout
    const setTimeoutSpy = (
      handler: (...args: any[]) => void,
      timeout?: number,
      ...args: any[]
    ): ReturnType<typeof setTimeout> => originalSetTimeout(handler, timeout === 300_000 ? 25 : timeout, ...args)
    globalThis.setTimeout = setTimeoutSpy as typeof globalThis.setTimeout

    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const exited = (async () => {
      for (let i = 0; i < 6; i++) {
        await new Promise<void>((resolve) => originalSetTimeout(resolve, 6))
        stdout.write("chunk\n")
      }
      stdout.end()
      stderr.end()
      return 0
    })()
    const spawn = vi.spyOn(Process, "spawn").mockReturnValue({
      stdout,
      stderr,
      exited,
      exitCode: null,
      signalCode: null,
      kill: () => true,
      pid: 4242,
      stdin: null,
    } as any)
    const shellKill = vi.spyOn(Shell, "killTree").mockResolvedValue()

    try {
      const model = makeModel({
        binary: "slow-but-active",
        parser: { parseComplete: () => ({ text: "ok" }), parseStreamLine: () => null },
        promptMode: "arg",
      })
      const result = await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      })
      expect(result.content).toEqual([{ type: "text", text: "ok" }])
      // The run outlived the shortened idle ceiling because output kept arriving.
      expect(shellKill).not.toHaveBeenCalled()
    } finally {
      globalThis.setTimeout = originalSetTimeout
      spawn.mockRestore()
      shellKill.mockRestore()
    }
  })

  test("doGenerate keeps the output when the pipe is destroyed after exit instead of ending", async () => {
    // Process.spawn destroys pipes a background grandchild still holds open;
    // that emits 'close' without 'end', after all the data was delivered.
    const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => {
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      const exited = new Promise<number>((resolve) => {
        setTimeout(() => {
          stdout.write('{"type":"result","result":"ok"}\n')
          resolve(0)
          setTimeout(() => {
            stdout.destroy()
            stderr.destroy()
          }, 5)
        }, 0)
      })
      return {
        stdout,
        stderr,
        exited,
        exitCode: null,
        signalCode: null,
        kill: () => true,
        pid: 123,
        stdin: null,
      } as any
    })

    try {
      const result = await makeModel().doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      })
      expect(result.content).toEqual([{ type: "text", text: "ok" }])
    } finally {
      spawn.mockRestore()
    }
  })

  test("doGenerate forwards responseFormat json as a prompt instruction and unwraps fenced output", async () => {
    const fenced = '```json\n{"overall":"fine","issues":[]}\n```'
    const spawn = vi
      .spyOn(Process, "spawn")
      .mockImplementation(() => successfulChild(JSON.stringify({ type: "result", result: fenced }) + "\n"))

    try {
      const model = makeModel()
      const result = await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "review this" }] }],
        responseFormat: {
          type: "json",
          schema: { type: "object", properties: { overall: { type: "string" } } },
        },
      })

      const cmd = spawn.mock.calls[0]?.[0] as string[]
      const promptArg = cmd[cmd.indexOf("-p") + 1]
      expect(promptArg).toContain("<json_output>")
      expect(promptArg).toContain('"overall"')

      const textPart = result.content.find((part: { type: string }) => part.type === "text") as { text: string }
      expect(textPart.text).toBe('{"overall":"fine","issues":[]}')
      expect(JSON.parse(textPart.text)).toEqual({ overall: "fine", issues: [] })
    } finally {
      spawn.mockRestore()
    }
  })

  test("doGenerate leaves output untouched without responseFormat json", async () => {
    const spawn = vi
      .spyOn(Process, "spawn")
      .mockImplementation(() => successfulChild('{"type":"result","result":"plain prose"}\n'))

    try {
      const model = makeModel()
      const result = await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      })
      const cmd = spawn.mock.calls[0]?.[0] as string[]
      const promptArg = cmd[cmd.indexOf("-p") + 1]
      expect(promptArg).not.toContain("<json_output>")
      const textPart = result.content.find((part: { type: string }) => part.type === "text") as { text: string }
      expect(textPart.text).toBe("plain prose")
    } finally {
      spawn.mockRestore()
    }
  })

  test("extractJsonPayload handles fences, prose wrapping, and non-JSON", () => {
    expect(extractJsonPayload('{"a":1}')).toBe('{"a":1}')
    expect(extractJsonPayload('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractJsonPayload("```\n[1,2]\n```")).toBe("[1,2]")
    expect(extractJsonPayload('Here is the review: {"a":{"b":2}} Hope that helps!')).toBe('{"a":{"b":2}}')
    expect(extractJsonPayload("no json here at all")).toBe("no json here at all")
    expect(extractJsonPayload("unbalanced { not json")).toBe("unbalanced { not json")
  })

  test("runs CLI providers in the current instance directory", async () => {
    await using tmp = await tmpdir()
    const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => successfulChild())

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const model = makeModel({
            parser: {
              parseComplete: () => ({ text: "ok" }),
              parseStreamLine: (line: string) => line.trim() || null,
            },
          })

          await model.doGenerate({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
          })

          const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
          })
          const reader = stream.getReader()
          for (;;) {
            const { done } = await reader.read()
            if (done) break
          }
        },
      })

      expect(spawn).toHaveBeenCalledTimes(2)
      for (const call of spawn.mock.calls) {
        expect(call[1]).toMatchObject({ cwd: tmp.path })
      }
    } finally {
      spawn.mockRestore()
    }
  })

  test("doStream reports abort, not a successful finish, when a cancelled CLI exits 0", async () => {
    const outer = new AbortController()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let resolveExit!: (code: number) => void
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve
    })
    const spawn = vi.spyOn(Process, "spawn").mockReturnValue({
      stdout,
      stderr,
      exited,
      exitCode: null,
      signalCode: null,
      kill: () => true,
      pid: 4242,
      stdin: null,
    } as any)
    const shellKill = vi.spyOn(Shell, "killTree").mockResolvedValue(undefined as never)

    try {
      const model = makeModel({
        binary: "echo",
        args: [],
        parser: { parseComplete: () => ({ text: "" }), parseStreamLine: (line: string) => line.trim() || null },
      })
      const { stream } = await model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        abortSignal: outer.signal,
      })

      // The caller cancels while the CLI is still finishing; the CLI then
      // traps the signal and exits cleanly with code 0.
      outer.abort()
      stdout.write("partial output\n")
      stdout.end()
      stderr.end()
      resolveExit(0)

      const parts: any[] = []
      const reader = stream.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
      }

      expect(parts.some((part) => part.type === "finish")).toBe(false)
      const errorPart = parts.find((part) => part.type === "error")
      expect(errorPart).toBeDefined()
      expect((errorPart.error as Error).name).toBe("AbortError")
    } finally {
      spawn.mockRestore()
      shellKill.mockRestore()
      stdout.destroy()
      stderr.destroy()
    }
  })

  test("doGenerate throws on non-zero exit with no output", async () => {
    const model = makeModel({
      binary: "false",
      args: [],
      promptMode: "arg",
    })

    await expect(
      model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      }),
    ).rejects.toThrow(/CLI exited with code/)
  })

  test("doGenerate rejects a successful CLI that produces no assistant output", async () => {
    const model = makeModel({
      binary: process.execPath,
      args: ["-e", "process.stderr.write('command permission denied')", "--"],
      parser: {
        parseComplete: () => ({ text: "" }),
        parseStreamLine: () => null,
      },
      promptMode: "arg",
    })

    await expect(
      model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "what's this project" }] }],
      }),
    ).rejects.toThrow(/without producing assistant output.*command permission denied/)
  })

  test("doGenerate rejects successful structured JSONL with no assistant text", async () => {
    const model = makeModel({
      binary: process.execPath,
      args: ["-e", 'process.stdout.write(\'{"role":"meta","content":"To resume this session"}\\n\')', "--"],
      promptMode: "arg",
      parser: CLI_PROVIDER_DEFINITIONS["kimi-cli"]!.parser,
    })

    await expect(
      model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      }),
    ).rejects.toThrow(/without producing assistant output/)
  })

  test("doGenerate throws on non-zero exit even when stdout is present", async () => {
    const model = makeModel({
      binary: process.execPath,
      args: ["-e", "process.stdout.write('partial output'); process.exit(7)", "--"],
      parser: {
        parseComplete: () => ({ text: "unexpected success" }),
        parseStreamLine: () => null,
      },
      promptMode: "stdin",
    })

    await expect(
      model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      }),
    ).rejects.toThrow(/CLI exited with code 7: partial output/)
  })

  test("doGenerate does not leak a rejected process promise as an unhandled rejection", async () => {
    const failure = new Error("synthetic CLI spawn failure")
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    const spawn = vi.spyOn(Process, "spawn").mockReturnValue({
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exited: Promise.reject(failure),
      exitCode: null,
      signalCode: null,
      kill: () => true,
      pid: 998,
      stdin: null,
    } as any)
    process.on("unhandledRejection", onUnhandled)

    try {
      await expect(
        makeModel().doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        }),
      ).rejects.toBe(failure)
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
      spawn.mockRestore()
    }
  })

  test("doGenerate waits for CLI process kill before timing out", async () => {
    const originalSetTimeout = globalThis.setTimeout
    const setTimeoutSpy = (
      handler: (...args: any[]) => void,
      timeout?: number,
      ...args: any[]
    ): ReturnType<typeof setTimeout> => {
      if (timeout === 300_000) {
        return originalSetTimeout(handler, 1, ...args)
      }
      // Speed up the post-kill buffer drain wait used by the timeout path.
      if (timeout === 1_000) {
        return originalSetTimeout(handler, 5, ...args)
      }
      return originalSetTimeout(handler, timeout, ...args)
    }
    globalThis.setTimeout = setTimeoutSpy as typeof globalThis.setTimeout

    let killStarted = false
    let killCompleted = false
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const spawn = vi.spyOn(Process, "spawn").mockReturnValue({
      stdout,
      stderr,
      exited: new Promise<number>(() => {}),
      exitCode: null,
      signalCode: null,
      kill: () => true,
      pid: 999,
      stdin: null,
    } as any)
    const shellKill = vi.spyOn(Shell, "killTree").mockImplementation(async () => {
      killStarted = true
      // Emit diagnostic output that should appear in the timeout error.
      stderr.write("rate limited by upstream\n")
      await new Promise<void>((resolve) => {
        originalSetTimeout(() => {
          killCompleted = true
          resolve()
        }, 20)
      })
    })

    try {
      const model = makeModel({
        binary: "sleep",
        args: ["60"],
      })
      await expect(
        model.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        }),
      ).rejects.toThrow(/CLI process timed out after 300s/)
      expect(killStarted).toBe(true)
      expect(killCompleted).toBe(true)
    } finally {
      globalThis.setTimeout = originalSetTimeout
      spawn.mockRestore()
      shellKill.mockRestore()
      stdout.destroy()
      stderr.destroy()
    }
  })

  test("doGenerate timeout includes partial CLI stderr when buffers drain", async () => {
    const originalSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((
      handler: (...args: any[]) => void,
      timeout?: number,
      ...args: any[]
    ): ReturnType<typeof setTimeout> => {
      if (timeout === 300_000) return originalSetTimeout(handler, 1, ...args)
      if (timeout === 1_000) return originalSetTimeout(handler, 50, ...args)
      return originalSetTimeout(handler, timeout, ...args)
    }) as typeof globalThis.setTimeout

    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let resolveExit!: (code: number) => void
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve
    })
    const spawn = vi.spyOn(Process, "spawn").mockReturnValue({
      stdout,
      stderr,
      exited,
      exitCode: null,
      signalCode: null,
      kill: () => true,
      pid: 1001,
      stdin: null,
    } as any)
    const shellKill = vi.spyOn(Shell, "killTree").mockImplementation(async () => {
      stderr.end("auth token expired\n")
      stdout.end()
      resolveExit(1)
    })

    try {
      const model = makeModel({ binary: "sleep", args: ["60"] })
      await expect(
        model.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        }),
      ).rejects.toThrow(/CLI process timed out after 300s:[\s\S]*auth token expired/)
    } finally {
      globalThis.setTimeout = originalSetTimeout
      spawn.mockRestore()
      shellKill.mockRestore()
      stdout.destroy()
      stderr.destroy()
    }
  })

  test("doGenerate rejects with AbortError when signal is already aborted", async () => {
    const spawn = vi.spyOn(Process, "spawn")
    const controller = new AbortController()
    controller.abort()

    const model = makeModel({
      binary: "sleep",
      args: ["60"],
    })
    await expect(
      model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        abortSignal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(spawn).not.toHaveBeenCalled()

    spawn.mockRestore()
  })

  test("doGenerate rejects with AbortError when signal aborts during execution", async () => {
    const mockStdout = new PassThrough()
    const mockStderr = new PassThrough()
    let resolveExited: ((code: number) => void) | undefined
    let killCalled = false

    const spawn = vi.spyOn(Process, "spawn").mockReturnValue({
      stdout: mockStdout,
      stderr: mockStderr,
      exited: new Promise<number>((resolve) => {
        resolveExited = resolve
      }),
      exitCode: null,
      signalCode: null,
      kill: () => true,
      pid: 777,
      stdin: { write() {}, end() {} },
    } as any)

    const shellKill = vi.spyOn(Shell, "killTree").mockImplementation(async () => {
      killCalled = true
      resolveExited?.(143)
      mockStdout.end()
      mockStderr.end()
    })

    try {
      const controller = new AbortController()
      const model = makeModel({
        binary: "sleep",
        args: ["60"],
        promptMode: "arg",
      })
      const result = model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        abortSignal: controller.signal,
      })

      await new Promise<void>((resolve) => setTimeout(resolve, 10))
      controller.abort()
      await expect(result).rejects.toMatchObject({ name: "AbortError" })
      expect(killCalled).toBe(true)
    } finally {
      spawn.mockRestore()
      shellKill.mockRestore()
    }
  })

  test("doGenerate fails cleanly when stdin stream is unavailable", async () => {
    const spawn = vi.spyOn(Process, "spawn").mockReturnValue({
      stdin: null,
      stdout: new ReadableStream() as any,
      stderr: new ReadableStream() as any,
      exited: Promise.resolve(0),
      kill() {},
    } as any)

    try {
      const model = makeModel({ promptMode: "stdin" })
      await expect(
        model.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        }),
      ).rejects.toThrow("CLI process stdin not available")
    } finally {
      spawn.mockRestore()
    }
  })

  test("doGenerate turns stdin EPIPE into a normal rejection", async () => {
    const stdin = Object.assign(new EventEmitter(), {
      write() {
        queueMicrotask(() => {
          stdin.emit("error", Object.assign(new Error("broken pipe"), { code: "EPIPE" }))
          stdin.emit("close")
        })
        return false
      },
      end() {},
    })
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    stdout.end()
    stderr.end()
    const spawn = vi.spyOn(Process, "spawn").mockReturnValue({
      stdin,
      stdout,
      stderr,
      exited: Promise.resolve(1),
      exitCode: 1,
      signalCode: null,
      kill() {},
    } as any)

    try {
      const model = makeModel({ promptMode: "stdin" })
      await expect(
        model.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "x".repeat(128 * 1024) }] }],
        }),
      ).rejects.toMatchObject({ code: "EPIPE" })
      expect(stdin.listenerCount("error")).toBe(0)
      expect(stdin.listenerCount("drain")).toBe(0)
    } finally {
      spawn.mockRestore()
    }
  })

  test("doStream fails cleanly when output streams are unavailable", async () => {
    const spawn = vi.spyOn(Process, "spawn").mockReturnValue({
      stdin: { write() {}, end() {} },
      stdout: null,
      stderr: null,
      exited: Promise.resolve(0),
      kill() {},
    } as any)

    try {
      const model = makeModel({ promptMode: "stdin" })
      await expect(
        model.doStream({
          prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        }),
      ).rejects.toThrow("CLI process output not available")
    } finally {
      spawn.mockRestore()
    }
  })

  test("doStream surfaces process failure after stdout and does not finish", async () => {
    const model = makeModel({
      binary: process.execPath,
      args: ["-e", "process.stdout.write('partial output'); process.exit(9)", "--"],
      parser: {
        parseComplete: () => ({ text: "" }),
        parseStreamLine: (line: string) => line.trim() || null,
      },
      promptMode: "stdin",
    })

    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    const parts: any[] = []
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }

    expect(parts.find((part) => part.type === "finish")).toBeUndefined()
    expect(parts.find((part) => part.type === "text-end")).toBeDefined()

    const error = parts.find((part) => part.type === "error")
    expect(error).toBeDefined()
    expect(String(error.error)).toContain("CLI exited with code 9: partial output")
  })

  test("doStream reports a successful CLI with no assistant output as an error", async () => {
    const model = makeModel({
      binary: process.execPath,
      args: ["-e", "process.stderr.write('command permission denied')", "--"],
      parser: {
        parseComplete: () => ({ text: "" }),
        parseStreamLine: () => null,
      },
      promptMode: "stdin",
    })

    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "what's this project" }] }],
    })

    const parts: any[] = []
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }

    expect(parts.find((part) => part.type === "finish")).toBeUndefined()
    const error = parts.find((part) => part.type === "error")
    expect(error).toBeDefined()
    expect(String(error.error)).toContain("without producing assistant output")
    expect(String(error.error)).toContain("command permission denied")
  })

  test("doStream completes when a codex warning item precedes assistant output", async () => {
    const transcript =
      [
        '{"type":"thread.started","thread_id":"t1"}',
        '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Under-development features enabled: chronicle. Under-development features are incomplete and may behave unpredictably."}}',
        '{"type":"turn.started"}',
        '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"done"}}',
        '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0}}',
      ].join("\n") + "\n"
    const model = makeModel({
      binary: process.execPath,
      args: ["-e", `process.stdout.write(${JSON.stringify(transcript)})`, "--"],
      promptMode: "stdin",
      parser: CLI_PROVIDER_DEFINITIONS["codex-cli"]!.parser,
    })

    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    const parts: any[] = []
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }

    const text = parts
      .filter((part) => part.type === "text-delta")
      .map((part) => part.delta)
      .join("")
    expect(text).toBe("done")
    expect(parts.find((part) => part.type === "error")).toBeUndefined()
    expect(parts.find((part) => part.type === "finish")).toBeDefined()
  })

  test("doGenerate returns assistant output when a codex warning item is present", async () => {
    const transcript =
      [
        '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Under-development features enabled: chronicle."}}',
        '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"done"}}',
        '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0}}',
      ].join("\n") + "\n"
    const model = makeModel({
      binary: process.execPath,
      args: ["-e", `process.stdout.write(${JSON.stringify(transcript)})`, "--"],
      promptMode: "stdin",
      parser: CLI_PROVIDER_DEFINITIONS["codex-cli"]!.parser,
    })

    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    expect(result.content).toEqual([{ type: "text", text: "done" }])
    expect(result.finishReason).toEqual({ unified: "stop", raw: undefined })
  })

  test("doStream still fails on a terminal codex turn even after assistant text", async () => {
    const transcript =
      [
        '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"partial"}}',
        '{"type":"turn.failed","error":{"message":"stream disconnected"}}',
      ].join("\n") + "\n"
    const model = makeModel({
      binary: process.execPath,
      args: ["-e", `process.stdout.write(${JSON.stringify(transcript)})`, "--"],
      promptMode: "stdin",
      parser: CLI_PROVIDER_DEFINITIONS["codex-cli"]!.parser,
    })

    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    const parts: any[] = []
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }

    expect(parts.find((part) => part.type === "finish")).toBeUndefined()
    const error = parts.find((part) => part.type === "error")
    expect(error).toBeDefined()
    expect(String(error.error)).toContain("stream disconnected")
  })

  test("doStream does not leak kimi meta JSONL as assistant text", async () => {
    const model = makeModel({
      binary: process.execPath,
      args: ["-e", 'process.stdout.write(\'{"role":"meta","content":"To resume this session: kimi -r x"}\\n\')', "--"],
      promptMode: "stdin",
      parser: CLI_PROVIDER_DEFINITIONS["kimi-cli"]!.parser,
    })

    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    const parts: any[] = []
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }

    const text = parts
      .filter((part) => part.type === "text-delta")
      .map((part) => part.delta)
      .join("")
    expect(text).not.toContain("resume")
    expect(parts.find((part) => part.type === "finish")).toBeUndefined()
    const error = parts.find((part) => part.type === "error")
    expect(error).toBeDefined()
    expect(String(error.error)).toContain("without producing assistant output")
  })

  test("doStream includes stdout and stderr that drain after process exit", async () => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const spawn = vi.spyOn(Process, "spawn").mockReturnValue({
      stdout,
      stderr,
      exited: Promise.resolve(9),
      exitCode: 9,
      signalCode: null,
      kill: () => true,
      pid: 999,
      stdin: null,
    } as any)

    try {
      const model = makeModel({
        binary: "late-failure",
        parser: {
          parseComplete: () => ({ text: "" }),
          parseStreamLine: (line: string) => line,
        },
        promptMode: "arg",
      })

      const { stream } = await model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      })

      setTimeout(() => {
        stdout.end("late stdout")
        stderr.end("late stderr")
      }, 5)

      const parts: any[] = []
      const reader = stream.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
      }

      expect(parts.find((part) => part.type === "finish")).toBeUndefined()
      const error = parts.find((part) => part.type === "error")
      expect(error).toBeDefined()
      expect(String(error.error)).toContain("CLI exited with code 9")
      expect(String(error.error)).toContain("late stdout")
      expect(String(error.error)).toContain("late stderr")
    } finally {
      spawn.mockRestore()
    }
  })

  test("doStream still times out when stdout ends but the process keeps running", async () => {
    const originalSetTimeout = globalThis.setTimeout
    const setTimeoutSpy = (
      handler: (...args: any[]) => void,
      timeout?: number,
      ...args: any[]
    ): ReturnType<typeof setTimeout> => {
      if (timeout === 300_000) {
        return originalSetTimeout(handler, 1, ...args)
      }
      return originalSetTimeout(handler, timeout, ...args)
    }
    globalThis.setTimeout = setTimeoutSpy as typeof globalThis.setTimeout

    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const spawn = vi.spyOn(Process, "spawn").mockReturnValue({
      stdout,
      stderr,
      exited: new Promise<number>(() => {}),
      exitCode: null,
      signalCode: null,
      kill: () => true,
      pid: 1001,
      stdin: null,
    } as any)
    const shellKill = vi.spyOn(Shell, "killTree").mockResolvedValue()

    try {
      const model = makeModel({
        binary: "hung-after-stdout",
        parser: {
          parseComplete: () => ({ text: "" }),
          parseStreamLine: (line: string) => line,
        },
        promptMode: "arg",
      })

      const { stream } = await model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      })

      stdout.end("partial output")
      stderr.end()

      const parts: any[] = []
      const reader = stream.getReader()
      const outcome = await Promise.race([
        (async () => {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            parts.push(value)
          }
          return "closed"
        })(),
        new Promise<"stalled">((resolve) => originalSetTimeout(() => resolve("stalled"), 50)),
      ])

      expect(outcome).toBe("closed")
      const error = parts.find((part) => part.type === "error")
      expect(error).toBeDefined()
      expect(String(error.error)).toContain("CLI process timed out after 300s")
      expect(String(error.error)).toContain("partial output")
      expect(shellKill).toHaveBeenCalled()
    } finally {
      globalThis.setTimeout = originalSetTimeout
      spawn.mockRestore()
      shellKill.mockRestore()
    }
  })

  test("doStream preserves UTF-8 characters split across stdout chunks", async () => {
    const model = makeModel({
      binary: process.execPath,
      args: [
        "-e",
        [
          'const payload = Buffer.from(JSON.stringify({ type: "result", content: "trash 🗑️" }) + "\\n")',
          'const split = payload.indexOf(Buffer.from("🗑️")) + 1',
          "process.stdout.write(payload.subarray(0, split))",
          "setTimeout(() => process.stdout.write(payload.subarray(split)), 5)",
        ].join(";"),
        // The provider appends `--model <id>`; without this separator node parses
        // it as an unknown flag ("bad option: --model") and exits before writing.
        "--",
      ],
      parser: grokBuildCliParser,
      promptMode: "stdin",
    })

    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    const parts: any[] = []
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }

    const text = parts
      .filter((part) => part.type === "text-delta")
      .map((part) => part.delta)
      .join("")
    expect(text).toBe("trash 🗑️")
    expect(text).not.toContain("�")
  })

  test("doStream tolerates parser exceptions and falls back to raw stdout", async () => {
    const model = makeModel({
      binary: process.execPath,
      args: ["-e", "process.stdout.write('bad line\\n')", "--"],
      parser: {
        parseComplete: () => ({ text: "" }),
        parseStreamLine: () => {
          throw new Error("bad stream line")
        },
      },
      promptMode: "stdin",
    })

    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    const parts: any[] = []
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }

    const text = parts
      .filter((part) => part.type === "text-delta")
      .map((part) => part.delta)
      .join("")
    expect(text).toBe("bad line")
    expect(parts.find((part) => part.type === "finish")).toBeDefined()
  })

  test("doStream preserves raw fallback whitespace", async () => {
    const model = makeModel({
      binary: process.execPath,
      args: ["-e", "process.stdout.write('  indented answer  \\n')", "--"],
      parser: {
        parseComplete: () => ({ text: "" }),
        parseStreamLine: () => null,
      },
      promptMode: "stdin",
    })

    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    const parts: any[] = []
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }

    const text = parts
      .filter((part) => part.type === "text-delta")
      .map((part) => part.delta)
      .join("")
    expect(text).toBe("  indented answer  ")
    expect(parts.find((part) => part.type === "finish")).toBeDefined()
  })

  test("doStream handles abort signal", async () => {
    const controller = new AbortController()
    const model = makeModel({
      binary: "sleep",
      args: ["60"],
      promptMode: "arg",
    })

    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      abortSignal: controller.signal,
    })

    // Abort immediately
    controller.abort()

    const parts: any[] = []
    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
      }
    } catch {
      // Expected — stream may error on abort
    }

    // Should have received stream-start at minimum
    expect(parts.length).toBeGreaterThanOrEqual(1)
  })

  test("doStream rejects with AbortError when signal is already aborted", async () => {
    const spawn = vi.spyOn(Process, "spawn")
    const controller = new AbortController()
    controller.abort()

    const model = makeModel({ binary: "sleep", args: ["60"], promptMode: "arg" })
    await expect(
      model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        abortSignal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(spawn).not.toHaveBeenCalled()

    spawn.mockRestore()
  })

  test("doStream handles abort signal without throwing", async () => {
    const spawn = vi.spyOn(Process, "spawn").mockReturnValue({
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exited: new Promise<number>(() => {}),
      exitCode: null,
      signalCode: null,
      kill: () => true,
      pid: 888,
      stdin: null,
    } as any)

    const shellKill = vi.spyOn(Shell, "killTree").mockResolvedValue()
    const controller = new AbortController()

    try {
      const model = makeModel({ binary: "sleep", args: ["60"], promptMode: "arg" })
      const { stream } = await model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        abortSignal: controller.signal,
      })

      controller.abort()
      const reader = stream.getReader()
      await reader.cancel()
      expect(shellKill).toHaveBeenCalled()
    } finally {
      spawn.mockRestore()
      shellKill.mockRestore()
    }
  })

  test("adds Claude Code permission bypass in autonomous mode", () => {
    process.env.AX_CODE_AUTONOMOUS = "true"
    try {
      const cmd = buildCliCommand(
        {
          providerID: "claude-code",
          modelID: "claude-sonnet-4-6",
          binary: "claude",
          args: ["--print", "--output-format", "stream-json"],
          parser: claudeCodeParser,
          promptMode: "positional",
        },
        "write file",
      )
      expect(cmd).toContain("--dangerously-skip-permissions")
      expect(cmd.at(-1)).toBe("write file")
    } finally {
      restoreAutonomous()
    }
  })

  test("keeps Claude Code prompt out of argv for stdin delivery", () => {
    const definition = CLI_PROVIDER_DEFINITIONS["claude-code"]
    expect(definition).toBeDefined()

    const cmd = buildCliCommand(
      {
        providerID: "claude-code",
        modelID: "claude-code",
        binary: "claude",
        args: definition?.args ?? [],
        parser: claudeCodeParser,
        promptMode: definition?.promptMode ?? "stdin",
      },
      "write file",
    )

    expect(cmd).not.toContain("-p")
    expect(cmd).toContain("--print")
    expect(cmd).toContain("--include-partial-messages")
    expect(cmd[cmd.indexOf("--output-format") + 1]).toBe("stream-json")
    expect(cmd).not.toContain("write file")
  })

  test("adds autonomous-only flags by default", () => {
    delete process.env.AX_CODE_AUTONOMOUS
    try {
      const cmd = buildCliCommand(
        {
          providerID: "claude-code",
          modelID: "claude-sonnet-4-6",
          binary: "claude",
          args: ["--print"],
          parser: claudeCodeParser,
          promptMode: "positional",
        },
        "write file",
      )
      expect(cmd).toContain("--dangerously-skip-permissions")
    } finally {
      restoreAutonomous()
    }
  })

  test("omits autonomous-only flags when explicitly disabled", () => {
    process.env.AX_CODE_AUTONOMOUS = "false"
    try {
      const cmd = buildCliCommand(
        {
          providerID: "claude-code",
          modelID: "claude-sonnet-4-6",
          binary: "claude",
          args: ["--print"],
          parser: claudeCodeParser,
          promptMode: "positional",
        },
        "write file",
      )
      expect(cmd).not.toContain("--dangerously-skip-permissions")
    } finally {
      restoreAutonomous()
    }
  })

  test("omits --model when using a CLI provider default model", () => {
    const cmd = buildCliCommand(
      {
        providerID: "grok-build-cli",
        modelID: "grok-build-cli",
        binary: "grok",
        args: [],
        parser: grokBuildCliParser,
        promptMode: "arg",
        promptFlag: "-p",
      },
      "write file",
    )
    expect(cmd).not.toContain("--model")
    expect(cmd.slice(-2)).toEqual(["-p", "write file"])
  })

  test("passes Grok Build CLI prompt file through headless mode", () => {
    const definition = CLI_PROVIDER_DEFINITIONS["grok-build-cli"]
    expect(definition).toBeDefined()

    const cmd = buildCliCommand(
      {
        providerID: "grok-build-cli",
        modelID: "grok-build-cli",
        binary: "grok",
        args: definition?.args ?? [],
        parser: grokBuildCliParser,
        promptMode: definition?.promptMode ?? "arg",
        promptFlag: definition?.promptFlag,
      },
      "/tmp/prompt.txt",
    )

    expect(cmd).toEqual(["grok", "--output-format", "streaming-json", "--prompt-file", "/tmp/prompt.txt"])
  })

  test("passes Muse CLI prompt file through headless exec", () => {
    const definition = CLI_PROVIDER_DEFINITIONS["muse-cli"]
    expect(definition).toBeDefined()

    const cmd = buildCliCommand(
      {
        providerID: "muse-cli",
        modelID: "muse-cli",
        binary: "muse",
        args: definition?.args ?? [],
        optionalArgs: definition?.optionalArgs,
        parser: definition!.parser,
        promptMode: definition?.promptMode ?? "file",
        promptFlag: definition?.promptFlag,
        workspaceArg: definition?.workspaceArg,
      },
      "/tmp/prompt.txt",
      "/repo",
    )

    expect(cmd).toEqual([
      "muse",
      "exec",
      "--json",
      "--approval-mode",
      "never",
      "--disable-approval",
      "--trust-workspace",
      "--disable-reminders",
      "--workspace",
      "/repo",
      "--prompt-file",
      "/tmp/prompt.txt",
    ])
    expect(cmd).not.toContain("--disable-write")
    expect(cmd).not.toContain("--yolo")
  })

  test("passes Muse CLI model and effort flags", () => {
    const definition = CLI_PROVIDER_DEFINITIONS["muse-cli"]
    const cmd = buildCliCommand(
      {
        providerID: "muse-cli",
        modelID: "muse-spark-1.3",
        binary: "muse",
        args: definition?.args ?? [],
        parser: definition!.parser,
        promptMode: definition?.promptMode ?? "file",
        promptFlag: definition?.promptFlag,
      },
      "/tmp/prompt.txt",
      undefined,
      "max",
    )

    expect(cmd).toContain("--model")
    expect(cmd[cmd.indexOf("--model") + 1]).toBe("muse-spark-1.3")
    expect(cmd).toContain("--reasoning-effort")
    expect(cmd[cmd.indexOf("--reasoning-effort") + 1]).toBe("max")
  })

  test("passes MiniMax Code CLI prompt through headless exec stdin", () => {
    const definition = CLI_PROVIDER_DEFINITIONS["minimax-cli"]
    expect(definition).toBeDefined()

    const cmd = buildCliCommand(
      {
        providerID: "minimax-cli",
        modelID: "minimax-cli",
        binary: "mcode",
        args: definition?.args ?? [],
        parser: definition!.parser,
        promptMode: definition?.promptMode ?? "stdin",
        workspaceArg: definition?.workspaceArg,
      },
      "write file",
      "/repo",
    )

    expect(cmd).toEqual([
      "mcode",
      "exec",
      "--output-format",
      "stream-json",
      "--permission",
      "full",
      "--prompt-mode",
      "coding",
      "--input",
      "-",
      "--cwd",
      "/repo",
    ])
    expect(cmd).not.toContain("write file")
    expect(cmd).not.toContain("mmx")
  })

  test("passes MiniMax Code CLI model and effort flags", () => {
    const definition = CLI_PROVIDER_DEFINITIONS["minimax-cli"]
    const cmd = buildCliCommand(
      {
        providerID: "minimax-cli",
        modelID: "MiniMax-M3",
        binary: "mcode",
        args: definition?.args ?? [],
        parser: definition!.parser,
        promptMode: definition?.promptMode ?? "stdin",
      },
      "write file",
      undefined,
      "high",
    )

    expect(cmd).toContain("--model")
    expect(cmd[cmd.indexOf("--model") + 1]).toBe("minimax/MiniMax-M3")
    expect(cmd).toContain("--effort")
    expect(cmd[cmd.indexOf("--effort") + 1]).toBe("high")
  })

  test("sends MiniMax Code a provider-qualified model id", () => {
    const definition = CLI_PROVIDER_DEFINITIONS["minimax-cli"]!
    const modelArgFor = (modelID: string) => {
      const cmd = buildCliCommand(
        {
          providerID: "minimax-cli",
          modelID,
          binary: "mcode",
          args: definition.args,
          parser: definition.parser,
          promptMode: "stdin",
        },
        "write file",
      )
      return cmd[cmd.indexOf("--model") + 1]
    }

    // mcode rejects a bare id with "--model must use provider/model".
    expect(modelArgFor("MiniMax-M3")).toBe("minimax/MiniMax-M3")
    // An id that already names a provider is forwarded unchanged.
    expect(modelArgFor("minimax/MiniMax-M3")).toBe("minimax/MiniMax-M3")
    expect(modelArgFor("openrouter/foo")).toBe("openrouter/foo")
  })

  test("leaves other CLI providers' bare model ids unchanged", () => {
    const cmd = buildCliCommand(
      {
        providerID: "codex-cli",
        modelID: "gpt-5.6",
        binary: "codex",
        args: ["exec", "--json"],
        parser: claudeCodeParser,
        promptMode: "stdin",
      },
      "write file",
    )
    expect(cmd[cmd.indexOf("--model") + 1]).toBe("gpt-5.6")
  })

  test("maps effort to each supported CLI's native arguments", () => {
    const claude = buildCliCommand(
      {
        providerID: "claude-code",
        modelID: "claude-code",
        binary: "claude",
        args: ["--print"],
        parser: claudeCodeParser,
        promptMode: "positional",
      },
      "write file",
      undefined,
      "max",
    )
    expect(claude).toContain("--effort")
    expect(claude[claude.indexOf("--effort") + 1]).toBe("max")

    const codex = buildCliCommand(
      {
        providerID: "codex-cli",
        modelID: "codex-cli",
        binary: "codex",
        args: ["exec", "--json"],
        parser: claudeCodeParser,
        promptMode: "stdin",
      },
      "write file",
      undefined,
      "xhigh",
    )
    expect(codex).toContain("-c")
    expect(codex[codex.indexOf("-c") + 1]).toBe('model_reasoning_effort="xhigh"')

    const grok = buildCliCommand(
      {
        providerID: "grok-build-cli",
        modelID: "grok-build-cli",
        binary: "grok",
        args: [],
        parser: grokBuildCliParser,
        promptMode: "arg",
        promptFlag: "-p",
      },
      "write file",
      undefined,
      "medium",
    )
    expect(grok).toEqual(["grok", "--reasoning-effort", "medium", "-p", "write file"])
  })

  test("ignores unsupported CLI effort values", () => {
    const cmd = buildCliCommand(
      {
        providerID: "grok-build-cli",
        modelID: "grok-build-cli",
        binary: "grok",
        args: [],
        parser: grokBuildCliParser,
        promptMode: "arg",
        promptFlag: "-p",
      },
      "write file",
      undefined,
      "$(unsafe)",
    )
    expect(cmd).toEqual(["grok", "-p", "write file"])
  })

  test("forwards selected provider effort into the spawned CLI command", async () => {
    const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => successfulChild())
    try {
      const model = makeModel({
        providerID: "claude-code",
        modelID: "claude-code",
        binary: "claude",
        args: ["--print"],
        promptMode: "positional",
      })
      await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "write file" }] }],
        providerOptions: { "claude-code": { effort: "max" } },
      })
      const command = spawn.mock.calls[0]?.[0]
      expect(command).toContain("--effort")
      expect(command[command.indexOf("--effort") + 1]).toBe("max")
    } finally {
      spawn.mockRestore()
    }
  })

  test("passes Kimi Code CLI prompt through stream-json prompt mode", () => {
    process.env.AX_CODE_AUTONOMOUS = "false"
    try {
      const definition = CLI_PROVIDER_DEFINITIONS["kimi-cli"]
      expect(definition).toBeDefined()

      const cmd = buildCliCommand(
        {
          providerID: "kimi-cli",
          modelID: "kimi-cli",
          binary: "kimi",
          args: definition?.args ?? [],
          parser: definition!.parser,
          promptMode: definition?.promptMode ?? "arg",
          promptFlag: definition?.promptFlag,
        },
        "write file",
      )

      expect(cmd).toEqual(["kimi", "--output-format", "stream-json", "-p", "write file"])
      expect(cmd).not.toContain("--print")
    } finally {
      restoreAutonomous()
    }
  })

  test("passes resolved Kimi model via --model", () => {
    process.env.AX_CODE_AUTONOMOUS = "false"
    try {
      const definition = CLI_PROVIDER_DEFINITIONS["kimi-cli"]
      expect(definition).toBeDefined()

      const cmd = buildCliCommand(
        {
          providerID: "kimi-cli",
          modelID: "kimi-code/k3",
          binary: "kimi",
          args: definition?.args ?? [],
          parser: definition!.parser,
          promptMode: definition?.promptMode ?? "arg",
          promptFlag: definition?.promptFlag,
        },
        "ping",
      )

      expect(cmd).toEqual(["kimi", "--output-format", "stream-json", "--model", "kimi-code/k3", "-p", "ping"])
    } finally {
      restoreAutonomous()
    }
  })

  test("does not pass --yolo to Kimi Code CLI prompt mode", () => {
    delete process.env.AX_CODE_AUTONOMOUS
    try {
      const definition = CLI_PROVIDER_DEFINITIONS["kimi-cli"]
      const cmd = buildCliCommand(
        {
          providerID: "kimi-cli",
          modelID: "kimi-cli",
          binary: "kimi",
          args: definition?.args ?? [],
          parser: definition!.parser,
          promptMode: definition?.promptMode ?? "arg",
          promptFlag: definition?.promptFlag,
        },
        "write file",
      )
      expect(cmd).not.toContain("--yolo")
      expect(cmd).toEqual(["kimi", "--output-format", "stream-json", "-p", "write file"])
      expect(cmd).not.toContain("--print")
    } finally {
      restoreAutonomous()
    }
  })

  test("passes the active workspace through workspaceArg for headless prompts", () => {
    const cmd = buildCliCommand(
      {
        providerID: "custom-cli",
        modelID: "custom-cli",
        binary: "customcli",
        args: [],
        parser: claudeCodeParser,
        promptMode: "arg",
        promptFlag: "-p",
        workspaceArg: "--add-dir",
      },
      "what's this project",
      "/workspace/ax-code",
    )

    expect(cmd).toEqual(["customcli", "--add-dir", "/workspace/ax-code", "-p", "what's this project"])
  })
})

describe("optional CLI flags", () => {
  const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }]
  const flags = ["--disable-reminders"]

  async function readParts(stream: ReadableStream<any>) {
    const parts: any[] = []
    const reader = stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }
    return parts
  }

  test("matches clap-style unknown-argument messages", () => {
    expect(rejectedOptionalCliFlag("error: unexpected argument '--disable-reminders' found\n", flags)).toBe(
      "--disable-reminders",
    )
    expect(rejectedOptionalCliFlag("unknown option '--disable-reminders'", flags)).toBe("--disable-reminders")
    expect(rejectedOptionalCliFlag("unknown option: --disable-reminders", flags)).toBe("--disable-reminders")
    expect(rejectedOptionalCliFlag("UNRECOGNIZED OPTION '--DISABLE-REMINDERS'", flags)).toBe("--disable-reminders")
    expect(rejectedOptionalCliFlag("unknown argument --disable-reminders", flags)).toBe("--disable-reminders")
  })

  test("ignores unrelated stderr, a different flag, and a flag prefix", () => {
    expect(rejectedOptionalCliFlag("error: something else failed", flags)).toBeUndefined()
    expect(rejectedOptionalCliFlag("unexpected argument '--other-flag' found", flags)).toBeUndefined()
    expect(rejectedOptionalCliFlag("unexpected argument '--disable-reminders-x' found", flags)).toBeUndefined()
  })

  test("doGenerate retries once without the rejected flag and remembers it", async () => {
    const spawn = vi
      .spyOn(Process, "spawn")
      .mockImplementationOnce(() => failedChild(MUSE_REJECTED))
      .mockImplementation(() => successfulChild(MUSE_OK))
    try {
      const model = museModel()
      const first = await model.doGenerate({ prompt })
      expect(first.content).toEqual([{ type: "text", text: "PONG" }])
      expect(spawn).toHaveBeenCalledTimes(2)
      expect(spawn.mock.calls[0]?.[0]).toContain("--disable-reminders")
      expect(spawn.mock.calls[1]?.[0]).not.toContain("--disable-reminders")

      // The rejection is remembered: a later call omits the flag up front.
      const second = await model.doGenerate({ prompt })
      expect(second.content).toEqual([{ type: "text", text: "PONG" }])
      expect(spawn).toHaveBeenCalledTimes(3)
      expect(spawn.mock.calls[2]?.[0]).not.toContain("--disable-reminders")
    } finally {
      spawn.mockRestore()
    }
  })

  test("doStream retries without the flag on the same stream", async () => {
    const spawn = vi
      .spyOn(Process, "spawn")
      .mockImplementationOnce(() => failedChild(MUSE_REJECTED))
      .mockImplementation(() => successfulChild(MUSE_OK_TERMINAL))
    try {
      const { stream } = await museModel().doStream({ prompt })
      const parts: any[] = []
      const reader = stream.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
      }
      const text = parts
        .filter((part) => part.type === "text-delta")
        .map((part) => part.delta)
        .join("")
      expect(text).toBe("PONG")
      expect(parts.filter((part) => part.type === "stream-start")).toHaveLength(1)
      expect(parts.find((part) => part.type === "error")).toBeUndefined()
      expect(parts.find((part) => part.type === "finish")).toBeDefined()
      expect(spawn).toHaveBeenCalledTimes(2)
      expect(spawn.mock.calls[0]?.[0]).toContain("--disable-reminders")
      expect(spawn.mock.calls[1]?.[0]).not.toContain("--disable-reminders")
    } finally {
      spawn.mockRestore()
    }
  })

  test("doGenerate does not retry when the failure stderr is unrelated", async () => {
    const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => failedChild("error: upstream exploded\n", 1))
    try {
      await expect(museModel().doGenerate({ prompt })).rejects.toThrow(/CLI exited with code 1/)
      expect(spawn).toHaveBeenCalledTimes(1)
    } finally {
      spawn.mockRestore()
    }
  })

  test("doGenerate does not retry when the failed run produced stdout", async () => {
    const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => failedChild(MUSE_REJECTED, 2, MUSE_OK))
    try {
      await expect(museModel().doGenerate({ prompt })).rejects.toThrow(/CLI exited with code 2/)
      expect(spawn).toHaveBeenCalledTimes(1)
    } finally {
      spawn.mockRestore()
    }
  })

  test("doStream does not retry once it has emitted output", async () => {
    const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => failedChild(MUSE_REJECTED, 2, MUSE_OK))
    try {
      const { stream } = await museModel().doStream({ prompt })
      const parts: any[] = []
      const reader = stream.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
      }
      expect(parts.find((part) => part.type === "error")).toBeDefined()
      expect(spawn).toHaveBeenCalledTimes(1)
    } finally {
      spawn.mockRestore()
    }
  })

  test("doStream retries at most once and reports the second attempt's failure", async () => {
    const spawn = vi
      .spyOn(Process, "spawn")
      .mockImplementationOnce(() => failedChild(MUSE_REJECTED))
      .mockImplementation(() => failedChild(MUSE_REJECTED + "second attempt stderr\n"))
    try {
      const { stream } = await museModel().doStream({ prompt })
      const parts = await readParts(stream)
      expect(spawn).toHaveBeenCalledTimes(2)
      expect(parts.filter((part) => part.type === "stream-start")).toHaveLength(1)
      const errors = parts.filter((part) => part.type === "error")
      expect(errors).toHaveLength(1)
      expect(String(errors[0].error)).toContain("CLI exited with code 2")
      expect(String(errors[0].error)).toContain("second attempt stderr")
      expect(parts.find((part) => part.type === "finish")).toBeUndefined()
    } finally {
      spawn.mockRestore()
    }
  })

  test("doStream retries only once when the retry is rejected for another optional flag", async () => {
    // A CLI that only reports the first unknown flag it sees: --alpha-flag on
    // the first run, --beta-flag once the retry drops --alpha-flag.
    const spawn = vi.spyOn(Process, "spawn").mockImplementation((cmd) => {
      const rejected = cmd.find((arg) => arg === "--alpha-flag" || arg === "--beta-flag")
      return failedChild(`error: unexpected argument '${rejected}' found\n`)
    })
    try {
      const model = makeModel({ optionalArgs: ["--alpha-flag", "--beta-flag"] })
      const { stream } = await model.doStream({ prompt })
      const parts = await readParts(stream)
      expect(spawn).toHaveBeenCalledTimes(2)
      expect(spawn.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(["--alpha-flag", "--beta-flag"]))
      expect(spawn.mock.calls[1]?.[0]).not.toContain("--alpha-flag")
      expect(spawn.mock.calls[1]?.[0]).toContain("--beta-flag")
      const errors = parts.filter((part) => part.type === "error")
      expect(errors).toHaveLength(1)
      expect(String(errors[0].error)).toContain("--beta-flag")
    } finally {
      spawn.mockRestore()
    }
  })

  test("doStream omits a flag remembered from an earlier stream", async () => {
    const spawn = vi
      .spyOn(Process, "spawn")
      .mockImplementationOnce(() => failedChild(MUSE_REJECTED))
      .mockImplementation(() => successfulChild(MUSE_OK_TERMINAL))
    try {
      const model = museModel()
      const first = await readParts((await model.doStream({ prompt })).stream)
      expect(first.find((part) => part.type === "error")).toBeUndefined()
      expect(spawn).toHaveBeenCalledTimes(2)

      // The rejection is remembered: the next stream omits the flag up front.
      const second = await readParts((await model.doStream({ prompt })).stream)
      expect(spawn).toHaveBeenCalledTimes(3)
      expect(spawn.mock.calls[1]?.[0]).not.toContain("--disable-reminders")
      expect(spawn.mock.calls[2]?.[0]).not.toContain("--disable-reminders")
      expect(second.find((part) => part.type === "error")).toBeUndefined()
      expect(second.find((part) => part.type === "finish")).toBeDefined()
    } finally {
      spawn.mockRestore()
    }
  })

  test("doStream kills the retry process when the consumer cancels", async () => {
    const retryStdout = new PassThrough()
    const retryStderr = new PassThrough()
    const retryChild = {
      stdout: retryStdout,
      stderr: retryStderr,
      exited: new Promise<number>(() => {}),
      exitCode: null,
      signalCode: null,
      kill: () => true,
      pid: 555,
      stdin: null,
    }
    const spawn = vi
      .spyOn(Process, "spawn")
      .mockImplementationOnce(() => failedChild(MUSE_REJECTED))
      .mockImplementation(() => {
        // The retry process keeps running; its output proves it owns the stream.
        setTimeout(() => retryStdout.write(MUSE_OK), 0)
        return retryChild as any
      })
    const shellKill = vi.spyOn(Shell, "killTree").mockResolvedValue(undefined as never)
    try {
      const { stream } = await museModel().doStream({ prompt })
      const reader = stream.getReader()
      const parts: any[] = []
      while (!parts.some((part) => part.type === "text-delta")) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
      }
      expect(parts.find((part) => part.type === "error")).toBeUndefined()

      await reader.cancel()
      expect(spawn).toHaveBeenCalledTimes(2)
      expect(shellKill.mock.calls.map((call) => call[0])).toContain(retryChild)
      await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
      // Give a stray rejection a turn to surface as a test failure.
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      spawn.mockRestore()
      shellKill.mockRestore()
      retryStdout.destroy()
      retryStderr.destroy()
    }
  })

  test("doGenerate reports the abort instead of the flag rejection and remembers the flag", async () => {
    const controller = new AbortController()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const abortOnExit = () => {
      const exited = new Promise<number>((resolve) => {
        setTimeout(() => {
          stdout.end()
          stderr.end(MUSE_REJECTED)
          resolve(2)
          // The signal fires as the rejected attempt settles.
          queueMicrotask(() => controller.abort())
        }, 0)
      })
      return {
        stdout,
        stderr,
        exited,
        exitCode: null,
        signalCode: null,
        kill: () => true,
        pid: 556,
        stdin: null,
      } as any
    }
    const spawn = vi
      .spyOn(Process, "spawn")
      .mockImplementationOnce(abortOnExit)
      .mockImplementation(() => successfulChild(MUSE_OK))
    try {
      const model = museModel()
      const error = await model.doGenerate({ prompt, abortSignal: controller.signal }).then(
        () => undefined,
        (err) => err,
      )
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe("AbortError")
      expect(error.name).not.toBe("OptionalCliFlagRejectedError")
      expect(spawn).toHaveBeenCalledTimes(1)

      // The rejected flag was recorded before the abort surfaced.
      const later = await model.doGenerate({ prompt })
      expect(later.content).toEqual([{ type: "text", text: "PONG" }])
      expect(spawn).toHaveBeenCalledTimes(2)
      expect(spawn.mock.calls[1]?.[0]).not.toContain("--disable-reminders")
    } finally {
      spawn.mockRestore()
      stdout.destroy()
      stderr.destroy()
    }
  })

  test("doGenerate keeps --prompt-file on a file-mode retry and drops the flag", async () => {
    const promptFiles: { file: string; existed: boolean }[] = []
    const recordPromptFile = (cmd: string[]) => {
      const index = cmd.indexOf("--prompt-file")
      const file = index === -1 ? "" : cmd[index + 1]
      promptFiles.push({ file, existed: existsSync(file) })
    }
    const spawn = vi
      .spyOn(Process, "spawn")
      .mockImplementationOnce((cmd) => {
        recordPromptFile(cmd)
        return failedChild(MUSE_REJECTED)
      })
      .mockImplementation((cmd) => {
        recordPromptFile(cmd)
        return successfulChild(MUSE_OK)
      })
    try {
      const model = museModel({ promptMode: "file", promptFlag: "--prompt-file" })
      const result = await model.doGenerate({ prompt })
      expect(result.content).toEqual([{ type: "text", text: "PONG" }])
      expect(spawn).toHaveBeenCalledTimes(2)
      expect(promptFiles).toHaveLength(2)
      expect(promptFiles[0]?.existed).toBe(true)
      expect(promptFiles[1]?.existed).toBe(true)
      expect(promptFiles[1]?.file).toContain("prompt.txt")
      expect(promptFiles[1]?.file).not.toBe(promptFiles[0]?.file)
      expect(spawn.mock.calls[1]?.[0]).toContain("--prompt-file")
      expect(spawn.mock.calls[1]?.[0]).not.toContain("--disable-reminders")
    } finally {
      spawn.mockRestore()
    }
  })
})

describe("CLI effective model and terminal events", () => {
  const substitutedMiniMax = [
    '{"type":"item.completed","item":{"type":"agent_message","content":"PONG"}}',
    '{"type":"turn.completed","model":{"providerId":"minimax","modelId":"MiniMax-M3.1-Flash","variant":"thinking"},"usage":{"inputTokens":13760,"outputTokens":4,"cacheReadTokens":176,"totalTokens":13940}}',
    '{"type":"exec.completed","result":{"type":"exec.result","status":"succeeded","output":"PONG","model":{"providerId":"minimax","modelId":"MiniMax-M3.1-Flash","variant":"thinking"}}}',
  ].join("\n")

  test("doGenerate fails when MiniMax Code substitutes a different model", async () => {
    const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => successfulChild(substitutedMiniMax + "\n"))
    try {
      await expect(
        makeModel({
          providerID: "minimax-cli",
          modelID: "no-such-model-xyz",
          binary: "mcode",
          args: [],
          parser: minimaxCliParser,
          promptMode: "arg",
          promptFlag: "-p",
        }).doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
      ).rejects.toThrow("MiniMax Code used MiniMax-M3.1-Flash instead of the requested model no-such-model-xyz")
    } finally {
      spawn.mockRestore()
    }
  })

  test("doGenerate skips the model check for the delegating sentinel", async () => {
    const spawn = vi.spyOn(Process, "spawn").mockImplementation(() => successfulChild(substitutedMiniMax + "\n"))
    try {
      const result = await makeModel({
        providerID: "minimax-cli",
        modelID: "minimax-cli",
        binary: "mcode",
        args: [],
        parser: minimaxCliParser,
        promptMode: "arg",
        promptFlag: "-p",
      }).doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })
      expect(result.content).toEqual([{ type: "text", text: "PONG" }])
    } finally {
      spawn.mockRestore()
    }
  })

  test("doStream finishes on the muse terminal event without waiting for process exit", async () => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let resolveExit: (code: number) => void = () => {}
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve
    })
    const kill = vi.fn(() => true)
    const spawn = vi.spyOn(Process, "spawn").mockReturnValue({
      stdout,
      stderr,
      exited,
      exitCode: null,
      signalCode: null,
      kill,
      pid: 321,
      stdin: null,
    } as any)

    try {
      const model = makeModel({
        providerID: "muse-cli",
        modelID: "muse-cli",
        binary: "muse",
        args: [],
        parser: museCliParser,
        promptMode: "arg",
        promptFlag: "-p",
      })
      const { stream } = await model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      })
      // Answer + terminal event arrive, but the process stays alive after the
      // terminal event (as Muse can). The stream must not wait for `exited`.
      stdout.write('{"payload_type":"run.output.delta","payload":{"text":"PONG"}}\n')
      stdout.write('{"payload_type":"run.terminal.completed","payload":{"terminal":"completed","text":"PONG"}}\n')

      const parts: any[] = []
      const reader = stream.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
      }

      expect(
        parts
          .filter((part) => part.type === "text-delta")
          .map((part) => part.delta)
          .join(""),
      ).toBe("PONG")
      expect(parts.find((part) => part.type === "finish")).toBeDefined()
      expect(parts.find((part) => part.type === "error")).toBeUndefined()
      // The grace period has not elapsed yet, so the child has not been killed.
      expect(kill).not.toHaveBeenCalled()
    } finally {
      resolveExit(0)
      stdout.end()
      stderr.end()
      spawn.mockRestore()
    }
  })

  test("doStream preserves cancellation when Muse emits a terminal event during shutdown", async () => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const controller = new AbortController()
    const reason = new DOMException("Turn cancelled by caller", "AbortError")
    let resolveExit!: (code: number) => void
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve
    })
    const spawn = vi.spyOn(Process, "spawn").mockReturnValue({
      stdout,
      stderr,
      exited,
      exitCode: null,
      signalCode: null,
      kill: () => true,
      pid: 323,
      stdin: null,
    } as unknown as Process.Child)
    const kill = vi.spyOn(Shell, "killTree").mockResolvedValue(undefined)

    try {
      const { stream } = await museModel().doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        abortSignal: controller.signal,
      })
      stdout.write(MUSE_OK)
      controller.abort(reason)
      // A CLI can flush its completed event while handling the kill signal.
      stdout.write(MUSE_OK_TERMINAL)
      stdout.end()
      stderr.end()
      resolveExit(0)

      const parts = await Array.fromAsync(stream)
      expect(kill).toHaveBeenCalledOnce()
      expect(parts.find((part) => part.type === "finish")).toBeUndefined()
      expect(parts.find((part) => part.type === "error")).toEqual({ type: "error", error: reason })
    } finally {
      resolveExit(0)
      stdout.destroy()
      stderr.destroy()
      spawn.mockRestore()
      kill.mockRestore()
    }
  })

  test("doStream still fails when the process exits non-zero before a terminal event", async () => {
    await using tmp = await tmpdir()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let resolveExit: (code: number) => void = () => {}
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve
    })
    const spawn = vi.spyOn(Process, "spawn").mockReturnValue({
      stdout,
      stderr,
      exited,
      exitCode: null,
      signalCode: null,
      kill: () => true,
      pid: 322,
      stdin: null,
    } as any)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const model = makeModel({
            providerID: "muse-cli",
            modelID: "muse-cli",
            binary: "muse",
            args: [],
            parser: museCliParser,
            promptMode: "arg",
            promptFlag: "-p",
          })
          const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
          })
          stdout.write('{"payload_type":"run.output.delta","payload":{"text":"PART"}}\n')
          stdout.end()
          stderr.end()
          resolveExit(1)

          const parts: any[] = []
          const reader = stream.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            parts.push(value)
          }
          const error = parts.find((part) => part.type === "error")
          expect(error).toBeDefined()
          expect(String(error.error)).toContain("CLI exited with code 1")
        },
      })
    } finally {
      resolveExit(1)
      spawn.mockRestore()
    }
  })
})
