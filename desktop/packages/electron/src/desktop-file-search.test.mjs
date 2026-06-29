import path from "node:path"
import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { toNativeSearchRelativePath } = require("./desktop-file-search.js")

describe("desktop file search helpers", () => {
  test("returns forward-slash relative paths with Windows path semantics", () => {
    expect(
      toNativeSearchRelativePath(
        "C:\\Users\\Alice\\project",
        "C:\\Users\\Alice\\project\\src\\app.ts",
        path.win32,
      ),
    ).toBe("src/app.ts")
  })

  test("keeps POSIX relative paths unchanged", () => {
    expect(toNativeSearchRelativePath("/Users/alice/project", "/Users/alice/project/src/app.ts", path.posix)).toBe(
      "src/app.ts",
    )
  })
})
