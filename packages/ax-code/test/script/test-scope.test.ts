import path from "node:path"
import { expect, test } from "vitest"
import { testScanDirectory, testScope } from "../../script/test-scope"

const root = path.resolve("scope-fixture")
const excluded = ["test/cli/tui/excluded.test.ts", "test/live.test.ts"]
test("rebases scanned test patterns and exclusions together", () => {
  const base = testScope({ root, excluded })
  expect(base.include).toEqual(["test/**/*.test.{ts,tsx}"])
  const nested = testScope({ root, excluded, scanDir: "test/cli/tui" })
  expect(nested.include).toEqual(["**/*.test.{ts,tsx}"])
  expect(nested.exclude).toContain("excluded.test.ts")
  expect(testScope({ root, excluded, scanDir: "src" }).include).toEqual([])
})
test("preserves exact selected-file admission and excludes unrelated files", () => {
  const result = testScope({ root, excluded, scanDir: "test/cli/tui", files: [excluded[0], "test/other.test.ts"] })
  expect(result.include).toEqual(["excluded.test.ts"])
  expect(result.exclude).not.toContain("excluded.test.ts")
})
test("reads both CLI spellings without consuming positional arguments after --", () => {
  expect(testScanDirectory(["run", "--dir", "test/cli/tui"])).toBe("test/cli/tui")
  expect(testScanDirectory(["run", "--dir=test/cli/tui"])).toBe("test/cli/tui")
  expect(testScanDirectory(["run", "--", "--dir", "test"])).toBeUndefined()
})

test("rejects spanning exclusion globs instead of silently dropping them", () => {
  expect(() =>
    testScope({ root: process.cwd(), scanDir: "test/cli/tui", excluded: ["test/**/*.live.test.ts"] }),
  ).toThrow("literal")
})
