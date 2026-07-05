import { describe, expect, test } from "vitest"

import { formatDirectoryName, formatPathForDisplay } from "./utils"

describe("formatPathForDisplay", () => {
  test("uses tilde for paths under the home directory", () => {
    expect(formatPathForDisplay("/Users/alice/project/src", "/Users/alice")).toBe("~/project/src")
  })

  test("normalizes Windows separators before applying home replacement", () => {
    expect(formatPathForDisplay("c:\\Users\\Alice\\Project\\", "C:/Users/Alice")).toBe("~/Project")
  })

  test("matches Windows home paths case-insensitively", () => {
    expect(formatPathForDisplay("C:/Users/Alice/Project/src", "c:/users/alice")).toBe("~/Project/src")
  })

  test("keeps POSIX home replacement case-sensitive", () => {
    expect(formatPathForDisplay("/Users/Alice/Project", "/users/alice")).toBe("/Users/Alice/Project")
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

  test("matches Windows home directory names case-insensitively", () => {
    expect(formatDirectoryName("C:/Users/Alice", "c:/users/alice")).toBe("~")
  })

  test("keeps POSIX home directory names case-sensitive", () => {
    expect(formatDirectoryName("/Users/Alice", "/users/alice")).toBe("Alice")
  })
})
