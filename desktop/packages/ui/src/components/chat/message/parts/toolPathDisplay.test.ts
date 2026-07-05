import { describe, expect, test } from "vitest"

import { getToolRelativePath, normalizeToolDisplayPath } from "./toolPathDisplay"

describe("toolPathDisplay", () => {
  test("normalizes path separators and drive roots", () => {
    expect(normalizeToolDisplayPath("C:\\Users\\Alice\\Project\\")).toBe("C:/Users/Alice/Project")
    expect(normalizeToolDisplayPath("C:\\")).toBe("C:/")
  })

  test("returns Windows relative paths case-insensitively", () => {
    expect(getToolRelativePath("C:/Users/Alice/Project/src/app.ts", "c:/users/alice/project")).toBe("src/app.ts")
  })

  test("keeps POSIX path matching case-sensitive", () => {
    expect(getToolRelativePath("/Users/Alice/Project/src/app.ts", "/users/alice/project")).toBe(
      "/Users/Alice/Project/src/app.ts",
    )
  })

  test("returns dot for the current directory itself", () => {
    expect(getToolRelativePath("C:/Users/Alice/Project", "c:/users/alice/project")).toBe(".")
  })

  test("returns an empty display path for empty input", () => {
    expect(getToolRelativePath(" ", "/repo")).toBe("")
  })
})
