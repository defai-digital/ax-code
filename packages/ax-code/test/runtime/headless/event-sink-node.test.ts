import { describe, expect, test } from "vitest"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createHeadlessJsonlFileEventSink } from "../../../src/runtime/headless/event-sink-node"

describe("headless node event sinks", () => {
  test("writes JSONL records and flushes them when closed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ax-code-headless-sink-"))

    try {
      const file = path.join(dir, "nested", "events.jsonl")
      const sink = await createHeadlessJsonlFileEventSink(file)

      await sink.write({ type: "mcp.tools.changed" })
      await sink.write({ details: { type: "server.heartbeat" } })
      await sink.close?.()

      expect(await readFile(file, "utf8")).toBe(
        '{"type":"mcp.tools.changed"}\n{"details":{"type":"server.heartbeat"}}\n',
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
