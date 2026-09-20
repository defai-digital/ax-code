import { describe, expect, test } from "vitest"
import { readFile } from "node:fs/promises"
import path from "path"

import { formatDebugReplayTimestamp } from "../../src/cli/cmd/debug/replay"

describe("debug replay command", () => {
  test("formats malformed replay timestamps without throwing", () => {
    expect(formatDebugReplayTimestamp(Date.parse("2026-04-01T00:00:00Z"))).toBe("2026-04-01T00:00:00.000Z")
    expect(formatDebugReplayTimestamp(Number.NaN)).toBe("1970-01-01T00:00:00.000Z")
    expect(formatDebugReplayTimestamp(Number.POSITIVE_INFINITY)).toBe("1970-01-01T00:00:00.000Z")
    expect(formatDebugReplayTimestamp(8_640_000_000_000_001)).toBe("1970-01-01T00:00:00.000Z")
  })

  test("registers as debug lsp replay, not a top-level debug action", async () => {
    const tree = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/debug/index.ts"), "utf-8")
    const lsp = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/debug/lsp.ts"), "utf-8")
    expect(tree).not.toContain(".command(ReplayCommand)")
    expect(lsp).toContain(".command(ReplayCommand)")
  })
})
