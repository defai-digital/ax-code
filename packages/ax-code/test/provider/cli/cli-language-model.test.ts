import { test, expect, describe, spyOn } from "bun:test"
import { buildCliCommand, CliLanguageModel } from "../../../src/provider/cli/cli-language-model"
import { claudeCodeParser, geminiCliParser, codexCliParser } from "../../../src/provider/cli/parser"
import { Process } from "../../../src/util/process"

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
      inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    })
    expect(result.warnings).toEqual([])
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
    expect(finish.usage).toEqual({
      inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    })
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

  test("doGenerate throws on non-zero exit even when stdout is present", async () => {
    const model = makeModel({
      binary: process.execPath,
      args: ["-e", "process.stdout.write('partial output'); process.exit(7)"],
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

  test("doGenerate fails cleanly when stdin stream is unavailable", async () => {
    const spawn = spyOn(Process, "spawn").mockReturnValue({
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

  test("doStream fails cleanly when output streams are unavailable", async () => {
    const spawn = spyOn(Process, "spawn").mockReturnValue({
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
      args: ["-e", "process.stdout.write('partial output'); process.exit(9)"],
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
    expect(parts.find((part) => part.type === "text-end")).toBeUndefined()

    const error = parts.find((part) => part.type === "error")
    expect(error).toBeDefined()
    expect(String(error.error)).toContain("CLI exited with code 9: partial output")
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
          promptMode: "stdin",
        },
        "write file",
      )
      expect(cmd).toContain("--dangerously-skip-permissions")
    } finally {
      restoreAutonomous()
    }
  })

  test("adds Gemini CLI yolo approval mode in autonomous mode", () => {
    process.env.AX_CODE_AUTONOMOUS = "true"
    try {
      const cmd = buildCliCommand(
        {
          providerID: "gemini-cli",
          modelID: "gemini-2.5-flash",
          binary: "gemini",
          args: ["--output-format", "stream-json"],
          parser: geminiCliParser,
          promptMode: "arg",
          promptFlag: "-p",
        },
        "write file",
      )
      expect(cmd).toContain("--approval-mode")
      expect(cmd).toContain("yolo")
      expect(cmd.slice(-2)).toEqual(["-p", "write file"])
    } finally {
      restoreAutonomous()
    }
  })

  test("does not add autonomous-only flags by default", () => {
    delete process.env.AX_CODE_AUTONOMOUS
    try {
      const cmd = buildCliCommand(
        {
          providerID: "claude-code",
          modelID: "claude-sonnet-4-6",
          binary: "claude",
          args: ["--print"],
          parser: claudeCodeParser,
          promptMode: "stdin",
        },
        "write file",
      )
      expect(cmd).not.toContain("--dangerously-skip-permissions")
    } finally {
      restoreAutonomous()
    }
  })
})
