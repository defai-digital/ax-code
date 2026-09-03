import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"

const pluginPublishScript = path.resolve(import.meta.dirname, "../../../plugin/script/publish.ts")

describe("publish scripts", () => {
  test("disables workspaces for the remaining plugin npm publish flow", async () => {
    const text = await fs.readFile(pluginPublishScript, "utf8")
    // The Bun `$` form was ported to spawnSync(npm, [...]) on Node; both pack
    // and publish must still pass --workspaces=false so workspace deps aren't
    // bundled into the published tarball.
    expect(text).toContain('"pack", "--workspaces=false"')
    expect(text).toContain('"publish"')
    expect(text).toContain('"--workspaces=false"')
    expect(text).not.toContain('from "bun"')
  })
})
