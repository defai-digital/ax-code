import { describe, expect, test } from "vitest"

import {
  getFilesViewAncestorPaths,
  getFilesViewDisplayPath,
  isFilesViewPathWithinRoot,
} from "./filesViewPathUtils"

describe("FilesView path helpers", () => {
  test("treats child paths under Windows drive roots as inside the root", () => {
    expect(isFilesViewPathWithinRoot("C:/Users/Alice/Project/src/app.ts", "C:/")).toBe(true)
  })

  test("keeps POSIX root matching case-sensitive", () => {
    expect(isFilesViewPathWithinRoot("/users/Alice/Project/src/app.ts", "/Users")).toBe(false)
  })

  test("builds Windows drive-root ancestors without duplicate slashes", () => {
    expect(getFilesViewAncestorPaths("C:/Users/Alice/Project/src/app.ts", "C:/")).toEqual([
      "C:/Users",
      "C:/Users/Alice",
      "C:/Users/Alice/Project",
      "C:/Users/Alice/Project/src",
    ])
  })

  test("displays Windows drive-root children as relative paths", () => {
    expect(getFilesViewDisplayPath("C:/", "C:/Users/Alice/Project/src/app.ts")).toBe(
      "Users/Alice/Project/src/app.ts",
    )
  })
})
