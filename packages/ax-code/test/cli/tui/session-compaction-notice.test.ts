import { describe, expect, test } from "vitest"
import {
  COMPACTION_TOAST,
  compactionToastForActiveSession,
} from "../../../src/cli/cmd/tui/routes/session/compaction-view-model"

describe("tui session compaction toast", () => {
  test("returns the info toast for the active session", () => {
    expect(
      compactionToastForActiveSession({
        compactedSessionID: "ses_a",
        activeSessionID: "ses_a",
      }),
    ).toEqual({
      variant: "info",
      message: "Context compacted. Older messages were summarized.",
      duration: 5000,
    })
    expect(COMPACTION_TOAST.message).toBe("Context compacted. Older messages were summarized.")
  })

  test("suppresses the toast when another session compacted", () => {
    expect(
      compactionToastForActiveSession({
        compactedSessionID: "ses_b",
        activeSessionID: "ses_a",
      }),
    ).toBeUndefined()
  })
})
