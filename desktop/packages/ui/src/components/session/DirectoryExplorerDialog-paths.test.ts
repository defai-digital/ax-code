import { describe, expect, test } from "vitest"

import { normalizeDirectoryExplorerProjectPathKey } from "./DirectoryExplorerDialog-paths"

describe("DirectoryExplorerDialog path keys", () => {
  test("keeps POSIX project paths case-sensitive", () => {
    expect(normalizeDirectoryExplorerProjectPathKey("/Users/Alice/Repo")).toBe("/Users/Alice/Repo")
    expect(normalizeDirectoryExplorerProjectPathKey("/users/alice/repo")).toBe("/users/alice/repo")
  })

  test("treats Windows drive project paths case-insensitively", () => {
    expect(normalizeDirectoryExplorerProjectPathKey("c:\\Users\\Alice\\Repo\\")).toBe("c:/users/alice/repo")
    expect(normalizeDirectoryExplorerProjectPathKey("C:/Users/Alice/Repo")).toBe("c:/users/alice/repo")
  })

  test("treats UNC project paths case-insensitively", () => {
    expect(normalizeDirectoryExplorerProjectPathKey("//Server/Share/Repo")).toBe("//server/share/repo")
    expect(normalizeDirectoryExplorerProjectPathKey("\\\\server\\share\\repo\\")).toBe("//server/share/repo")
  })
})
