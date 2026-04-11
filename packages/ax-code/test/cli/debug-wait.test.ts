import { describe, expect, test } from "bun:test"
import { waitForSignal } from "../../src/cli/cmd/debug"

describe("cli.debug.waitForSignal", () => {
  test("resolves on SIGINT and removes handlers", async () => {
    const slots = new Map<string, () => void>()
    const wait = waitForSignal({
      on: (signal, fn) => void slots.set(signal, fn),
      off: (signal, fn) => {
        if (slots.get(signal) === fn) slots.delete(signal)
      },
    })

    expect(slots.has("SIGINT")).toBe(true)
    expect(slots.has("SIGTERM")).toBe(true)

    slots.get("SIGINT")?.()
    await wait

    expect(slots.size).toBe(0)
  })
})
