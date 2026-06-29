import { describe, expect, test } from "vitest"

import { getContextPanelRelativePathLabel } from "./contextPanelPathLabels"

describe("context panel path labels", () => {
  test("labels Windows child paths relative to the directory when casing differs", () => {
    expect(getContextPanelRelativePathLabel("c:/users/alice/project/src/app.ts", "C:/Users/Alice/Project")).toBe(
      "src/app.ts",
    )
  })

  test("labels UNC child paths relative to the directory when casing differs", () => {
    expect(
      getContextPanelRelativePathLabel("//SERVER/Share/Project/src/app.ts", "//server/share/project"),
    ).toBe("src/app.ts")
  })

  test("keeps POSIX root matching case-sensitive", () => {
    expect(getContextPanelRelativePathLabel("/users/alice/project/src/app.ts", "/Users/Alice/Project")).toBe(
      "/users/alice/project/src/app.ts",
    )
  })

  test("does not trim sibling directory prefixes", () => {
    expect(getContextPanelRelativePathLabel("/repo/project-other/src/app.ts", "/repo/project")).toBe(
      "/repo/project-other/src/app.ts",
    )
  })
})
