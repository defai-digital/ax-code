import { describe, expect, test } from "vitest"
import { findSessionById, isLegacyWorkSession } from "./workSession"

describe("legacy Work session detection", () => {
  test("detects metadata.work", () => {
    expect(isLegacyWorkSession({ metadata: { work: { version: 1, computer: false } } })).toBe(true)
    expect(isLegacyWorkSession({ metadata: { review: { kind: "pr" } } })).toBe(false)
    expect(isLegacyWorkSession({ metadata: {} })).toBe(false)
    expect(isLegacyWorkSession(undefined)).toBe(false)
  })

  test("finds a session by id", () => {
    const sessions = [
      { id: "ses_a", metadata: {} },
      { id: "ses_b", metadata: { work: { version: 1, computer: true } } },
    ]
    expect(findSessionById("ses_b", sessions)?.metadata?.work).toEqual({ version: 1, computer: true })
    expect(findSessionById("missing", sessions)).toBeUndefined()
  })
})
