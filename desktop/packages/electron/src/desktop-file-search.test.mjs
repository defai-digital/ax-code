import path from "node:path"
import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { shouldIncludeNativeSearchEntry, toNativeSearchRelativePath } = require("./desktop-file-search.js")

const mockEntry = (name, type) => ({
  name,
  isDirectory: () => type === "directory",
  isFile: () => type === "file",
})

describe("desktop file search helpers", () => {
  test("returns forward-slash relative paths with Windows path semantics", () => {
    expect(
      toNativeSearchRelativePath("C:\\Users\\Alice\\project", "C:\\Users\\Alice\\project\\src\\app.ts", path.win32),
    ).toBe("src/app.ts")
  })

  test("keeps POSIX relative paths unchanged", () => {
    expect(toNativeSearchRelativePath("/Users/alice/project", "/Users/alice/project/src/app.ts", path.posix)).toBe(
      "src/app.ts",
    )
  })

  test("filters native search entries by requested result type", () => {
    expect(shouldIncludeNativeSearchEntry(mockEntry("app.ts", "file"), "file", "app")).toBe(true)
    expect(shouldIncludeNativeSearchEntry(mockEntry("src", "directory"), "file", "src")).toBe(false)
    expect(shouldIncludeNativeSearchEntry(mockEntry("src", "directory"), "directory", "src")).toBe(true)
    expect(shouldIncludeNativeSearchEntry(mockEntry("app.ts", "file"), "directory", "app")).toBe(false)
  })
})
