import { describe, expect, test } from "vitest"
import { mkdtemp, readFile, rm, mkdir, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createHeadlessJsonlFileEventSink } from "../../../src/runtime/headless/event-sink-node"

describe("headless node event sinks", () => {
  test.each([false, true])("writes and flushes JSONL records, scoped=%s", async (scoped) => {
    const dir = await mkdtemp(path.join(tmpdir(), "ax-code-headless-sink-"))

    try {
      const file = path.join(dir, "nested", "events.jsonl")
      const sink = await createHeadlessJsonlFileEventSink(file, scoped ? dir : undefined)

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

describe("scoped headless event logs", () => {
  test.skipIf(process.platform === "win32").each(["leaf", "ancestor", "dangling"])(
    "rejects an escaping %s symlink before writing",
    async (kind) => {
      const dir = await mkdtemp(path.join(tmpdir(), "ax-code-headless-scope-"))
      try {
        const root = path.join(dir, "workspace")
        const outside = path.join(dir, "outside")
        await mkdir(root)
        await mkdir(outside)
        const sentinel = path.join(outside, "events.jsonl")
        if (kind !== "dangling") await writeFile(sentinel, "preserve")
        const link = path.join(root, "link")
        await symlink(kind === "ancestor" ? outside : sentinel, link)
        const file = kind === "ancestor" ? path.join(link, "new", "events.jsonl") : link
        await expect(createHeadlessJsonlFileEventSink(file, root)).rejects.toThrow()
        if (kind !== "dangling") expect(await readFile(sentinel, "utf8")).toBe("preserve")
        else await expect(readFile(sentinel)).rejects.toThrow()
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  )
})
