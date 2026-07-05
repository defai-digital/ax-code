import { describe, expect, test } from "vitest"

import {
  filesViewPathsEqual,
  getFilesViewDisplayPath,
  isFilesViewPathWithinRoot,
  normalizeFilesViewPath,
} from "./filesViewPathUtils"

describe("filesViewPathUtils", () => {
  test("normalizes Windows separators and drive roots", () => {
    expect(normalizeFilesViewPath("C:\\Users\\Alice\\Project\\")).toBe("C:/Users/Alice/Project")
    expect(normalizeFilesViewPath("C:\\")).toBe("C:/")
  })

  test("matches Windows drive paths case-insensitively", () => {
    expect(isFilesViewPathWithinRoot("C:/Users/Alice/Project/src/app.ts", "c:/users/alice/project")).toBe(true)
  })

  test("compares Windows root keys case-insensitively", () => {
    expect(filesViewPathsEqual("C:/Users/Alice/Project", "c:/users/alice/project")).toBe(true)
  })

  test("keeps POSIX root checks case-sensitive", () => {
    expect(isFilesViewPathWithinRoot("/Users/Alice/Project/src/app.ts", "/users/alice/project")).toBe(false)
  })

  test("returns relative display paths for Windows roots with different case", () => {
    expect(getFilesViewDisplayPath("c:/users/alice/project", "C:/Users/Alice/Project/src/app.ts")).toBe("src/app.ts")
  })

  test("returns dot for the root path itself", () => {
    expect(getFilesViewDisplayPath("C:/Users/Alice/Project", "c:/users/alice/project")).toBe(".")
  })
})
