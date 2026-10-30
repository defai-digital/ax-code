import { expect, test, vi } from "vitest"
import { InternalKeyHandler } from "../src/lib/key-handler.js"
import type { KeyHandlerEventMap } from "../src/lib/key-handler.js"
import type { ParsedKey } from "../src/lib/parse.keypress.js"

const parsedKey: ParsedKey = {
  name: "a",
  ctrl: false,
  meta: false,
  shift: false,
  option: false,
  sequence: "a",
  number: false,
  raw: "a",
  eventType: "press",
  source: "raw",
}

test("non-input events preserve Node EventEmitter lifecycle, symbol and error semantics", () => {
  const handler = new InternalKeyHandler()
  const added = vi.fn()
  const removed = vi.fn()
  handler.on("newListener", added)
  handler.on("removeListener", removed)
  const symbol = Symbol("diagnostic")
  const listener = vi.fn()
  handler.once(symbol, listener)
  expect(added).toHaveBeenCalledWith(symbol, listener)
  expect(handler.emit(symbol, "payload")).toBe(true)
  expect(listener).toHaveBeenCalledWith("payload")
  expect(removed).toHaveBeenCalledWith(symbol, listener)
  expect(handler.emit(symbol, "again")).toBe(false)
  const error = new Error("unhandled diagnostic")
  expect(() => handler.emit("error", error)).toThrow(error)
  const onError = vi.fn()
  handler.once("error", onError)
  expect(handler.emit("error", error)).toBe(true)
  expect(onError).toHaveBeenCalledWith(error)
})

function dispatch(handler: InternalKeyHandler, event: keyof KeyHandlerEventMap): void {
  if (event === "paste") {
    handler.processPaste(new Uint8Array([65]))
  } else {
    handler.processParsedKey({ ...parsedKey, eventType: event === "keyrelease" ? "release" : "press" })
  }
}

test.each(["keypress", "keyrelease", "paste"] as const)("once listeners are removed after %s", (event) => {
  const handler = new InternalKeyHandler()
  const listener = vi.fn()
  const prependedListener = vi.fn()
  handler.once(event, listener)
  handler.prependOnceListener(event, prependedListener)

  dispatch(handler, event)
  dispatch(handler, event)

  expect(listener).toHaveBeenCalledOnce()
  expect(prependedListener).toHaveBeenCalledOnce()
  expect(handler.listenerCount(event)).toBe(0)
})

test("once listeners are removed before a reentrant dispatch", () => {
  const handler = new InternalKeyHandler()
  let calls = 0
  handler.once("keypress", () => {
    calls += 1
    if (calls === 1) dispatch(handler, "keypress")
  })

  dispatch(handler, "keypress")

  expect(calls).toBe(1)
  expect(handler.listenerCount("keypress")).toBe(0)
})

test.each(["keypress", "keyrelease", "paste"] as const)("%s listeners receive the emitter as this", (event) => {
  const handler = new InternalKeyHandler()
  let receiver: InternalKeyHandler | undefined
  handler.on(event, function (this: InternalKeyHandler) {
    receiver = this
  })

  dispatch(handler, event)

  expect(receiver).toBe(handler)
})

test("stopping global propagation preserves pending once listeners and skips renderable handlers", () => {
  const handler = new InternalKeyHandler()
  const pending = vi.fn()
  const renderable = vi.fn()
  handler.once("keypress", (event) => event.stopPropagation())
  handler.once("keypress", pending)
  handler.onInternal("keypress", renderable)

  dispatch(handler, "keypress")
  expect(pending).not.toHaveBeenCalled()
  expect(renderable).not.toHaveBeenCalled()
  expect(handler.listenerCount("keypress")).toBe(1)

  dispatch(handler, "keypress")
  expect(pending).toHaveBeenCalledOnce()
  expect(renderable).toHaveBeenCalledOnce()
  expect(handler.listenerCount("keypress")).toBe(0)
})

test("preventing the default preserves other global handlers and skips renderable handlers", () => {
  const handler = new InternalKeyHandler()
  const global = vi.fn()
  const renderable = vi.fn()
  handler.onInternal("keypress", renderable)
  handler.on("keypress", (event) => event.preventDefault())
  handler.on("keypress", global)

  dispatch(handler, "keypress")

  expect(global).toHaveBeenCalledOnce()
  expect(renderable).not.toHaveBeenCalled()
})

test("renderable handlers can stop propagation after global handlers run", () => {
  const handler = new InternalKeyHandler()
  const global = vi.fn()
  const skipped = vi.fn()
  handler.onInternal("keypress", (event) => event.stopPropagation())
  handler.onInternal("keypress", skipped)
  handler.on("keypress", global)

  dispatch(handler, "keypress")

  expect(global).toHaveBeenCalledOnce()
  expect(skipped).not.toHaveBeenCalled()
})
