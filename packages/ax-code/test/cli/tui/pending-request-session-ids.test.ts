import { describe, expect, test } from "vitest"
import { sessionIDsWithPendingRequests } from "../../../src/cli/tui/util/pending-request-notices"

describe("sessionIDsWithPendingRequests", () => {
  test("collects session ids across permission and question records", () => {
    const ids = sessionIDsWithPendingRequests(
      { ses_a: [{ id: "p1", sessionID: "ses_a" }], ses_b: undefined },
      {
        ses_c: [
          { id: "q1", sessionID: "ses_c" },
          { id: "q2", sessionID: "ses_c" },
        ],
      },
    )
    expect([...ids].toSorted()).toEqual(["ses_a", "ses_c"])
    expect(sessionIDsWithPendingRequests({}, {}).size).toBe(0)
  })
})
