import { test, expect, describe, vi } from "vitest"
import { buildCliCommand, cliEnv, CliLanguageModel } from "../../../src/provider/cli/cli-language-model"
import { CLI_PROVIDER_DEFINITIONS } from "../../../src/provider/cli/config"
import {
  antigravityCliParser,
  claudeCodeParser,
  geminiCliParser,
  grokBuildCliParser,
} from "../../../src/provider/cli/parser"
import { usageSource } from "../../../src/provider/usage"
import { Process } from "../../../src/util/process"
import { Shell } from "../../../src/shell/shell"
import { PassThrough } from "node:stream"
import { Instance } from "../../../src/project/instance"
import { tmpdir } from "../../fixture/fixture"

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
      promptMode: "arg",
    })

    await expect(
      model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "what's this project" }] }],
      }),
    ).rejects.toThrow(/without producing assistant output.*command permission denied/)
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
      return originalSetTimeout(handler, timeout, ...args)
    }
    globalThis.setTimeout = setTimeoutSpy as typeof globalThis.setTimeout

    let killStarted = false
    let killCompleted = false
    const spawn = vi.spyOn(Process, "spawn").mockReturnValue({
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exited: new Promise<number>(() => {}),
      exitCode: null,
      signalCode: null,
      kill: () => true,
      pid: 999,
      stdin: null,
    } as any)
    const shellKill = vi.spyOn(Shell, "killTree").mockImplementation(async () => {
      killStarted = true
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
      ).rejects.toThrow("CLI process timed out after 300s")
      expect(killStarted).toBe(true)
      expect(killCompleted).toBe(true)
    } finally {
      globalThis.setTimeout = originalSetTimeout
      spawn.mockRestore()
      shellKill.mockRestore()
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
      parser: geminiCliParser,
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

  test("adds Qoder's automatic permission mode in autonomous mode", () => {
    process.env.AX_CODE_AUTONOMOUS = "true"
    try {
      const cmd = buildCliCommand(
        {
          providerID: "qoder-cli",
          modelID: "qoder-cli",
          binary: "qodercli",
          args: ["--output-format", "stream-json"],
          parser: claudeCodeParser,
          promptMode: "arg",
          promptFlag: "-p",
        },
        "write file",
      )
      expect(cmd).toContain("--permission-mode")
      expect(cmd).toContain("auto")
    } finally {
      restoreAutonomous()
    }
  })

  test("runs Qoder commands through a non-login POSIX shell", () => {
    const env = cliEnv([], "qoder-cli")
    if (process.platform === "win32") expect(env.SHELL).not.toBe("/bin/sh")
    else expect(env.SHELL).toBe("/bin/sh")
  })

  test("runs Gemini CLI headless without interactive workspace trust prompts", () => {
    expect(CLI_PROVIDER_DEFINITIONS["gemini-cli"]?.args).toContain("--skip-trust")
  })

  test("passes Claude Code prompt as a positional argument", () => {
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
    expect(cmd.at(-1)).toBe("write file")
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
        providerID: "gemini-cli",
        modelID: "gemini-cli",
        binary: "gemini",
        args: ["--output-format", "stream-json"],
        parser: geminiCliParser,
        promptMode: "arg",
        promptFlag: "-p",
      },
      "write file",
    )
    expect(cmd).not.toContain("--model")
    expect(cmd.slice(-2)).toEqual(["-p", "write file"])
  })

  test("passes Grok Build CLI prompt through headless -p mode", () => {
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
      "write file",
    )

    expect(cmd).toEqual(["grok", "-p", "write file"])
  })

  test("passes Antigravity CLI prompt through plain print mode", () => {
    const definition = CLI_PROVIDER_DEFINITIONS["antigravity-cli"]
    expect(definition).toBeDefined()

    const cmd = buildCliCommand(
      {
        providerID: "antigravity-cli",
        modelID: "antigravity-cli",
        binary: "agy",
        args: definition?.args ?? [],
        parser: antigravityCliParser,
        promptMode: definition?.promptMode ?? "arg",
        promptFlag: definition?.promptFlag,
      },
      "write file",
    )

    expect(cmd).toEqual(["agy", "-p", "write file"])
  })

  test("passes Kimi Code CLI prompt through stream-json print mode", () => {
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

      expect(cmd).toEqual(["kimi", "--print", "--output-format", "stream-json", "-p", "write file"])
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
          modelID: "kimi-for-coding",
          binary: "kimi",
          args: definition?.args ?? [],
          parser: definition!.parser,
          promptMode: definition?.promptMode ?? "arg",
          promptFlag: definition?.promptFlag,
        },
        "ping",
      )

      expect(cmd).toEqual([
        "kimi",
        "--print",
        "--output-format",
        "stream-json",
        "--model",
        "kimi-for-coding",
        "-p",
        "ping",
      ])
    } finally {
      restoreAutonomous()
    }
  })

  test("does not pass --yolo to Kimi Code CLI print mode", () => {
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
      expect(cmd).toEqual(["kimi", "--print", "--output-format", "stream-json", "-p", "write file"])
    } finally {
      restoreAutonomous()
    }
  })

  test("passes Antigravity CLI the active workspace for headless prompts", () => {
    const definition = CLI_PROVIDER_DEFINITIONS["antigravity-cli"]
    expect(definition?.workspaceArg).toBe("--add-dir")

    const cmd = buildCliCommand(
      {
        providerID: "antigravity-cli",
        modelID: "antigravity-cli",
        binary: "agy",
        args: definition?.args ?? [],
        parser: antigravityCliParser,
        promptMode: definition?.promptMode ?? "arg",
        promptFlag: definition?.promptFlag,
        workspaceArg: definition?.workspaceArg,
      },
      "what's this project",
      "/workspace/ax-code",
    )

    expect(cmd).toEqual(["agy", "--add-dir", "/workspace/ax-code", "-p", "what's this project"])
  })
})
