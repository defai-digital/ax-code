import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"

const publishScripts = [
  path.resolve(import.meta.dirname, "../../../plugin/script/publish.ts"),
  path.resolve(import.meta.dirname, "../../../sdk/js/script/publish.ts"),
]

describe("publish scripts", () => {
  test("disable workspaces for remaining SDK/plugin npm publish flows", async () => {
    for (const file of publishScripts) {
      const text = await fs.readFile(file, "utf8")
      // The Bun `$` form was ported to spawnSync(npm, [...]) on Node; both pack
      // and publish must still pass --workspaces=false so workspace deps aren't
      // bundled into the published tarball.
      expect(text).toContain('"pack", "--workspaces=false"')
      expect(text).toContain('"publish"')
      expect(text).toContain('"--workspaces=false"')
      expect(text).not.toContain('from "bun"')
    }
  })
})
