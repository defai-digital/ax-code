import { describe, expect, test } from "bun:test"
import path from "path"

const publishScripts = [
  path.resolve(import.meta.dir, "../../script/publish.ts"),
  path.resolve(import.meta.dir, "../../../plugin/script/publish.ts"),
  path.resolve(import.meta.dir, "../../../sdk/js/script/publish.ts"),
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
