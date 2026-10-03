import { readFile, writeFile, access, readdir } from "node:fs/promises"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { MockLanguageModelV3 } from "ai/test"
import { APICallError, NoObjectGeneratedError } from "ai"
import { readWikiBuildReport } from "../../src/wiki/build-report"
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

async function run(
  root: string,
  model: MockLanguageModelV3,
  signal?: AbortSignal,
  onProgress?: Parameters<typeof runNativeWiki>[0]["onProgress"],
) {
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
        onProgress,
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

test("repairs a broken relative Wiki link inside the existing two-attempt budget", async () => {
  await using tmp = await fixture()
  let calls = 0
  const broken = JSON.stringify({ ...page, body: page.body + "\n[Missing](modules/missing.md)" })
  const model = new MockLanguageModelV3({ doStream: async () => response(calls++ === 0 ? broken : valid) })
  const result = await run(tmp.path, model)
  expect(result.generatedPages).toEqual(["quickstart.md"])
  expect(model.doStreamCalls).toHaveLength(2)
  expect(model.doStreamCalls[1].prompt[0]).toMatchObject({
    role: "system",
    content: expect.stringContaining("invalid relative Wiki links"),
  })
  expect(model.doStreamCalls[1].abortSignal).toBe(model.doStreamCalls[0].abortSignal)
  const report = await readWikiBuildReport(tmp.path, ".ax-wiki")
  expect(report?.pages?.[0]).toMatchObject({
    status: "generated",
    attempts: 2,
    published: true,
    inputTokens: 2,
    outputTokens: 2,
  })
})

test("failed link repairs report generated work accurately and publish no pages", async () => {
  await using tmp = await fixture()
  const broken = JSON.stringify({ ...page, body: page.body + "\n[Missing](modules/missing.md)" })
  const model = new MockLanguageModelV3({ doStream: async () => response(broken) })
  await expect(run(tmp.path, model)).rejects.toThrow("links to missing page")
  expect(model.doStreamCalls).toHaveLength(2)
  const report = await readWikiBuildReport(tmp.path, ".ax-wiki")
  expect(report?.written).toEqual([])
  expect(report?.failed?.failureClass).toBe("validation")
  expect(report?.pages?.[0]?.published).toBe(false)
  await expect(access(path.join(tmp.path, ".ax-wiki/.manifest.json"))).rejects.toThrow()
})

test("the real SDK makes exactly two transport requests when retries exhaust", async () => {
  await using tmp = await fixture()
  const model = new MockLanguageModelV3({
    doStream: async () => {
      throw new APICallError({
        message: "upstream unavailable",
        url: "https://example.invalid",
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: true,
      })
    },
  })
  await expect(run(tmp.path, model)).rejects.toThrow("upstream unavailable")
  expect(model.doStreamCalls).toHaveLength(2)
  const report = await readWikiBuildReport(tmp.path, ".ax-wiki")
  expect(report?.failed).toMatchObject({ attempts: 2, failureClass: "transient" })
})

test("a successful page following one transient SDK request failure recovers", async () => {
  await using tmp = await fixture()
  let calls = 0
  const model = new MockLanguageModelV3({
    doStream: async () => {
      if (calls++ === 0)
        throw new APICallError({
          message: "temporary 503",
          url: "https://example.invalid",
          requestBodyValues: {},
          statusCode: 503,
          isRetryable: true,
        })
      return response(valid)
    },
  })
  expect((await run(tmp.path, model)).generatedPages).toEqual(["quickstart.md"])
  expect(model.doStreamCalls).toHaveLength(2)
})

test("resumes the reported ten-of-twelve-page cancellation case without repeating completed model calls", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: {
      wiki: {
        generationConcurrency: 1,
        pages: Array.from({ length: 12 }, (_, index) => ({
          path: index === 0 ? "quickstart.md" : `modules/page-${index}.md`,
          title: `Page ${index}`,
          purpose: "Explain the fixture",
          selectors: ["README.md"],
        })),
      },
    },
    init: async (root) => {
      await writeFile(path.join(root, "README.md"), "# Fixture\nA small fixture repository.\n")
    },
  })
  const model = new MockLanguageModelV3({ doStream: async () => response(valid) })
  const abort = new AbortController()
  await expect(
    run(tmp.path, model, abort.signal, (event) => {
      if (event.type === "page_complete" && event.completed === 10) abort.abort()
    }),
  ).rejects.toThrow()
  expect(model.doStreamCalls).toHaveLength(10)
  await expect(access(path.join(tmp.path, ".ax-wiki/.manifest.json"))).rejects.toThrow()
  expect((await readWikiBuildReport(tmp.path, ".ax-wiki"))?.written).toEqual([])
  const resumed = await run(tmp.path, model)
  expect(model.doStreamCalls).toHaveLength(12)
  expect(resumed.generatedPages).toHaveLength(12)
  const report = await readWikiBuildReport(tmp.path, ".ax-wiki")
  expect(report?.cached).toHaveLength(10)
  expect(report?.generated).toHaveLength(2)
  expect(report?.written).toHaveLength(12)
  expect(await readdir(path.join(tmp.path, ".ax-wiki/.page-cache"))).toEqual([])
})
