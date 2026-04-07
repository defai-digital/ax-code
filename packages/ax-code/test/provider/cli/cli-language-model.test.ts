import { test, expect, describe } from "bun:test"
import { CliLanguageModel } from "../../../src/provider/cli/cli-language-model"
import { claudeCodeParser, geminiCliParser, codexCliParser } from "../../../src/provider/cli/parser"

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
})
