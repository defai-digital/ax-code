import { describe, expect, test } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { parseJsonStrict } from "../../src/util/json-value"
import {
  buildFixedContextRequest,
  generateFixedContext,
  MAX_CONTEXT_BYTES,
  readFixedContextFiles,
} from "../../src/provider/fixed-context"
import { tmpdir } from "../fixture/fixture"

const context = {
  namespace: "workspace",
  files: [{ name: "value.py", content: "def value(): return 42\n" }],
  model: "public/model",
  question: "What does this function return?",
}
function completion(usage = false) {
  return {
    id: "chatcmpl-current",
    object: "chat.completion",
    created: 1234,
    model: context.model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "It returns 42." } }],
    ...(usage ? { usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 } } : {}),
  }
}

describe("fixed-context request", () => {
  test("only the question changes between paraphrases; source/options/workspace change identity", () => {
    const first = buildFixedContextRequest(context)
    const second = buildFixedContextRequest({ ...context, question: "What does the function return?" })
    expect(first.system).toEqual(second.system)
    expect(first.contextDigest).toBe(second.contextDigest)
    for (const change of [
      { files: [{ name: "value.py", content: "def value(): return 43\n" }] },
      { namespace: "other" },
      { model: "other-model" },
      { maxTokens: 256 },
    ]) {
      expect(buildFixedContextRequest({ ...context, ...change }).contextDigest).not.toBe(first.contextDigest)
    }
  })
  test("sorts files and never attaches history, tools or transient identity", () => {
    const files = [context.files[0], { name: "a.py", content: "constant = 42" }]
    expect(buildFixedContextRequest({ ...context, files }).body).toEqual(
      buildFixedContextRequest({ ...context, files: files.toReversed() }).body,
    )
    expect(Object.keys(buildFixedContextRequest(context).body).sort()).toEqual([
      "max_tokens",
      "messages",
      "model",
      "temperature",
    ])
  })
  test("rejects ineligible question, output and encoded bounds instead of truncating", () => {
    for (const question of ["", "line\nline", "Explain `code`", "x".repeat(1025)])
      expect(() => buildFixedContextRequest({ ...context, question })).toThrow()
    for (const maxTokens of [0, 4097, 1.1, NaN])
      expect(() => buildFixedContextRequest({ ...context, maxTokens })).toThrow()
    expect(() =>
      buildFixedContextRequest({ ...context, files: [{ name: "large", content: "x".repeat(MAX_CONTEXT_BYTES + 1) }] }),
    ).toThrow()
    expect(() =>
      buildFixedContextRequest({ ...context, files: [{ name: "escaped", content: "\u0001".repeat(30000) }] }),
    ).toThrow("128 KiB")
  })
})

describe("fresh context file admission", () => {
  test("rereads changed bytes, preserves BOM and sorts canonical names", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "a.py"), "\ufeffa = 42\r\n")
    await fs.writeFile(path.join(tmp.path, "z.py"), "z = 1")
    const input = { directory: tmp.path, files: ["z.py", "a.py"], allowRead: () => true }
    const first = await readFixedContextFiles(input)
    expect(first.files[0]).toEqual({ name: "a.py", content: "\ufeffa = 42\r\n" })
    await fs.writeFile(path.join(tmp.path, "a.py"), "a = 43\n")
    const next = await readFixedContextFiles(input)
    expect(next.namespace).toBe(first.namespace)
    expect(next.files[0].content).toBe("a = 43\n")
  })
  test("rejects forbidden, binary, oversized, directory, duplicate and missing files", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "code"), "safe")
    const input = { directory: tmp.path, files: ["code"], allowRead: () => true }
    await expect(readFixedContextFiles({ ...input, allowRead: () => false })).rejects.toThrow("permission")
    await expect(readFixedContextFiles({ ...input, files: ["missing"] })).rejects.toThrow()
    await expect(readFixedContextFiles({ ...input, files: ["code", "code"] })).rejects.toThrow("once")
    await fs.mkdir(path.join(tmp.path, "dir"))
    await expect(readFixedContextFiles({ ...input, files: ["dir"] })).rejects.toThrow()
    for (const bytes of [Buffer.from([0, 1, 2]), Buffer.from([255, 254]), Buffer.alloc(MAX_CONTEXT_BYTES + 1, 65)]) {
      await fs.writeFile(path.join(tmp.path, "code"), bytes)
      await expect(readFixedContextFiles(input)).rejects.toThrow()
    }
  })
  test("rejects external paths, symlink escapes and cancellation", async () => {
    await using tmp = await tmpdir()
    await using external = await tmpdir()
    const outside = path.join(external.path, "private.txt")
    await fs.writeFile(outside, "must not send")
    const input = { directory: tmp.path, files: [outside], allowRead: () => true }
    await expect(readFixedContextFiles(input)).rejects.toThrow("inside")
    if (process.platform !== "win32") {
      await fs.symlink(outside, path.join(tmp.path, "alias"))
      await expect(readFixedContextFiles({ ...input, files: ["alias"] })).rejects.toThrow("inside")
    }
    await expect(readFixedContextFiles({ ...input, signal: AbortSignal.abort() })).rejects.toThrow()
  })
})

describe("real bundled SDK transport", () => {
  test.each(["MISS", "HIT", "EXACT_HIT", "BYPASS", undefined])(
    "emits exact gateway body and reports %s without inventing usage",
    async (status) => {
      let calls = 0
      const provider = createOpenAICompatible({
        name: "fixture",
        baseURL: "https://gateway.invalid/v1",
        apiKey: "fixture-token",
        fetch: async (url, init) => {
          calls++
          expect(String(url)).toBe("https://gateway.invalid/v1/chat/completions")
          const headers = new Headers(init?.headers)
          expect(headers.get("authorization")).toBe("Bearer fixture-token")
          expect(headers.get("x-ax-semantic-cache")).toBe("fixed-context-v1")
          expect(parseJsonStrict(String(init?.body))).toEqual(buildFixedContextRequest(context).body)
          return new Response(JSON.stringify(completion(status === "MISS")), {
            headers: {
              "content-type": "application/json",
              "x-request-id": "current-request",
              ...(status ? { "x-ax-semantic-cache": status } : {}),
              "x-ax-semantic-score": "0.992",
            },
          })
        },
      })
      const result = await generateFixedContext(provider.chatModel(context.model), buildFixedContextRequest(context))
      expect(calls).toBe(1)
      expect(result.answer).toBe("It returns 42.")
      expect(result.cache.status).toBe(status ?? "UNREPORTED")
      expect(result.requestID).toBe("current-request")
      expect("usage" in result).toBe(status === "MISS")
    },
  )
  test("auth failure is not retried or exposed with raw upstream content", async () => {
    let calls = 0
    const provider = createOpenAICompatible({
      name: "fixture",
      baseURL: "https://gateway.invalid/v1",
      fetch: async () => {
        calls++
        return new Response(JSON.stringify({ error: { message: "secret upstream detail" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
      },
    })
    await expect(
      generateFixedContext(provider.chatModel(context.model), buildFixedContextRequest(context)),
    ).rejects.toThrow("HTTP 401")
    expect(calls).toBe(1)
  })
  test("cancelled input sends no request", async () => {
    let calls = 0
    const provider = createOpenAICompatible({
      name: "fixture",
      baseURL: "https://gateway.invalid/v1",
      fetch: async () => {
        calls++
        return new Response()
      },
    })
    await expect(
      generateFixedContext(provider.chatModel(context.model), buildFixedContextRequest(context), AbortSignal.abort()),
    ).rejects.toThrow()
    expect(calls).toBe(0)
  })
  test.each(["length", "tool_calls"])("rejects incomplete or actionable output: %s", async (finish) => {
    const body = completion()
    body.choices[0].finish_reason = finish
    const provider = createOpenAICompatible({
      name: "fixture",
      baseURL: "https://gateway.invalid/v1",
      fetch: async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
    })
    await expect(
      generateFixedContext(provider.chatModel(context.model), buildFixedContextRequest(context)),
    ).rejects.toThrow("complete text")
  })
})
