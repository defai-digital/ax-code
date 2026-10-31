import { describe, expect, test } from "vitest"
import { GlobalBus } from "../../src/bus/global"

// Capture the global journal through a throwaway subscription so each test can
// assert on the exact frame bytes /global/event replays.
function mark() {
  const subscription = GlobalBus.subscribeFrom(undefined, () => {})
  subscription.unsubscribe()
  return subscription.cursor
}

function entriesAfter(cursor: string) {
  const subscription = GlobalBus.subscribeFrom(cursor, () => {})
  subscription.unsubscribe()
  return subscription.replay?.type === "replay" ? subscription.replay.entries : []
}

describe("GlobalBus journal encoding", () => {
  test("reuses a pre-encoded payload frame without changing the envelope bytes", () => {
    const payload = {
      type: "test.global.encoded",
      properties: {
        value: 'héllo\n"quoted"\t<&>',
        nested: { items: [1, 2, { deep: true }], empty: {} },
        missing: undefined,
      },
    }
    const cursor = mark()

    GlobalBus.emit("event", { directory: "/tmp/workspace", payload }, JSON.stringify(payload))

    const [entry] = entriesAfter(cursor)
    expect(entry?.data).toBe(JSON.stringify({ directory: "/tmp/workspace", payload }))
    expect(entry?.bytes).toBe(Buffer.byteLength(entry!.data, "utf8"))
  })

  test("omits an undefined directory exactly like JSON.stringify", () => {
    const payload = { type: "test.global.no-directory", properties: { value: 1 } }
    const cursor = mark()

    GlobalBus.emit("event", { payload }, JSON.stringify(payload))

    const [entry] = entriesAfter(cursor)
    expect(entry?.data).toBe(JSON.stringify({ payload }))
  })

  test("encoded and unencoded emissions of the same event produce identical bytes", () => {
    const payload = { type: "test.global.equivalent", properties: { list: ["a", "b"], n: 3 } }

    const first = mark()
    GlobalBus.emit("event", { directory: "/tmp/equivalent", payload }, JSON.stringify(payload))
    const [encoded] = entriesAfter(first)

    const second = mark()
    GlobalBus.emit("event", { directory: "/tmp/equivalent", payload })
    const [serialized] = entriesAfter(second)

    expect(encoded?.data).toBe(serialized?.data)
    expect(encoded?.bytes).toBe(serialized?.bytes)
  })
})
