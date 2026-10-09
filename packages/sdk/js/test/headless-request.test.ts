import { createServer, type ServerResponse } from "node:http"
import { once } from "node:events"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
  createHeadlessClient,
  HeadlessRequestError,
  checkHeadlessRuntimeCompatibility,
  type HeadlessTransport,
  type HeadlessSteerReceipt,
  type HeadlessSteeringState,
} from "../src/headless.js"
import { createHttpSseTransport } from "../src/headless/http-transport.js"
import { runHeadlessRequest } from "../src/headless/request.js"

const capabilities = {
  schemaVersion: 1,
  product: "ax-code",
  version: "7.23.0",
  compatibility: { sdkHeadless: { schemaVersion: 1 } },
  features: { sessions: true, asyncPrompt: true, disabled: false },
}

const receipt = {
  clientID: "client-1",
  sessionID: "session-1",
  generation: "generation-1",
  status: "accepted",
} satisfies HeadlessSteerReceipt

describe("headless steering and capability contracts", () => {
  test("routes steering with unchanged generation, client id, receipts and inactive queue outcomes", async () => {
    const requests: Array<{ path: string; method: string; body?: Record<string, unknown> }> = []
    const state = {
      generation: "generation-1",
      receipts: [receipt],
      retention: "process-local; at most 256 receipts per session",
    } satisfies HeadlessSteeringState
    const queueOutcome = { reason: "generation_not_active", receipt: null, item: { id: "task-1" } }
    const client = createHeadlessClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async (url, init) => {
        const path = new URL(String(url)).pathname
        requests.push({
          path,
          method: String(init?.method),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        })
        return Response.json(path.startsWith("/task-queue") ? queueOutcome : init?.method === "GET" ? state : receipt)
      }) as typeof fetch,
    })
    expect(await client.steering("session/1")).toEqual(state)
    expect(
      await client.steer("session/1", {
        expectedGeneration: "generation-1",
        clientID: "client-1",
        text: "Use the existing contract",
      }),
    ).toEqual(receipt)
    expect(await client.taskQueue.steer("task/1")).toEqual(queueOutcome)
    expect(requests).toEqual([
      { path: "/session/session%2F1/steering", method: "GET", body: undefined },
      {
        path: "/session/session%2F1/steering",
        method: "POST",
        body: { expectedGeneration: "generation-1", clientID: "client-1", text: "Use the existing contract" },
      },
      { path: "/task-queue/task%2F1/steer", method: "POST", body: undefined },
    ])
  })

  test("validates current capabilities and rejects absent or false feature flags", () => {
    expect(checkHeadlessRuntimeCompatibility(capabilities, { requiredFeatures: ["sessions"] })).toEqual({
      compatible: true,
      runtimeVersion: "7.23.0",
      issues: [],
    })
    expect(
      checkHeadlessRuntimeCompatibility(capabilities, {
        requiredFeatures: ["disabled", "sessionSteering", "sessionSteering"],
      }),
    ).toEqual({
      compatible: false,
      runtimeVersion: "7.23.0",
      issues: [
        "Runtime does not advertise required feature: disabled",
        "Runtime does not advertise required feature: sessionSteering",
      ],
    })
  })

  test.each([
    null,
    {},
    { ...capabilities, product: "other" },
    { ...capabilities, schemaVersion: 2 },
    { ...capabilities, compatibility: { sdkHeadless: { schemaVersion: 2 } } },
    { ...capabilities, features: { sessions: "true" } },
  ])("rejects malformed or unsupported capability protocol: %j", (input) => {
    const result = checkHeadlessRuntimeCompatibility(input)
    expect(result.compatible).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  test("checks the actual capabilities response rather than trusting its TypeScript assertion", async () => {
    const client = createHeadlessClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: (async () => Response.json({ ...capabilities, schemaVersion: 2 })) as typeof fetch,
    })
    expect((await client.checkCompatibility()).compatible).toBe(false)
  })

  test("default request controls cover custom transports and every convenience method", async () => {
    let calls = 0
    const transport: HeadlessTransport = {
      requestJson() {
        calls++
        return new Promise(() => {})
      },
      sendCommand() {
        calls++
        return new Promise(() => {})
      },
      async *subscribe() {},
    }
    const client = createHeadlessClient({ transport, requestOptions: { timeoutMs: 10 } })
    await expect(client.taskQueue.list()).rejects.toMatchObject({ name: "TimeoutError" })
    await expect(client.sendPrompt("session-1", { parts: [] })).rejects.toMatchObject({ name: "TimeoutError" })
    expect(calls).toBe(2)
  })

  test("per-command cancellation overrides defaults without dispatching an already aborted mutation", async () => {
    const sendCommand = vi.fn()
    const transport: HeadlessTransport = { requestJson: vi.fn(), sendCommand, async *subscribe() {} }
    const client = createHeadlessClient({ transport, requestOptions: { timeoutMs: 1000 } })
    const controller = new AbortController()
    controller.abort(new Error("Cancelled by caller"))
    await expect(client.sendPrompt("session-1", { parts: [] }, { signal: controller.signal })).rejects.toThrow(
      "Cancelled by caller",
    )
    expect(sendCommand).not.toHaveBeenCalled()
  })
})

describe("HTTP request controls with real connections", () => {
  let baseUrl: string
  let calls: string[]
  let pending: ServerResponse[]
  const server = createServer((request, response) => {
    calls.push(request.url ?? "")
    if (request.url === "/body-stall") {
      response.writeHead(200, { "Content-Type": "application/json" })
      response.write('{"started":')
      pending.push(response)
      return
    }
    if (request.url?.includes("stalled")) {
      pending.push(response)
      return
    }
    if (request.url === "/plain-error") {
      response.writeHead(502)
      response.end("upstream unavailable")
      return
    }
    if (request.url?.includes("conflict")) {
      response.writeHead(409, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ code: "steer_conflict", message: "client id already used", logRef: "err_fixture" }))
      return
    }
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(JSON.stringify({ healthy: true, version: "7.23.0" }))
  })

  beforeEach(async () => {
    calls = []
    pending = []
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing test port")
    baseUrl = `http://127.0.0.1:${address.port}`
  })
  afterEach(async () => {
    pending.forEach((response) => response.destroy())
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  })

  test("preserves structured 409 errors and never retries steering", async () => {
    const client = createHeadlessClient({ baseUrl })
    const error = await client
      .steer("conflict", { expectedGeneration: "generation-1", clientID: "client-1", text: "Correction" })
      .catch((error: unknown) => error)
    expect(error).toBeInstanceOf(HeadlessRequestError)
    expect(error).toMatchObject({
      status: 409,
      method: "POST",
      path: "/session/conflict/steering",
      body: { code: "steer_conflict", logRef: "err_fixture" },
    })
    expect(calls).toEqual(["/session/conflict/steering"])
  })

  test("preserves non-JSON proxy errors", async () => {
    const transport = createHttpSseTransport({ baseUrl })
    await expect(transport.requestJson({ method: "GET", path: "/plain-error" })).rejects.toMatchObject({
      status: 502,
      body: "upstream unavailable",
    })
  })

  test.each(["/stalled", "/body-stall"])("deadline covers headers and body reads: %s", async (path) => {
    const transport = createHttpSseTransport({ baseUrl })
    await expect(transport.requestJson({ method: "GET", path, timeoutMs: 250 })).rejects.toMatchObject({
      name: "TimeoutError",
    })
    expect(calls).toEqual([path])
    expect(await transport.requestJson({ method: "GET", path: "/global/health" })).toMatchObject({ healthy: true })
  })

  test("caller abort ends a pending command with no replay", async () => {
    const client = createHeadlessClient({ baseUrl })
    const controller = new AbortController()
    const outcome = expect(
      client.sendPrompt("stalled", { parts: [] }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    controller.abort()
    await outcome
    expect(calls).toEqual(["/session/stalled/prompt_async"])
  })

  test("zero timeout overrides the client default", async () => {
    const client = createHeadlessClient({
      baseUrl,
      requestOptions: { timeoutMs: 1 },
      fetch: (async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return Response.json({ healthy: true })
      }) as typeof fetch,
    })
    await expect(client.health({ timeoutMs: 0 })).resolves.toEqual({ healthy: true })
  })
})

describe("request cleanup", () => {
  test.each([-1, 0.5, NaN, Infinity, 2_147_483_648])(
    "rejects invalid timeout before dispatch: %s",
    async (timeoutMs) => {
      const action = vi.fn()
      await expect(runHeadlessRequest({ timeoutMs }, action)).rejects.toBeInstanceOf(RangeError)
      expect(action).not.toHaveBeenCalled()
    },
  )

  test("removes caller abort listeners and clears deadlines after completion", async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const add = vi.spyOn(controller.signal, "addEventListener")
      const remove = vi.spyOn(controller.signal, "removeEventListener")
      expect(await runHeadlessRequest({ signal: controller.signal, timeoutMs: 1000 }, async () => true)).toBe(true)
      expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1])
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
