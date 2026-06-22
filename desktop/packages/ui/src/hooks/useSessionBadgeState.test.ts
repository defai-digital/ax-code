import { describe, expect, test } from "vitest"
import type { SessionStatus } from "@ax-code/sdk/v2/client"
import type { PermissionRequest } from "@/types/permission"

import { computeSessionBadgeState } from "./useSessionBadgeState"

const permission = { id: "perm_1" } as PermissionRequest
const status = (type: string): SessionStatus => ({ type }) as SessionStatus

const base = {
  status: undefined as SessionStatus | undefined,
  permissions: [] as readonly PermissionRequest[],
  ranWithUncommitted: false,
  hasError: false,
  hasUnreadAttention: false,
}

describe("computeSessionBadgeState", () => {
  test("idle by default", () => {
    expect(computeSessionBadgeState(base)).toBe("idle")
  })

  test("pending permissions outrank everything", () => {
    expect(
      computeSessionBadgeState({
        ...base,
        status: status("busy"),
        permissions: [permission],
        ranWithUncommitted: true,
        hasError: true,
        hasUnreadAttention: true,
      }),
    ).toBe("waiting_for_permission")
  })

  test("busy and retry map to running", () => {
    expect(computeSessionBadgeState({ ...base, status: status("busy") })).toBe("running")
    expect(computeSessionBadgeState({ ...base, status: status("retry") })).toBe("running")
  })

  test("running outranks error and dirty state", () => {
    expect(
      computeSessionBadgeState({
        ...base,
        status: status("busy"),
        ranWithUncommitted: true,
        hasError: true,
      }),
    ).toBe("running")
  })

  test("error outranks done_with_uncommitted and unread", () => {
    expect(
      computeSessionBadgeState({
        ...base,
        hasError: true,
        ranWithUncommitted: true,
        hasUnreadAttention: true,
      }),
    ).toBe("error")
  })

  test("finished run with uncommitted changes", () => {
    expect(computeSessionBadgeState({ ...base, ranWithUncommitted: true })).toBe("done_with_uncommitted")
  })

  test("unread attention shows when nothing else applies", () => {
    expect(computeSessionBadgeState({ ...base, hasUnreadAttention: true })).toBe("unread")
  })
})
