import { describe, expect, test } from "bun:test"
import { compiledBunfsModulePath } from "../../script/embedded-path"

describe("script.embedded-path", () => {
  test("rewrites TypeScript worker entrypoints to the compiled .js bunfs path", () => {
    expect(compiledBunfsModulePath("/$bunfs/root/", "./src/cli/cmd/tui/worker.ts")).toBe(
      "/$bunfs/root/src/cli/cmd/tui/worker.js",
    )
  })

  test("preserves already-compiled JavaScript asset paths", () => {
    expect(compiledBunfsModulePath("/$bunfs/root/", "../../node_modules/@opentui/core/parser.worker.js")).toBe(
      "/$bunfs/root/../../node_modules/@opentui/core/parser.worker.js",
    )
  })
})
