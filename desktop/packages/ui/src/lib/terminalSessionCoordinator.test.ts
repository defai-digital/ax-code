import { describe, expect, test, vi, beforeEach } from "vitest"

import {
  ensureClaimedTerminalSession,
  resetTerminalCreateLocksForTests,
  terminalCreateLockKey,
  withTerminalSessionCreate,
} from "./terminalSessionCoordinator"

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
    const create = vi.fn().mockResolvedValueOnce("session-1").mockResolvedValueOnce("session-2")

    await expect(withTerminalSessionCreate("/repo", "tab-1", create)).resolves.toBe("session-1")
    await expect(withTerminalSessionCreate("/repo", "tab-1", create)).resolves.toBe("session-2")
    expect(create).toHaveBeenCalledTimes(2)
  })

  test("claims a coalesced PTY before any caller resumes", async () => {
    let resolveCreate!: (value: string) => void
    let claimedSessionId: string | null = null
    const createSession = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveCreate = resolve
        }),
    )
    const claimSession = vi.fn((sessionId: string) => {
      claimedSessionId = sessionId
      return true
    })
    const closeSession = vi.fn(async () => {})
    const dependencies = {
      getClaimedSessionId: () => claimedSessionId,
      createSession,
      claimSession,
      closeSession,
    }

    const first = ensureClaimedTerminalSession("/repo", "tab-1", dependencies).then((sessionId) => {
      expect(claimedSessionId).toBe(sessionId)
      return sessionId
    })
    const second = ensureClaimedTerminalSession("/repo", "tab-1", dependencies).then((sessionId) => {
      expect(claimedSessionId).toBe(sessionId)
      return sessionId
    })

    expect(createSession).toHaveBeenCalledTimes(1)
    resolveCreate("session-1")

    await expect(Promise.all([first, second])).resolves.toEqual(["session-1", "session-1"])
    expect(claimSession).toHaveBeenCalledTimes(1)
    expect(closeSession).not.toHaveBeenCalled()
  })

  test("closes a PTY when its tab disappears before it can be claimed", async () => {
    const closeSession = vi.fn(async () => {})

    await expect(
      ensureClaimedTerminalSession("/repo", "tab-1", {
        getClaimedSessionId: () => null,
        createSession: async () => "orphan-session",
        claimSession: () => false,
        closeSession,
      }),
    ).resolves.toBeNull()

    expect(closeSession).toHaveBeenCalledOnce()
    expect(closeSession).toHaveBeenCalledWith("orphan-session")
  })

  test("keeps a session claimed by another owner and closes only the duplicate", async () => {
    let claimedSessionId: string | null = null
    let resolveCreate!: (value: string) => void
    const closeSession = vi.fn(async () => {})
    const pending = ensureClaimedTerminalSession("/repo", "tab-1", {
      getClaimedSessionId: () => claimedSessionId,
      createSession: () =>
        new Promise<string>((resolve) => {
          resolveCreate = resolve
        }),
      claimSession: () => {
        throw new Error("the raced session must win without another claim")
      },
      closeSession,
    })

    claimedSessionId = "winning-session"
    resolveCreate("duplicate-session")

    await expect(pending).resolves.toBe("winning-session")
    expect(closeSession).toHaveBeenCalledWith("duplicate-session")
  })
})
