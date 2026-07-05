import { describe, expect, test } from "vitest"

import { normalizeWorktreePath } from "./path"

describe("normalizeWorktreePath", () => {
  test("keeps empty strings and filesystem root stable", () => {
    expect(normalizeWorktreePath("")).toBe("")
    expect(normalizeWorktreePath("/")).toBe("/")
    expect(normalizeWorktreePath("///")).toBe("/")
  })

  test("normalizes separators and trailing slashes", () => {
    expect(normalizeWorktreePath("C:\\repo\\worktree\\")).toBe("C:/repo/worktree")
    expect(normalizeWorktreePath("/repo/worktree///")).toBe("/repo/worktree")
  })
})
