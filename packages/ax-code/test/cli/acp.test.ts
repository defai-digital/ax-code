import { expect, test } from "vitest"
import { readFile } from "node:fs/promises"
import path from "node:path"

test("ACP command uses AX Code SDK naming instead of OpenCode aliases", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/acp.ts"), "utf8")

  expect(src).toContain("createAxCodeClient")
  expect(src).not.toContain("createOpencodeClient")
})
