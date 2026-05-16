import { describe, expect, test } from "bun:test"
import path from "path"

const publishScripts = [
  path.resolve(import.meta.dir, "../../script/publish.ts"),
  path.resolve(import.meta.dir, "../../../plugin/script/publish.ts"),
  path.resolve(import.meta.dir, "../../../sdk/js/script/publish.ts"),
]

describe("publish scripts", () => {
  test("disable workspaces for npm pack and npm publish in release packaging flows", async () => {
    for (const file of publishScripts) {
      const text = await Bun.file(file).text()
      expect(text).toContain("npm pack --workspaces=false")
      expect(text).toContain("npm publish *.tgz --workspaces=false")
      expect(text).not.toContain("$`pnpm pack")
    }
  })
})
