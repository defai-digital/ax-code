import { readFile, writeFile, access } from "node:fs/promises"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { MockLanguageModelV3 } from "ai/test"
import { NoObjectGeneratedError } from "ai"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Env } from "../../src/env"
import { runNativeWiki } from "../../src/wiki/native"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
  vi.restoreAllMocks()
})

const page = {
  summary: "A source-backed overview of the fixture repository.",
  body: "## Overview\n\nThe repository described in `README.md` is a small fixture used to verify complete, validated Wiki page generation.",
  symbols: [],
}
const valid = JSON.stringify(page)

async function fixture() {
  return tmpdir({
    git: true,
    config: {
      wiki: {
        pages: [
          { path: "quickstart.md", title: "Quickstart", purpose: "Explain the fixture", selectors: ["README.md"] },
        ],
      },
    },
    init: async (root) => {
      await writeFile(path.join(root, "README.md"), "# Fixture\nA small fixture repository.\n")
    },
  })
}

function response(text: string, finishReason: "stop" | "length" = "stop") {
  const parts: LanguageModelV3StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "page" },
    { type: "text-delta", id: "page", delta: text },
    { type: "text-end", id: "page" },
    {
      type: "finish",
      finishReason: { unified: finishReason, raw: finishReason },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
    },
  ]
  return {
    stream: new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        for (const part of parts) controller.enqueue(part)
        controller.close()
      },
    }),
  }
}

async function run(root: string, model: MockLanguageModelV3, signal?: AbortSignal) {
  vi.spyOn(Provider, "getLanguage").mockResolvedValue(model)
  return Instance.provide({
    directory: root,
    init: async () => {
      Env.set("GROQ_API_KEY", "test-api-key")
    },
    fn: () =>
      runNativeWiki({
        root,
        action: "generate",
        model: "groq/openai/gpt-oss-20b",
        includeGraphEvidence: false,
        signal,
      }),
  })
}

test("accepts a complete fenced JSON page without another model call", async () => {
  await using tmp = await fixture()
  const model = new MockLanguageModelV3({ doStream: async () => response("```json\n" + valid + "\n```") })
  const result = await run(tmp.path, model)
  expect(result.generatedPages).toEqual(["quickstart.md"])
  expect(model.doStreamCalls).toHaveLength(1)
  expect(await readFile(path.join(tmp.path, ".ax-wiki/quickstart.md"), "utf8")).toContain(page.body.split("\n\n")[1])
})

test.each(["", '{"summary":"unfinished', "plain prose", JSON.stringify({ ...page, body: "too short" })])(
  "retries invalid structured output once and publishes only the validated page: %s",
  async (invalid) => {
    await using tmp = await fixture()
    let calls = 0
    const model = new MockLanguageModelV3({ doStream: async () => response(calls++ === 0 ? invalid : valid) })
    const result = await run(tmp.path, model)
    expect(result.generatedPages).toEqual(["quickstart.md"])
    expect(model.doStreamCalls).toHaveLength(2)
    expect(model.doStreamCalls[1].prompt[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("previous attempt"),
    })
    expect(model.doStreamCalls[1].abortSignal).toBe(model.doStreamCalls[0].abortSignal)
    expect(model.doStreamCalls[1].prompt[1]).toEqual(model.doStreamCalls[0].prompt[1])
  },
)

test("stops after two malformed responses without publishing partial artifacts", async () => {
  await using tmp = await fixture()
  const model = new MockLanguageModelV3({ doStream: async () => response('{"body":"truncated', "length") })
  await expect(run(tmp.path, model)).rejects.toBeInstanceOf(NoObjectGeneratedError)
  expect(model.doStreamCalls).toHaveLength(2)
  await expect(access(path.join(tmp.path, ".ax-wiki/.manifest.json"))).rejects.toThrow()
  await expect(access(path.join(tmp.path, ".ax-wiki/quickstart.md"))).rejects.toThrow()
})

test("does not retry a stream transport failure", async () => {
  await using tmp = await fixture()
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({ type: "error", error: new Error("stream disconnected") })
          controller.close()
        },
      }),
    }),
  })
  await expect(run(tmp.path, model)).rejects.toThrow("stream disconnected")
  expect(model.doStreamCalls).toHaveLength(1)
})

test("does not start a repair retry after cancellation", async () => {
  await using tmp = await fixture()
  const abort = new AbortController()
  const model = new MockLanguageModelV3({
    doStream: async () => {
      abort.abort()
      return response("invalid")
    },
  })
  await expect(run(tmp.path, model, abort.signal)).rejects.toThrow()
  expect(model.doStreamCalls).toHaveLength(1)
})
