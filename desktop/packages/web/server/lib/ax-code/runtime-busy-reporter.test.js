import { describe, expect, it, vi } from "vitest"

import { createRuntimeBusyReporter } from "./runtime-busy-reporter.js"

const createParentPortProcess = () => {
  const postMessage = vi.fn()
  return { postMessage, processLike: { parentPort: { postMessage } } }
}

describe("createRuntimeBusyReporter", () => {
  it("requires a getActiveSessionCount function", () => {
    expect(() => createRuntimeBusyReporter({})).toThrow(TypeError)
  })

  it("posts the count on change and dedupes repeats", () => {
    const { postMessage, processLike } = createParentPortProcess()
    let count = 0
    const reporter = createRuntimeBusyReporter({
      getProcess: () => processLike,
      getActiveSessionCount: () => count,
    })

    reporter.report()
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenLastCalledWith({ type: "runtime-busy", count: 0 })

    reporter.report()
    expect(postMessage).toHaveBeenCalledTimes(1)

    count = 2
    reporter.report()
    reporter.report()
    expect(postMessage).toHaveBeenCalledTimes(2)
    expect(postMessage).toHaveBeenLastCalledWith({ type: "runtime-busy", count: 2 })

    count = 0
    reporter.report()
    expect(postMessage).toHaveBeenCalledTimes(3)
    expect(postMessage).toHaveBeenLastCalledWith({ type: "runtime-busy", count: 0 })
  })

  it("stays inert without a parentPort (standalone web mode)", () => {
    const reporter = createRuntimeBusyReporter({
      getProcess: () => ({}),
      getActiveSessionCount: () => 3,
    })
    expect(() => reporter.report()).not.toThrow()
  })

  it("swallows postMessage failures", () => {
    const reporter = createRuntimeBusyReporter({
      getProcess: () => ({
        parentPort: {
          postMessage: () => {
            throw new Error("channel closed")
          },
        },
      }),
      getActiveSessionCount: () => 1,
    })
    expect(() => reporter.report()).not.toThrow()
  })
})
