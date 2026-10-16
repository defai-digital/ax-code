import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { Client } from "@modelcontextprotocol/client"
import { SessionHealth } from "../../src/mcp/session-health"

type OnClose = (() => void) | undefined
type PingResult = { ok: true } | { ok: false; error?: unknown }

/**
 * Minimal stub the SessionHealth APIs actually touch. The real MCP
 * `Client` class carries ~100 internal slots; we only need `ping`,
 * `onclose`, and a `callTool` noop for the few tests that exercise
 * dispatch-side wiring. Cast through `unknown` to satisfy the SDK
 * type without mocking the whole transport.
 */
class FakeClient {
  pingResult: PingResult = { ok: true }
  pingDelayMs = 0
  pingCalls = 0
  callToolCalls = 0
  callToolResult: unknown = { content: [] }
  onclose: OnClose
  constructor() {
    this.onclose = undefined
  }
  async ping() {
    this.pingCalls += 1
    if (this.pingDelayMs > 0) await new Promise((r) => setTimeout(r, this.pingDelayMs))
    if (this.pingResult.ok) return
    throw this.pingResult.error ?? new Error("ping failed")
  }
  async callTool() {
    this.callToolCalls += 1
    return this.callToolResult
  }
}

function asClient(fake: FakeClient): Client {
  return fake as unknown as Client
}

describe("SessionHealth", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test("does not ping a recently-used client", async () => {
    const fake = new FakeClient()
    const client = asClient(fake)
    SessionHealth.attachClient(client, "test")
    // The first preflight stamps the client as "now", so even a
    // same-tick call does not trigger a ping.
    const result = await SessionHealth.preflightCall(client, async () => {
      throw new Error("reconnect must not be called when not idle")
    })
    expect(result.retried).toBe(false)
    expect(result.client).toBe(client)
    expect(fake.pingCalls).toBe(0)
    SessionHealth._resetForTests(client)
  })

  test("pings an idle client and skips reconnect when the ping succeeds", async () => {
    const fake = new FakeClient()
    const client = asClient(fake)
    SessionHealth.attachClient(client, "test")
    vi.advanceTimersByTime(SessionHealth.MCP_IDLE_THRESHOLD_MS + 1_000)
    const result = await SessionHealth.preflightCall(client, async () => {
      throw new Error("reconnect must not run when the ping succeeds")
    })
    expect(result.retried).toBe(false)
    expect(result.client).toBe(client)
    expect(fake.pingCalls).toBe(1)
    SessionHealth._resetForTests(client)
  })

  test("reconnects and flags retried when the ping fails", async () => {
    const oldFake = new FakeClient()
    oldFake.pingResult = { ok: false, error: new Error("transport dead") }
    const oldClient = asClient(oldFake)
    const freshClient = asClient(new FakeClient())
    SessionHealth.attachClient(oldClient, "test")
    vi.advanceTimersByTime(SessionHealth.MCP_IDLE_THRESHOLD_MS + 1_000)
    const result = await SessionHealth.preflightCall(oldClient, async () => freshClient)
    expect(result.retried).toBe(true)
    expect(result.client).toBe(freshClient)
    expect(oldFake.pingCalls).toBe(1)
    SessionHealth._resetForTests(oldClient)
    SessionHealth._resetForTests(freshClient)
  })

  test("does not retry again when the reconnect thunk also fails", async () => {
    const fake = new FakeClient()
    fake.pingResult = { ok: false, error: new Error("ping failed") }
    const client = asClient(fake)
    SessionHealth.attachClient(client, "test")
    vi.advanceTimersByTime(SessionHealth.MCP_IDLE_THRESHOLD_MS + 1_000)
    const result = await SessionHealth.preflightCall(client, async () => {
      throw new Error("reconnect failed too")
    })
    expect(result.retried).toBe(false)
    expect(result.client).toBe(client)
    SessionHealth._resetForTests(client)
  })

  test("transport close rejects tracked in-flight calls immediately", async () => {
    const fake = new FakeClient()
    const client = asClient(fake)
    SessionHealth.attachClient(client, "weather-mcp")
    const first = SessionHealth.trackCall(client)
    const second = SessionHealth.trackCall(client)
    if (!fake.onclose) throw new Error("attachClient must wire onclose")
    fake.onclose()
    await expect(first.promise).rejects.toBeInstanceOf(SessionHealth.TransportClosed)
    await expect(second.promise).rejects.toMatchObject({ data: { server: "weather-mcp" } })
    SessionHealth._resetForTests(client)
  })

  test("a call finished before the close is not rejected and does not leak", async () => {
    const fake = new FakeClient()
    const client = asClient(fake)
    SessionHealth.attachClient(client, "weather-mcp")
    const done = SessionHealth.trackCall(client)
    done.finish()
    const pending = SessionHealth.trackCall(client)
    fake.onclose?.()
    await expect(pending.promise).rejects.toBeInstanceOf(SessionHealth.TransportClosed)
    const settled = await Promise.race([
      done.promise.then(
        () => "resolved",
        () => "rejected",
      ),
      Promise.resolve("pending"),
    ])
    expect(settled).toBe("pending")
    SessionHealth._resetForTests(client)
  })

  test("TransportClosed carries the server name", () => {
    const error = new SessionHealth.TransportClosed({ server: "weather-mcp" })
    expect(error.data.server).toBe("weather-mcp")
    expect(error).toBeInstanceOf(SessionHealth.TransportClosed)
  })

  test("trackCall finish clears the slot", () => {
    const client = asClient(new FakeClient())
    SessionHealth.attachClient(client, "test")
    const tracker = SessionHealth.trackCall(client)
    expect(() => tracker.finish()).not.toThrow()
    expect(() => tracker.finish()).not.toThrow()
    SessionHealth._resetForTests(client)
  })

  test("attachClient chains a previous onclose handler", () => {
    const fake = new FakeClient()
    const previous = vi.fn()
    fake.onclose = previous
    const client = asClient(fake)
    SessionHealth.attachClient(client, "test")
    if (!fake.onclose) throw new Error("attachClient must wire onclose")
    fake.onclose()
    expect(previous).toHaveBeenCalled()
    SessionHealth._resetForTests(client)
  })
})
