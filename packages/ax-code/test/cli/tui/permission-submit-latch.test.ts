import { describe, expect, test } from "vitest"
import {
  armPermissionLatchForRequest,
  canSubmitPermission,
  createPermissionSubmitLatch,
  endPermissionSubmit,
  tryBeginPermissionSubmit,
} from "../../../src/cli/cmd/tui/util/permission-submit-latch"

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
})
