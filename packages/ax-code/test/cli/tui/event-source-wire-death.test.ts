import { describe, expect, test, vi } from "vitest"
import { createEventSource } from "../../../src/cli/cmd/tui/thread"
import { TUI_BACKEND_EXITED, type StreamConnectionStatus } from "../../../src/cli/cmd/tui/util/resilient-stream"

function fakeClient() {
  return {
    on: vi.fn((_channel: string, _handler: (data: unknown) => void) => () => {}),
    call: vi.fn(async (_method: string, _params: unknown) => undefined),
  }
}

function fakeWire(overrides: Partial<{ onWireDeath: (() => void) | null; wireClosed: boolean }> = {}) {
  return {
    postMessage: (_data: string) => {},
    onmessage: null,
    onWireDeath: null as (() => void) | null,
    wireClosed: false,
    ...overrides,
  }
}

describe("createEventSource wire death propagation", () => {
  test("emits a terminal backend-exited status when the wire dies, after the previous handler", () => {
    const previous = vi.fn()
    const wire = fakeWire({ onWireDeath: previous })
    const events = createEventSource(fakeClient() as any, wire)
    const statuses: StreamConnectionStatus[] = []
    events.onStatus!((status) => statuses.push(status))

    wire.onWireDeath!()

    // The RPC client's fast-fail handler must still run (chained, not replaced).
    expect(previous).toHaveBeenCalledTimes(1)
    expect(statuses.at(-1)).toEqual({
      connected: false,
      phase: "stopped",
      attempt: 0,
      reason: "error",
      error: TUI_BACKEND_EXITED,
    })
  })

  test("replays the terminal status when the wire already died before chaining", () => {
    // The process transport nulls onWireDeath after firing; a death between
    // Rpc.client creation and createEventSource must still reach the UI.
    const wire = fakeWire({ onWireDeath: null, wireClosed: true })
    const events = createEventSource(fakeClient() as any, wire)
    const statuses: StreamConnectionStatus[] = []
    events.onStatus!((status) => statuses.push(status))

    expect(statuses[0]?.connected).toBe(false)
    expect(statuses[0]?.error).toBe(TUI_BACKEND_EXITED)
  })

  test("emits nothing without a wire", () => {
    const events = createEventSource(fakeClient() as any)
    const statuses: StreamConnectionStatus[] = []
    events.onStatus!((status) => statuses.push(status))
    expect(statuses).toEqual([])
  })
})
