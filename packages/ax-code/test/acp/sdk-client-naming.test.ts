import { expect, test } from "vitest"
import { readFile } from "node:fs/promises"
import path from "node:path"

const ACP_SRC = path.join(import.meta.dirname, "../../src/acp")

test("ACP internals use AX Code SDK naming instead of OpenCode client aliases", async () => {
  const files = ["agent.ts", "session.ts", "types.ts", "usage.ts"]

  for (const file of files) {
    const src = await readFile(path.join(ACP_SRC, file), "utf8")
    expect(src).toContain("AxCodeClient")
    expect(src).not.toContain("OpencodeClient")
  }
})
