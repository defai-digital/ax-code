import { describe, expect, test } from "bun:test"

const publishScripts = [
  "/Users/akiralam/code/ax-code/packages/ax-code/script/publish.ts",
  "/Users/akiralam/code/ax-code/packages/plugin/script/publish.ts",
  "/Users/akiralam/code/ax-code/packages/sdk/js/script/publish.ts",
]

describe("publish scripts", () => {
  test("use npm pack instead of pnpm pack in release packaging flows", async () => {
    for (const file of publishScripts) {
      const text = await Bun.file(file).text()
      expect(text).toContain("npm pack --workspaces=false")
      expect(text).not.toContain("$`pnpm pack")
    }
  })
})
