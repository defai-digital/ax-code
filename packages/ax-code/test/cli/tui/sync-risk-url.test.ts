import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const SYNC_SRC = path.resolve(import.meta.dir, "../../../src/cli/cmd/tui/context/sync.tsx")

describe("tui session risk sync url", () => {
  test("opts into all sidebar risk summaries", async () => {
    const source = await fs.readFile(SYNC_SRC, "utf8")

    expect(source).toContain('url.searchParams.set("quality", "true")')
    expect(source).toContain('url.searchParams.set("findings", "true")')
    expect(source).toContain('url.searchParams.set("envelopes", "true")')
    expect(source).toContain('url.searchParams.set("reviewResults", "true")')
    expect(source).toContain('url.searchParams.set("debug", "true")')
    expect(source).toContain('url.searchParams.set("hints", "true")')
  })
})
