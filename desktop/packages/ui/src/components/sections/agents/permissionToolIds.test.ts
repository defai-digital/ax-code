import { describe, expect, it } from "vitest"
import { normalizePermissionToolIds } from "./permissionToolIds"

describe("normalizePermissionToolIds", () => {
  it("trims, deduplicates, and sorts tool ids", () => {
    expect(normalizePermissionToolIds(["grep", " read ", "grep", "bash"])).toEqual(["bash", "grep", "read"])
  })

  it("removes placeholder and grouped tool ids", () => {
    expect(normalizePermissionToolIds(["*", "invalid", "edit", "write", "patch", "multiedit", "grep"])).toEqual([
      "edit",
      "grep",
    ])
  })

  it("ignores empty and non-string values", () => {
    expect(normalizePermissionToolIds(["", "  ", null, 12, "glob"])).toEqual(["glob"])
  })
})
