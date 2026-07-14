import { describe, expect, test } from "vitest"

import { omitRecoveredAssistantMessages, recoveredAssistantMessageIds } from "./recoveredAssistantMessages"

describe("recoveredAssistantMessageIds", () => {
  test("hides a failed attempt once a later assistant attempt is successful", () => {
    const failed = { info: { id: "failed", error: { message: "invalid access token" } } }
    const recovered = { info: { id: "recovered" } }

    expect(recoveredAssistantMessageIds([failed, recovered])).toEqual(new Set(["failed"]))
    expect(omitRecoveredAssistantMessages([failed, recovered])).toEqual([recovered])
  })

  test("keeps the final failed attempt visible", () => {
    const failed = { info: { id: "failed", error: { message: "invalid access token" } } }

    expect(recoveredAssistantMessageIds([failed])).toEqual(new Set())
    expect(omitRecoveredAssistantMessages([failed])).toEqual([failed])
  })
})
