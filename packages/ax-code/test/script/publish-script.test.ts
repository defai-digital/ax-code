import { describe, expect, test } from "vitest"
import path from "path"

const publishScripts = [
  path.resolve(import.meta.dirname, "../../../plugin/script/publish.ts"),
  path.resolve(import.meta.dirname, "../../../sdk/js/script/publish.ts"),
]

describe("publish scripts", () => {
  test("disable workspaces for remaining SDK/plugin npm publish flows", async () => {
    for (const file of publishScripts) {
      const text = await Bun.file(file).text()
      expect(text).toContain("npm pack --workspaces=false")
      expect(text).toContain("npm publish *.tgz --workspaces=false")
      expect(text).not.toContain("$`pnpm pack")
    }
  })
})
