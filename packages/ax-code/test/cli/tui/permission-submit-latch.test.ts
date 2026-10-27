import { describe, expect, test } from "vitest"
import {
  armPermissionLatchForRequest,
  canSubmitPermission,
  createPermissionSubmitLatch,
  endPermissionSubmit,
  endPermissionSubmitFor,
  tryBeginPermissionSubmit,
} from "../../../src/cli/tui/util/permission-submit-latch"

describe("permission-submit-latch", () => {
  test("blocks double submit for the same request", () => {
    let state = createPermissionSubmitLatch("req-1")
    const first = tryBeginPermissionSubmit(state, "req-1")
    expect(first).not.toBeNull()
    state = first!
    expect(state.submitting).toBe(true)
    expect(tryBeginPermissionSubmit(state, "req-1")).toBeNull()
    expect(canSubmitPermission(state, "req-1")).toBe(false)
  })

  test("re-arms when request id changes", () => {
    let state = tryBeginPermissionSubmit(createPermissionSubmitLatch("req-1"), "req-1")!
    state = armPermissionLatchForRequest(state, "req-2")
    expect(state.submitting).toBe(false)
    expect(state.armedForId).toBe("req-2")
    const next = tryBeginPermissionSubmit(state, "req-2")
    expect(next?.submitting).toBe(true)
  })

  test("endPermissionSubmit clears in-flight flag", () => {
    let state = tryBeginPermissionSubmit(createPermissionSubmitLatch("req-1"), "req-1")!
    state = endPermissionSubmit(state)
    expect(state.submitting).toBe(false)
    expect(tryBeginPermissionSubmit(state, "req-1")).not.toBeNull()
  })

  test("a late failure of a replaced request keeps the next request's guard", () => {
    // Reply to A is in flight, then the prompt re-arms for queued request B.
    tryBeginPermissionSubmit(createPermissionSubmitLatch("req-a"), "req-a")
    let state = tryBeginPermissionSubmit(createPermissionSubmitLatch("req-b"), "req-b")!
    // A's reply now times out.
    state = endPermissionSubmitFor(state, "req-a")
    expect(state).toMatchObject({ submitting: true, armedForId: "req-b" })
    expect(tryBeginPermissionSubmit(state, "req-b")).toBeNull()
    // B's own failure still releases it for a retry.
    expect(endPermissionSubmitFor(state, "req-b").submitting).toBe(false)
  })
})
