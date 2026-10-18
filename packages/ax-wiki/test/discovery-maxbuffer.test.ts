import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test, vi } from "vitest"
import { discoverSources } from "../src/discovery.js"

vi.mock("node:child_process", () => ({
  execFile: (_file: string, _args: string[], _options: unknown, callback: (error: Error) => void) =>
    callback(
      Object.assign(new Error("maxBuffer exceeded"), {
        code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      }),
    ),
}))

test("a git ls-files maxBuffer overflow does not fall back to a filesystem walk", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-wiki-maxbuffer-"))
  try {
    await expect(discoverSources({ root, wikiDir: path.join(root, ".ax-wiki") })).rejects.toThrow(
      /source discovery exceeded the git ls-files buffer/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
