import { describe, expect, test } from "vitest"
import {
  createPendingRequestTracker,
  familySessionIDs,
  outsideFamilyRequests,
} from "@/cli/cmd/tui/util/pending-request-notices"

describe("familySessionIDs", () => {
  const sessions = [
    { id: "ses_parent", parentID: undefined },
    { id: "ses_child", parentID: "ses_parent" },
    { id: "ses_other", parentID: undefined },
  ]

  test("includes the open session and its children", () => {
    expect([...familySessionIDs(sessions, "ses_parent")].sort()).toEqual(["ses_child", "ses_parent"])
  })

  test("a child session sees its parent and siblings as family", () => {
    expect([...familySessionIDs(sessions, "ses_child")].sort()).toEqual(["ses_child", "ses_parent"])
  })

  test("an unknown or absent route yields no family beyond the session itself", () => {
    expect([...familySessionIDs(sessions, "ses_missing")]).toEqual(["ses_missing"])
    expect(familySessionIDs(sessions, undefined).size).toBe(0)
  })
})

describe("outsideFamilyRequests", () => {
  test("returns only requests outside the family", () => {
    const requests = {
      ses_parent: [{ id: "perm_1", sessionID: "ses_parent" }],
      ses_automation: [{ id: "perm_2", sessionID: "ses_automation" }],
    }
    const outside = outsideFamilyRequests(requests, new Set(["ses_parent"]))
    expect(outside).toEqual([{ id: "perm_2", sessionID: "ses_automation" }])
  })

  test("tolerates empty and undefined lists", () => {
    expect(outsideFamilyRequests({}, new Set())).toEqual([])
    expect(outsideFamilyRequests({ ses_x: undefined }, new Set())).toEqual([])
  })
})

describe("createPendingRequestTracker", () => {
  test("hands out each request exactly once", () => {
    const tracker = createPendingRequestTracker()
    const request = { id: "perm_1", sessionID: "ses_automation" }
    expect(tracker.update([request])).toEqual([request])
    expect(tracker.update([request])).toEqual([])
  })

  test("prunes answered requests so a re-ask notifies again", () => {
    const tracker = createPendingRequestTracker()
    const first = { id: "perm_1", sessionID: "ses_automation" }
    const second = { id: "perm_2", sessionID: "ses_automation" }
    expect(tracker.update([first])).toEqual([first])
    // first answered, second arrives: only second is fresh.
    expect(tracker.update([second])).toEqual([second])
    // first re-asked after being pruned: fresh again.
    expect(tracker.update([first, second])).toEqual([first])
  })
})
