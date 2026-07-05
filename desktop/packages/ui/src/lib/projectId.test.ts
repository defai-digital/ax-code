import { describe, expect, test } from "vitest"

import { createProjectIdFromPath } from "./projectId"

describe("createProjectIdFromPath", () => {
  test("normalizes Windows path variants before deriving the id", () => {
    expect(createProjectIdFromPath("c:\\Repo\\")).toBe(createProjectIdFromPath("C:/Repo"))
  })

  test("keeps empty paths empty", () => {
    expect(createProjectIdFromPath("   ")).toBe("")
  })
})
