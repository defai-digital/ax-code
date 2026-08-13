import { describe, expect, test } from "vitest"
import {
  isWorkSessionMetadata,
  workSessionSendBlockedReason,
  WORK_SESSION_SEND_DISABLED,
} from "../../src/session/work-session"

describe("legacy Work session send policy", () => {
  test("detects Work product metadata", () => {
    expect(isWorkSessionMetadata({ work: { version: 1, computer: false } })).toBe(true)
    expect(isWorkSessionMetadata({ review: { reviewId: "rev_1" } })).toBe(false)
    expect(isWorkSessionMetadata(undefined)).toBe(false)
  })

  test("blocks send for Work metadata or the retired work agent", () => {
    expect(workSessionSendBlockedReason({ metadata: { work: { version: 1, computer: true } } })).toBe(
      WORK_SESSION_SEND_DISABLED,
    )
    expect(workSessionSendBlockedReason({ agent: "work" })).toBe(WORK_SESSION_SEND_DISABLED)
    expect(workSessionSendBlockedReason({ agent: "build" })).toBeUndefined()
  })
})
