import { test, expect, vi } from "vitest"
import { NativeAddon } from "../../src/native/addon"
import { FileIgnore } from "../../src/file/ignore"

test("match nested and non-nested", () => {
  expect(FileIgnore.match("node_modules/index.js")).toBe(true)
  expect(FileIgnore.match("node_modules")).toBe(true)
  expect(FileIgnore.match("node_modules/")).toBe(true)
  expect(FileIgnore.match("node_modules/bar")).toBe(true)
  expect(FileIgnore.match("node_modules/bar/")).toBe(true)
})

test("matches hardcoded file patterns from shared JSON", () => {
  expect(FileIgnore.match("src/main.rs.swp")).toBe(true)
  expect(FileIgnore.match("app/debug.log")).toBe(true)
  expect(FileIgnore.match("src/main.rs")).toBe(false)
})

test.each([false, true])("an extra glob without a slash matches at any depth (fallback=%s)", (fallback) => {
  if (fallback) vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)
  try {
    expect(FileIgnore.match("data/file.csv", { extra: ["*.csv"] })).toBe(true)
    expect(FileIgnore.match("file.csv", { extra: ["*.csv"] })).toBe(true)
    expect(FileIgnore.match("data/file.csv", { extra: ["other/*.csv"] })).toBe(false)
  } finally {
    vi.restoreAllMocks()
  }
})
