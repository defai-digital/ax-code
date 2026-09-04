import { describe, expect, test } from "vitest"
import { BusEvent } from "../../src/bus/bus-event"
import { RuntimeEvent } from "../../src/runtime/events"

describe("runtime event schema", () => {
  test.each([
    { type: "server.heartbeat", properties: {} },
    { type: "server.serialization_error", properties: { error: "circular payload" } },
  ])("includes the emitted $type control frame", (event) => {
    // Keep the runtime event module loaded before building the registry-backed
    // union. Each emitted SSE control frame must be represented in OpenAPI.
    expect(RuntimeEvent).toBeDefined()
    expect(BusEvent.payloads().safeParse(event).success).toBe(true)
  })
})
