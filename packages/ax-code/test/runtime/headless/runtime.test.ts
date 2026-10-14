import { describe, expect, test } from "vitest"
import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  createHeadlessAgentRuntime,
  parseHeadlessRuntimeJsonBody,
  parseHeadlessRuntimeResponseBody,
} from "../../../src/runtime/headless"

describe("headless runtime", () => {
  test("parseHeadlessRuntimeResponseBody decodes JSON bodies", () => {
    expect(parseHeadlessRuntimeResponseBody(JSON.stringify({ ok: true }))).toEqual({ ok: true })
  })

  test("parseHeadlessRuntimeJsonBody decodes non-empty JSON bodies", () => {
    expect(parseHeadlessRuntimeJsonBody(JSON.stringify({ ok: true }))).toEqual({ ok: true })
  })

  test("parseHeadlessRuntimeResponseBody treats empty bodies as accepted", () => {
    expect(parseHeadlessRuntimeResponseBody("")).toBe(true)
  })

  test("parseHeadlessRuntimeResponseBody reports invalid JSON with a bounded preview", () => {
    expect(() => parseHeadlessRuntimeResponseBody("{not json")).toThrow("Headless runtime returned invalid JSON")
    expect(() => parseHeadlessRuntimeJsonBody("{not json")).toThrow("Headless runtime returned invalid JSON")
  })

  test("command posts include directory headers", async () => {
    let request: Request | undefined
    const headers = { Authorization: "Basic token" }
    const runtime = createHeadlessAgentRuntime({
      baseUrl: "http://localhost",
      directory: "/tmp/測試",
      headers,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        request = input instanceof Request ? input : new Request(input, init)
        return new Response("", { status: 202 })
      }) as typeof fetch,
    })

    await runtime.send({
      type: "session.abort",
      sessionID: "ses_123",
    })

    expect(request?.headers.get("x-ax-code-directory")).toBe("%2Ftmp%2F%E6%B8%AC%E8%A9%A6")
    expect(request?.headers.get("x-opencode-directory")).toBe("%2Ftmp%2F%E6%B8%AC%E8%A9%A6")
    expect(request?.headers.get("authorization")).toBe("Basic token")
    expect(headers).toEqual({ Authorization: "Basic token" })
  })

  test("reports a rejected reply as a failure instead of a silent success", async () => {
    const runtime = createHeadlessAgentRuntime({
      baseUrl: "http://localhost",
      fetch: (async () =>
        new Response(JSON.stringify({ name: "QuestionNotFoundError", message: "Question not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    })

    await expect(
      runtime.send({ type: "question.reply", body: { requestID: "que_missing", answers: [["Yes"]] } }),
    ).rejects.toThrow("Headless runtime command failed (404)")
    await expect(
      runtime.send({ type: "permission.reply", body: { requestID: "per_missing", reply: "once" } }),
    ).rejects.toThrow("Headless runtime command failed (404)")
  })

  test("returns a reply's body with its real status on success", async () => {
    const runtime = createHeadlessAgentRuntime({
      baseUrl: "http://localhost",
      fetch: (async () =>
        new Response(JSON.stringify(true), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    })

    const result = await runtime.send({ type: "question.reply", body: { requestID: "que_1", answers: [["Yes"]] } })
    expect(result).toMatchObject({ accepted: true, status: 200, body: true })
  })

  test("runtime clients use AX Code SDK naming instead of OpenCode aliases", async () => {
    const headlessRuntime = await readFile(
      path.join(import.meta.dirname, "../../../src/runtime/headless/runtime.ts"),
      "utf8",
    )
    const localClient = await readFile(path.join(import.meta.dirname, "../../../src/runtime/local-client.ts"), "utf8")

    for (const source of [headlessRuntime, localClient]) {
      expect(source).toContain("createAxCodeClient")
      expect(source).not.toContain("createOpencodeClient")
    }
  })
})
