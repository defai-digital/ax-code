import { describe, expect, test } from "vitest"

import { shouldAutoOpenChatDraft } from "./chatDraftState"

describe("shouldAutoOpenChatDraft", () => {
  test("does not replace a session while a session route is restoring", () => {
    expect(
      shouldAutoOpenChatDraft({
        autoOpenDraft: true,
        currentSessionId: null,
        draftOpen: false,
        hasSessionRoute: true,
      }),
    ).toBe(false)
  })

  test("opens the initial draft when no session route is present", () => {
    expect(
      shouldAutoOpenChatDraft({
        autoOpenDraft: true,
        currentSessionId: null,
        draftOpen: false,
        hasSessionRoute: false,
      }),
    ).toBe(true)
  })

  test("does not open a draft when a session or existing draft is active", () => {
    expect(
      shouldAutoOpenChatDraft({
        autoOpenDraft: true,
        currentSessionId: "ses_active",
        draftOpen: false,
        hasSessionRoute: false,
      }),
    ).toBe(false)
    expect(
      shouldAutoOpenChatDraft({
        autoOpenDraft: true,
        currentSessionId: null,
        draftOpen: true,
        hasSessionRoute: false,
      }),
    ).toBe(false)
  })
})
