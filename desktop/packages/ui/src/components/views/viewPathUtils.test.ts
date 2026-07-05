import { describe, expect, test } from "vitest"

import { normalizeViewPath, toViewAbsolutePath, viewPathsEqual } from "./viewPathUtils"

describe("viewPathUtils", () => {
  test("normalizes Windows separators and drive casing", () => {
    expect(normalizeViewPath("c:\\Users\\Alice\\Project\\")).toBe("C:/Users/Alice/Project")
  })

  test("compares Windows paths case-insensitively", () => {
    expect(viewPathsEqual("C:/Users/Alice/Project", "c:/users/alice/project")).toBe(true)
  })

  test("keeps POSIX path comparison case-sensitive", () => {
    expect(viewPathsEqual("/Users/Alice/Project", "/users/alice/project")).toBe(false)
  })

  test("builds absolute paths from relative file paths", () => {
    expect(toViewAbsolutePath("C:/Users/Alice/Project", "src\\app.ts")).toBe("C:/Users/Alice/Project/src/app.ts")
  })

  test("preserves absolute file paths", () => {
    expect(toViewAbsolutePath("C:/Users/Alice/Project", "c:/Users/Alice/Other/app.ts")).toBe(
      "C:/Users/Alice/Other/app.ts",
    )
  })
})
