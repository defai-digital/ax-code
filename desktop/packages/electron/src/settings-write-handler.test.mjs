import { createRequire } from "node:module"
import { describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { createSettingsWriteHandler } = require("./settings-write-handler.js")

// Mirrors main.js: a serialized read-modify-write chain over an in-memory root,
// instrumented so tests can prove mutators never interleave.
const createSerializedStore = (initial = {}) => {
  let root = initial
  let chain = Promise.resolve()
  const events = []
  const mutateSettingsRoot = (mutator) => {
    const next = chain.then(async () => {
      events.push("begin")
      const result = await mutator(root)
      root = result ?? root
      events.push("end")
    })
    chain = next.catch(() => {})
    return next
  }
  return { mutateSettingsRoot, getRoot: () => root, events }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("settings write handler", () => {
  test("ignores unrelated messages", () => {
    const postMessage = vi.fn()
    const mutateSettingsRoot = vi.fn()
    const handler = createSettingsWriteHandler({ mutateSettingsRoot, postMessage })

    expect(handler.handleMessage(null)).toBe(false)
    expect(handler.handleMessage({ type: "ready", port: 1234 })).toBe(false)
    expect(handler.handleMessage({ type: "stop" })).toBe(false)
    expect(mutateSettingsRoot).not.toHaveBeenCalled()
    expect(postMessage).not.toHaveBeenCalled()
  })

  test("applies a valid payload as a full-object replace and replies ok", async () => {
    const store = createSerializedStore({ existing: true, stale: "value" })
    const postMessage = vi.fn()
    const handler = createSettingsWriteHandler({ mutateSettingsRoot: store.mutateSettingsRoot, postMessage })

    expect(handler.handleMessage({ type: "settings-write", id: "req-1", settings: { theme: "dark" } })).toBe(true)
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))

    expect(postMessage).toHaveBeenCalledWith({ type: "settings-write-result", id: "req-1", ok: true })
    // Replace semantics: keys not present in the payload are gone.
    expect(store.getRoot()).toEqual({ theme: "dark" })
  })

  test("serializes concurrent delegated writes with main-side mutations", async () => {
    const store = createSerializedStore({})
    const postMessage = vi.fn()
    const handler = createSettingsWriteHandler({ mutateSettingsRoot: store.mutateSettingsRoot, postMessage })

    handler.handleMessage({ type: "settings-write", id: "req-1", settings: { a: 1 } })
    const mainMutation = store.mutateSettingsRoot(async (root) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      root.desktopWindowState = { width: 800 }
    })
    handler.handleMessage({ type: "settings-write", id: "req-2", settings: { b: 2 } })

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2))
    await mainMutation
    await flush()

    // begin/end pairs must never nest — the chain ran every mutation serially.
    expect(store.events.length % 2).toBe(0)
    for (let i = 0; i < store.events.length; i += 2) {
      expect(store.events[i]).toBe("begin")
      expect(store.events[i + 1]).toBe("end")
    }
    // Three mutations ran (two delegated writes + one main-side).
    expect(store.events).toHaveLength(6)
    // Last delegated write wins the replace.
    expect(store.getRoot()).toEqual({ b: 2 })
    expect(postMessage).toHaveBeenNthCalledWith(1, { type: "settings-write-result", id: "req-1", ok: true })
    expect(postMessage).toHaveBeenNthCalledWith(2, { type: "settings-write-result", id: "req-2", ok: true })
  })

  test.each([
    ["null", null],
    ["an array", [1, 2, 3]],
    ["a string", "nope"],
    ["a number", 42],
    ["undefined", undefined],
  ])("rejects %s payloads without touching the store", async (_label, settings) => {
    const store = createSerializedStore({ untouched: true })
    const postMessage = vi.fn()
    const handler = createSettingsWriteHandler({ mutateSettingsRoot: store.mutateSettingsRoot, postMessage })

    expect(handler.handleMessage({ type: "settings-write", id: "req-bad", settings })).toBe(true)
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))

    const reply = postMessage.mock.calls[0][0]
    expect(reply).toMatchObject({ type: "settings-write-result", id: "req-bad", ok: false })
    expect(typeof reply.error).toBe("string")
    expect(store.getRoot()).toEqual({ untouched: true })
    expect(store.events).toHaveLength(0)
  })

  test("rejects payloads above the size limit", async () => {
    const store = createSerializedStore({})
    const postMessage = vi.fn()
    const handler = createSettingsWriteHandler({
      mutateSettingsRoot: store.mutateSettingsRoot,
      postMessage,
      maxPayloadBytes: 128,
    })

    handler.handleMessage({ type: "settings-write", id: "req-big", settings: { pad: "x".repeat(512) } })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))

    const reply = postMessage.mock.calls[0][0]
    expect(reply.ok).toBe(false)
    expect(reply.error).toContain("128 bytes")
    expect(store.events).toHaveLength(0)
  })

  test("replies with the error when the serialized write fails", async () => {
    const postMessage = vi.fn()
    const handler = createSettingsWriteHandler({
      mutateSettingsRoot: () => Promise.reject(new Error("disk full")),
      postMessage,
    })

    handler.handleMessage({ type: "settings-write", id: "req-fail", settings: { a: 1 } })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))

    expect(postMessage).toHaveBeenCalledWith({
      type: "settings-write-result",
      id: "req-fail",
      ok: false,
      error: "disk full",
    })
  })

  test("never logs setting values, even when replying fails", async () => {
    const logger = { error: vi.fn() }
    const handler = createSettingsWriteHandler({
      mutateSettingsRoot: () => Promise.resolve(),
      postMessage: () => {
        throw new Error("channel gone")
      },
      logger,
    })

    handler.handleMessage({ type: "settings-write", id: "req-secret", settings: { token: "top-secret-value" } })
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1))

    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("top-secret-value")
  })
})
