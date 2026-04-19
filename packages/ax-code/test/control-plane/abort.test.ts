import { describe, expect, test } from "bun:test"
import { waitForAbortOrTimeout } from "../../src/control-plane/abort"

describe("control-plane/waitForAbortOrTimeout", () => {
  test("removes the abort listener when the timer wins", async () => {
    const controller = new AbortController()
    let added = 0
    let removed = 0

    const originalAdd = controller.signal.addEventListener.bind(controller.signal)
    const originalRemove = controller.signal.removeEventListener.bind(controller.signal)

    controller.signal.addEventListener = ((type, listener, options) => {
      if (type === "abort") added++
      return originalAdd(type, listener, options)
    }) as typeof controller.signal.addEventListener

    controller.signal.removeEventListener = ((type, listener, options) => {
      if (type === "abort") removed++
      return originalRemove(type, listener, options)
    }) as typeof controller.signal.removeEventListener

    await waitForAbortOrTimeout(controller.signal, 0)
    await waitForAbortOrTimeout(controller.signal, 0)
    await waitForAbortOrTimeout(controller.signal, 0)

    expect(added).toBe(3)
    expect(removed).toBe(3)
  })

  test("resolves promptly when aborted", async () => {
    const controller = new AbortController()
    const wait = waitForAbortOrTimeout(controller.signal, 10_000)
    controller.abort()
    await expect(wait).resolves.toBeUndefined()
  })
})
