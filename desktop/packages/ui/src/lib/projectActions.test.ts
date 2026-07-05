import { describe, expect, test } from "vitest"

import { normalizeProjectActionDirectory, toProjectActionRunKey } from "./projectActions"

describe("normalizeProjectActionDirectory", () => {
  test("normalizes separators, drive casing, and trailing slashes", () => {
    expect(normalizeProjectActionDirectory(" c:\\Repo\\scripts\\ ")).toBe("C:/Repo/scripts")
  })

  test("keeps roots and empty values stable", () => {
    expect(normalizeProjectActionDirectory("/")).toBe("/")
    expect(normalizeProjectActionDirectory(" ")).toBe("")
  })
})

describe("toProjectActionRunKey", () => {
  test("uses normalized directory keys", () => {
    expect(toProjectActionRunKey("c:\\Repo\\", "serve")).toBe("C:/Repo::serve")
  })
})
