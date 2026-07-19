import { test, expect } from "vitest"
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
