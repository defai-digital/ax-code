import React, { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRoot, type Root } from "react-dom/client"
import {
  FakeEventSource,
  installFakeEventSource,
  restoreEnvironment,
  saveEnvironment,
  setVisibilityState,
  type SavedEnvironment,
} from "./test-fakes"

let desktopShell = false
let webRuntime = true
let nativeNotificationsEnabled = true
let notificationMode: "always" | "hidden-only" = "always"
const notifyAgentCompletion = vi.fn()

vi.doMock("@/lib/desktop", () => ({
  isDesktopShell: () => desktopShell,
  isWebRuntime: () => webRuntime,
}))

vi.doMock("@/contexts/runtimeAPIRegistry", () => ({
  getRegisteredRuntimeAPIs: () => ({ notifications: { notifyAgentCompletion } }),
}))

vi.doMock("@/stores/useUIStore", () => ({
  useUIStore: {
    getState: () => ({ nativeNotificationsEnabled, notificationMode }),
  },
}))

const { useWebNotificationStream } = await import("@/hooks/useWebNotificationStream")

const Harness = ({ enabled }: { enabled?: boolean }) => {
  useWebNotificationStream({ enabled })
  return null
}

let saved: SavedEnvironment
let container: HTMLDivElement
let root: Root

const render = (enabled?: boolean) => {
  act(() => {
    root.render(React.createElement(Harness, { enabled }))
  })
}

const emitNotification = (properties: Record<string, unknown>, type = "openchamber:notification") => {
  FakeEventSource.instances[0].emitMessage(JSON.stringify({ type, properties }))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  saved = saveEnvironment()
  installFakeEventSource()
  desktopShell = false
  webRuntime = true
  nativeNotificationsEnabled = true
  notificationMode = "always"
  notifyAgentCompletion.mockClear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.useRealTimers()
  restoreEnvironment(saved)
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
})

describe("useWebNotificationStream — runtime gating", () => {
  it("does not subscribe inside the desktop shell", () => {
    desktopShell = true
    render()
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it("does not subscribe outside the web runtime", () => {
    webRuntime = false
    render()
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it("does not subscribe when disabled", () => {
    render(false)
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it("subscribes to the notification stream in the web runtime", () => {
    render()
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].url).toBe("/api/notifications/stream")
  })
})

describe("useWebNotificationStream — notification filtering", () => {
  it("forwards notifications in always mode", () => {
    render()
    FakeEventSource.instances[0].emitOpen()
    emitNotification({ title: "Done", body: "Turn complete", tag: "t1" })

    expect(notifyAgentCompletion).toHaveBeenCalledTimes(1)
    expect(notifyAgentCompletion).toHaveBeenCalledWith({ title: "Done", body: "Turn complete", tag: "t1" })
  })

  it("suppresses notifications in hidden-only mode while the window is focused", () => {
    notificationMode = "hidden-only"
    setVisibilityState("visible")
    const focusSpy = vi.spyOn(document, "hasFocus").mockReturnValue(true)
    render()
    FakeEventSource.instances[0].emitOpen()
    emitNotification({ title: "Done" })

    expect(notifyAgentCompletion).not.toHaveBeenCalled()
    focusSpy.mockRestore()
  })

  it("delivers notifications in hidden-only mode while the window is hidden", () => {
    notificationMode = "hidden-only"
    setVisibilityState("hidden")
    render()
    FakeEventSource.instances[0].emitOpen()
    emitNotification({ title: "Done" })

    expect(notifyAgentCompletion).toHaveBeenCalledTimes(1)
  })

  it("suppresses notifications when native notifications are disabled", () => {
    nativeNotificationsEnabled = false
    render()
    FakeEventSource.instances[0].emitOpen()
    emitNotification({ title: "Done" })

    expect(notifyAgentCompletion).not.toHaveBeenCalled()
  })

  it("ignores non-notification envelopes", () => {
    render()
    FakeEventSource.instances[0].emitOpen()
    emitNotification({ title: "Done" }, "openchamber:heartbeat")

    expect(notifyAgentCompletion).not.toHaveBeenCalled()
  })
})

describe("useWebNotificationStream — heartbeat stays disabled", () => {
  it("never reconnects after long silence", async () => {
    vi.useFakeTimers()
    render()
    const source = FakeEventSource.instances[0]
    source.emitOpen()

    await vi.advanceTimersByTimeAsync(300_000)

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(source.readyState).not.toBe(FakeEventSource.CLOSED)
  })
})
