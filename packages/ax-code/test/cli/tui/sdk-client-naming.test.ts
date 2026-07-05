import { expect, test } from "vitest"
import { readFile } from "node:fs/promises"
import path from "node:path"

const TUI_SRC = path.join(import.meta.dirname, "../../../src/cli/cmd/tui")

test("TUI SDK client construction uses AX Code names instead of OpenCode aliases", async () => {
  const files = ["context/sdk.tsx", "component/dialog-workspace-list.tsx", "context/sync-bootstrap-request.ts"]

  for (const file of files) {
    const src = await readFile(path.join(TUI_SRC, file), "utf8")
    expect(src).toMatch(/createAxCodeClient|AxCodeClient/)
    expect(src).not.toContain("createOpencodeClient")
    expect(src).not.toContain("OpencodeClient")
  }
})
