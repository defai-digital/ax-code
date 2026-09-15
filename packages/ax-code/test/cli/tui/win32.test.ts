import { expect, test } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const source = await fs.readFile(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../src/cli/tui/win32.ts"),
  "utf8",
)

test("Windows console guard loads node:ffi before bun:ffi", () => {
  expect(source).toContain('require("node:ffi")')
  expect(source.indexOf('require("node:ffi")')).toBeLessThan(source.indexOf('require("bun:ffi")'))
  expect(source).toContain("loadNodeFfi() ?? loadBunFfi()")
  expect(source).not.toContain("bun:ffi is required but this runtime is not Bun")
})
