import { expect, test } from "vitest"
import { readFile } from "node:fs/promises"
import path from "node:path"

test("ACP command uses AX Code SDK naming instead of OpenCode aliases", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/acp.ts"), "utf8")

  expect(src).toContain("createAxCodeClient")
  expect(src).not.toContain("createOpencodeClient")
  // --dir/--cwd must reach the bootstrap: the ACP server otherwise boots on the
  // process cwd the editor spawned it in, ignoring the requested project.
  expect(src).toContain("bootstrapOwned((args.dir")
  expect(src).not.toContain("bootstrapOwned(process.cwd()")
})
