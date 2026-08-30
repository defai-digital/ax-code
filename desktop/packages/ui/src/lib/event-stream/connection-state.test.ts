// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest"
import { markStreamConnected, markStreamDisconnected, selectIsConnected, useConnectionStore } from "./connection-state"

const reset = () => {
  useConnectionStore.setState({ phase: "connecting", hasEverConnected: false, lastDisconnectReason: null })
}

beforeEach(reset)

describe("connection-state store", () => {
  it("starts in the initial connecting phase, never connected", () => {
    expect(useConnectionStore.getState()).toEqual({
      phase: "connecting",
      hasEverConnected: false,
      lastDisconnectReason: null,
    })
    expect(selectIsConnected(useConnectionStore.getState())).toBe(false)
  })

  it("markStreamConnected flips to connected and records hasEverConnected", () => {
    markStreamConnected()

    const state = useConnectionStore.getState()
    expect(state.phase).toBe("connected")
    expect(state.hasEverConnected).toBe(true)
    expect(selectIsConnected(state)).toBe(true)
  })

  it("markStreamDisconnected before the first connect stays in connecting", () => {
    markStreamDisconnected("ws_closed:code=1006")

    const state = useConnectionStore.getState()
    expect(state.phase).toBe("connecting")
    expect(state.hasEverConnected).toBe(false)
    expect(state.lastDisconnectReason).toBe("ws_closed:code=1006")
  })

  it("markStreamDisconnected after a connect switches to reconnecting with the reason", () => {
    markStreamConnected()
    markStreamDisconnected("sse_heartbeat_timeout")

    const state = useConnectionStore.getState()
    expect(state.phase).toBe("reconnecting")
    expect(state.hasEverConnected).toBe(true)
    expect(state.lastDisconnectReason).toBe("sse_heartbeat_timeout")
    expect(selectIsConnected(state)).toBe(false)
  })

  it("markStreamConnected keeps the last disconnect reason for the next outage banner", () => {
    markStreamConnected()
    markStreamDisconnected("ws_closed:code=1006")
    markStreamConnected()

    const state = useConnectionStore.getState()
    expect(state.phase).toBe("connected")
    expect(state.lastDisconnectReason).toBe("ws_closed:code=1006")
  })
})
