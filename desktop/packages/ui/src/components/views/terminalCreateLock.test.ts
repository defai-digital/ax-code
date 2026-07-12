import { describe, expect, test, vi, beforeEach } from "vitest"

import {
  resetTerminalCreateLocksForTests,
  terminalCreateLockKey,
  withTerminalSessionCreate,
} from "./terminalCreateLock"

describe("withTerminalSessionCreate", () => {
  beforeEach(() => {
    resetTerminalCreateLocksForTests()
  })

  test("returns a stable lock key per directory tab", () => {
    expect(terminalCreateLockKey("/repo", "tab-1")).toBe("/repo::tab-1")
  })

  test("coalesces concurrent creates for the same tab into one create call", async () => {
    let resolveCreate!: (value: string) => void
    const create = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveCreate = resolve
        }),
    )

    const first = withTerminalSessionCreate("/repo", "tab-1", create)
    const second = withTerminalSessionCreate("/repo", "tab-1", create)

    expect(create).toHaveBeenCalledTimes(1)

    resolveCreate("session-1")
    await expect(Promise.all([first, second])).resolves.toEqual(["session-1", "session-1"])
  })

  test("allows a later create after the first settles", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce("session-1")
      .mockResolvedValueOnce("session-2")

    await expect(withTerminalSessionCreate("/repo", "tab-1", create)).resolves.toBe("session-1")
    await expect(withTerminalSessionCreate("/repo", "tab-1", create)).resolves.toBe("session-2")
    expect(create).toHaveBeenCalledTimes(2)
  })
})
