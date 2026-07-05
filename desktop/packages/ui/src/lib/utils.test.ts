import { describe, expect, test } from "vitest"

import { formatDirectoryName, formatPathForDisplay } from "./utils"

describe("formatPathForDisplay", () => {
  test("uses tilde for paths under the home directory", () => {
    expect(formatPathForDisplay("/Users/alice/project/src", "/Users/alice")).toBe("~/project/src")
  })

  test("normalizes Windows separators before applying home replacement", () => {
    expect(formatPathForDisplay("c:\\Users\\Alice\\Project\\", "C:/Users/Alice")).toBe("~/Project")
  })

  test("keeps the filesystem root stable", () => {
    expect(formatPathForDisplay("/", "/Users/alice")).toBe("/")
  })
})

describe("formatDirectoryName", () => {
  test("returns the final normalized path segment", () => {
    expect(formatDirectoryName("c:\\Users\\Alice\\Project\\")).toBe("Project")
  })

  test("uses tilde when the path equals the home directory", () => {
    expect(formatDirectoryName("/Users/alice/", "/Users/alice")).toBe("~")
  })
})
