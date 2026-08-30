import { describe, expect, it, vi } from "vitest"
import { EventEmitter } from "events"
import { createSettingsWriter } from "./settings-writer.js"

class FakeParentPort extends EventEmitter {
  constructor() {
    super()
    this.posted = []
  }
  postMessage(message) {
    this.posted.push(message)
  }
  respond(id, result) {
    this.emit("message", { data: { type: "settings-write-result", id, ...result } })
  }
}

describe("settings writer", () => {
  it("uses the local writer in standalone mode (no parentPort)", async () => {
    const localWrite = vi.fn(async () => {})
    const writer = createSettingsWriter({ parentPort: null, localWrite })

    expect(writer.mode).toBe("local")
    await writer.write({ theme: "dark" })
    expect(localWrite).toHaveBeenCalledWith({ theme: "dark" })
  })

  it("sends an id-correlated request and resolves on the matching response", async () => {
    const parentPort = new FakeParentPort()
    const writer = createSettingsWriter({ parentPort, localWrite: vi.fn(), createRequestId: () => "req-1" })

    expect(writer.mode).toBe("delegate")
    const pending = writer.write({ theme: "dark" })

    expect(parentPort.posted).toEqual([{ type: "settings-write", id: "req-1", settings: { theme: "dark" } }])
    parentPort.respond("req-1", { ok: true })
    await expect(pending).resolves.toBeUndefined()
  })

  it("rejects with the main-process error on a failed response", async () => {
    const parentPort = new FakeParentPort()
    const writer = createSettingsWriter({ parentPort, localWrite: vi.fn(), createRequestId: () => "req-1" })

    const pending = writer.write({ theme: "dark" })
    parentPort.respond("req-1", { ok: false, error: "disk full" })
    await expect(pending).rejects.toThrow("disk full")
  })

  it("correlates concurrent writes by id even when responses arrive out of order", async () => {
    const parentPort = new FakeParentPort()
    let counter = 0
    const writer = createSettingsWriter({ parentPort, localWrite: vi.fn(), createRequestId: () => `req-${++counter}` })

    const first = writer.write({ a: 1 })
    const second = writer.write({ b: 2 })
    const expectation = expect(first).rejects.toThrow("nope")

    parentPort.respond("req-2", { ok: true })
    parentPort.respond("req-1", { ok: false, error: "nope" })

    await expect(second).resolves.toBeUndefined()
    await expectation
  })

  it("ignores unrelated messages and responses for unknown ids", async () => {
    const parentPort = new FakeParentPort()
    const writer = createSettingsWriter({ parentPort, localWrite: vi.fn(), createRequestId: () => "req-1" })

    const pending = writer.write({ theme: "dark" })
    parentPort.emit("message", { data: { type: "stop" } })
    parentPort.emit("message", { data: { type: "settings-write-result", id: "someone-else", ok: true } })
    parentPort.emit("message", { data: null })

    parentPort.respond("req-1", { ok: true })
    await expect(pending).resolves.toBeUndefined()
  })

  it("times out cleanly when main never responds", async () => {
    const parentPort = new FakeParentPort()
    const writer = createSettingsWriter({ parentPort, localWrite: vi.fn(), timeoutMs: 25, createRequestId: () => "r" })

    await expect(writer.write({ theme: "dark" })).rejects.toThrow(/timed out after 25 ms/)

    // A late response for the expired id is ignored without crashing.
    parentPort.respond("r", { ok: true })
  })

  it("rejects pending writes immediately when the channel closes", async () => {
    const parentPort = new FakeParentPort()
    const writer = createSettingsWriter({
      parentPort,
      localWrite: vi.fn(),
      timeoutMs: 60_000,
      createRequestId: () => "req-1",
    })

    const pending = writer.write({ theme: "dark" })
    const expectation = expect(pending).rejects.toThrow(/channel .* closed/)
    parentPort.emit("close")
    await expectation
  })

  it("rejects immediately when postMessage throws", async () => {
    const parentPort = new FakeParentPort()
    parentPort.postMessage = () => {
      throw new Error("channel gone")
    }
    const writer = createSettingsWriter({ parentPort, localWrite: vi.fn(), createRequestId: () => "req-1" })

    await expect(writer.write({ theme: "dark" })).rejects.toThrow("channel gone")
  })
})
