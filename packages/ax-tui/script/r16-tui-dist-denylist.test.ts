import { join } from "node:path"
import { expect, test } from "vitest"
import { shouldCopyTuiDistPath } from "./tui-dist"

const root = "/tmp/ax-code-tui"

test("distribution filter excludes non-runtime top-level entries", () => {
  expect(shouldCopyTuiDistPath(join(root, "examples/application.mjs"), root)).toBe(false)
  expect(shouldCopyTuiDistPath(join(root, "experiments/text-width/kernel.js"), root)).toBe(false)
  expect(shouldCopyTuiDistPath(join(root, "CHANGELOG.md"), root)).toBe(false)
  expect(shouldCopyTuiDistPath(join(root, "vitest.config.ts"), root)).toBe(false)
  expect(shouldCopyTuiDistPath(join(root, "index.js"), root)).toBe(true)
  expect(shouldCopyTuiDistPath(join(root, "package.json"), root)).toBe(true)
})
