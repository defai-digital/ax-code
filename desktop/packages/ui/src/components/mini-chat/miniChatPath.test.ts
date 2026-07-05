import { describe, expect, test } from "vitest"

import { compactMiniChatPath, findMiniChatProjectForDirectory } from "./miniChatPath"

describe("compactMiniChatPath", () => {
  test("uses a home-relative label for Windows paths case-insensitively", () => {
    expect(compactMiniChatPath("C:/Users/Alice/Project/src", "c:/users/alice")).toBe("~/Project/src")
  })

  test("keeps POSIX home replacement case-sensitive", () => {
    expect(compactMiniChatPath("/Users/Alice/Project/src", "/users/alice")).toBe(".../Alice/Project/src")
  })

  test("compacts long non-home paths to the final three segments", () => {
    expect(compactMiniChatPath("/var/tmp/projects/acme/web/src")).toBe(".../acme/web/src")
  })
})

describe("findMiniChatProjectForDirectory", () => {
  const projects = [
    { id: "parent", path: "C:/Users/Alice" },
    { id: "project", path: "C:/Users/Alice/Project" },
  ]

  test("matches Windows project roots case-insensitively", () => {
    expect(findMiniChatProjectForDirectory(projects, "c:/users/alice/project/src")?.id).toBe("project")
  })

  test("prefers an explicit project directory over the open directory", () => {
    expect(findMiniChatProjectForDirectory(projects, "C:/Users/Alice/Other", "c:/users/alice/project")?.id).toBe(
      "project",
    )
  })

  test("keeps POSIX project matching case-sensitive", () => {
    expect(findMiniChatProjectForDirectory([{ id: "app", path: "/Users/Alice/Project" }], "/users/alice/project")).toBe(
      null,
    )
  })
})
