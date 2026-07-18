import { describe, expect, test } from "vitest"

import { diffPermissionNotifications } from "./permissionNotificationSync"
import type { PermissionRequest } from "@/types/permission"

const makePermission = (id: string): PermissionRequest => ({
  id,
  sessionID: "session-1",
  permission: "bash",
  patterns: ["pnpm test"],
  metadata: {},
  always: [],
})

describe("diffPermissionNotifications", () => {
  test("adds notifications for newly pending requests", () => {
    const seen = new Map<string, string>()
    const { toAdd, toRemove } = diffPermissionNotifications(seen, [makePermission("perm-1"), makePermission("perm-2")])

    expect(toAdd.map((p) => p.id)).toEqual(["perm-1", "perm-2"])
    expect(toRemove).toEqual([])
  })

  test("removes notifications whose request is no longer pending", () => {
    const seen = new Map([
      ["perm-1", "notif-1"],
      ["perm-2", "notif-2"],
    ])
    const { toAdd, toRemove } = diffPermissionNotifications(seen, [makePermission("perm-2")])

    expect(toAdd).toEqual([])
    expect(toRemove).toEqual([{ requestId: "perm-1", notificationId: "notif-1" }])
  })

  test("keeps already-mirrored requests untouched", () => {
    const seen = new Map([["perm-1", "notif-1"]])
    const { toAdd, toRemove } = diffPermissionNotifications(seen, [makePermission("perm-1"), makePermission("perm-3")])

    expect(toAdd.map((p) => p.id)).toEqual(["perm-3"])
    expect(toRemove).toEqual([])
  })

  test("empty pending list clears every mirrored notification", () => {
    const seen = new Map([["perm-1", "notif-1"]])
    const { toAdd, toRemove } = diffPermissionNotifications(seen, [])

    expect(toAdd).toEqual([])
    expect(toRemove).toEqual([{ requestId: "perm-1", notificationId: "notif-1" }])
  })
})
