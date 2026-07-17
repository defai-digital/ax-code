import { describe, expect, test } from "vitest"

import { shouldOpenDraftForEmptyProject } from "./useProjectSessionSelection"

describe("shouldOpenDraftForEmptyProject", () => {
  test("does not replace an active session while project sessions hydrate", () => {
    expect(
      shouldOpenDraftForEmptyProject({ currentSessionId: "ses_active", sessionCount: 0, hasSessionRoute: false }),
    ).toBe(false)
  })

  test("opens a draft when no session is active and the project is empty", () => {
    expect(shouldOpenDraftForEmptyProject({ currentSessionId: null, sessionCount: 0, hasSessionRoute: false })).toBe(
      true,
    )
  })

  test("does not open a draft when the project already has a session", () => {
    expect(shouldOpenDraftForEmptyProject({ currentSessionId: null, sessionCount: 1, hasSessionRoute: false })).toBe(
      false,
    )
  })

  test("does not open a draft while a session route is being restored", () => {
    expect(shouldOpenDraftForEmptyProject({ currentSessionId: null, sessionCount: 0, hasSessionRoute: true })).toBe(
      false,
    )
  })
})
