import { describe, expect, test, vi } from "vitest"
import { cleanupStaleCreatedTerminalSession } from "./terminalCreateCleanup"

describe("cleanupStaleCreatedTerminalSession", () => {
  test("clears the stale tab connecting state before closing the session", async () => {
    const calls: string[] = []
    const closeSession = vi.fn(async () => {
      calls.push("close")
    })
    const setConnecting = vi.fn(() => {
      calls.push("connecting")
    })

    await cleanupStaleCreatedTerminalSession(closeSession, setConnecting, "/repo", "tab-1", "term-1")

    expect(setConnecting).toHaveBeenCalledWith("/repo", "tab-1", false)
    expect(closeSession).toHaveBeenCalledWith("term-1")
    expect(calls).toEqual(["connecting", "close"])
  })

  test("keeps the stale tab cleared even when closing the stale session fails", async () => {
    const closeSession = vi.fn(async () => {
      throw new Error("close failed")
    })
    const setConnecting = vi.fn()

    await expect(
      cleanupStaleCreatedTerminalSession(closeSession, setConnecting, "/repo", "tab-1", "term-1"),
    ).resolves.toBeUndefined()

    expect(setConnecting).toHaveBeenCalledWith("/repo", "tab-1", false)
    expect(closeSession).toHaveBeenCalledWith("term-1")
  })
})
