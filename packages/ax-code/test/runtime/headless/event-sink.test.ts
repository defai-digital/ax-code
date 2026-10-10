import { describe, expect, test } from "vitest"
import { createHeadlessCompositeEventSink } from "../../../src/runtime/headless/event-sink"

describe("composite headless event sink", () => {
  test("close runs every sink in reverse order and reports the first failure", async () => {
    const closed: string[] = []
    const sink = createHeadlessCompositeEventSink([
      { write: () => undefined, close: () => void closed.push("a") },
      {
        write: () => undefined,
        close: () => {
          closed.push("b")
          throw new Error("b failed")
        },
      },
      { write: () => undefined, close: () => void closed.push("c") },
    ])

    await expect(sink.close?.()).rejects.toThrow("b failed")
    expect(closed).toEqual(["c", "b", "a"])
  })

  test("write stays ordered across sinks", async () => {
    const seen: string[] = []
    const sink = createHeadlessCompositeEventSink([
      { write: async () => void seen.push("first") },
      { write: () => void seen.push("second") },
    ])
    await sink.write({})
    expect(seen).toEqual(["first", "second"])
  })
})
