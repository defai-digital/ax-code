import { describe, expect, test, vi } from "vitest"
import { createEventSource } from "../../../src/cli/cmd/tui/thread"

describe("createEventSource global event forwarding", () => {
  test("forwards global.event RPC payloads to the SDK event handler (regression: upgrade notifications lost)", () => {
    const channels = new Map<string, (data: unknown) => void>()
    const client = {
      on: vi.fn((channel: string, handler: (data: unknown) => void) => {
        channels.set(channel, handler)
        return () => channels.delete(channel)
      }),
      call: vi.fn(async () => undefined),
    }

    const events = createEventSource(client as any)
    const handler = vi.fn()
    const unsubscribe = events.on(handler)

    // The per-directory stream registers on "event" ...
    expect(channels.has("event")).toBe(true)
    // ... and the cross-directory GlobalBus stream registers on "global.event".
    expect(channels.has("global.event")).toBe(true)

    // A background upgrade publishes via Bus.publish -> emitGlobal -> Rpc
    // "global.event" with a { directory, payload } envelope. The payload must
    // reach the handler so installation.updated/update-available surface in
    // the TUI even when the active session lives in a different directory.
    const payload = { type: "installation.updated", properties: { version: "9.0.0" } }
    channels.get("global.event")!({ directory: "/some/worktree", payload })

    expect(handler).toHaveBeenCalledWith(payload)

    // unsubscribe removes only the channels registered by `on`; the internal
    // "event.status" subscription (registered during createEventSource) stays.
    unsubscribe()
    expect(channels.has("event")).toBe(false)
    expect(channels.has("global.event")).toBe(false)
  })
})
