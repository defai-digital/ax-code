import { describe, test, expect } from "vitest"
import fs from "node:fs/promises"
import { Truncate } from "../../src/tool/truncate"
import { Identifier } from "../../src/id/id"
import { Process } from "../../src/util/process"
import { Filesystem } from "../../src/util/filesystem"
import path from "path"

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures")
const ROOT = path.resolve(import.meta.dirname, "..", "..")

describe("Truncate", () => {
  describe("output", () => {
    test("truncates large json file by bytes", async () => {
      const content = await Filesystem.readText(path.join(FIXTURES_DIR, "models-api.json"))
      const result = await Truncate.output(content)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("truncated...")
      if (result.truncated) expect(result.outputPath).toBeDefined()
    })

    test("returns content unchanged when under limits", async () => {
      const content = "line1\nline2\nline3"
      const result = await Truncate.output(content)

      expect(result.truncated).toBe(false)
      expect(result.content).toBe(content)
    })

    test("truncates by line count", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      const result = await Truncate.output(lines, { maxLines: 10 })

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("...90 lines truncated...")
    })

    test("truncates by byte count", async () => {
      const content = "a".repeat(1000)
      const result = await Truncate.output(content, { maxBytes: 100 })

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("truncated...")
    })

    test("truncates from head by default", async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n")
      const result = await Truncate.output(lines, { maxLines: 3 })

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("line0")
      expect(result.content).toContain("line1")
      expect(result.content).toContain("line2")
      expect(result.content).not.toContain("line9")
    })

    test("truncates from tail when direction is tail", async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n")
      const result = await Truncate.output(lines, { maxLines: 3, direction: "tail" })

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("line7")
      expect(result.content).toContain("line8")
      expect(result.content).toContain("line9")
      expect(result.content).not.toContain("line0")
    })

    test("uses default MAX_LINES and MAX_BYTES", () => {
      expect(Truncate.MAX_LINES).toBe(2000)
      expect(Truncate.MAX_BYTES).toBe(50 * 1024)
    })

    test("large single-line file truncates with byte message", async () => {
      // Construct a truly single-line large string (> MAX_BYTES = 50KB, < MAX_LINES = 2000 lines)
      const content = "x".repeat(Truncate.MAX_BYTES + 1)
      const result = await Truncate.output(content)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("bytes truncated...")
      expect(Buffer.byteLength(content, "utf-8")).toBeGreaterThan(Truncate.MAX_BYTES)
    })

    test("writes full output to file when truncated", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      const result = await Truncate.output(lines, { maxLines: 10 })

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("The tool call succeeded but the output was truncated")
      expect(result.content).toContain("Grep")
      if (!result.truncated) throw new Error("expected truncated")
      expect(result.outputPath).toBeDefined()
      expect(result.outputPath).toContain("tool_")

      const written = await Filesystem.readText(result.outputPath!)
      expect(written).toBe(lines)
    })

    test("suggests Task tool when agent has task permission", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      const agent = { permission: [{ permission: "task", pattern: "*", action: "allow" as const }] }
      const result = await Truncate.output(lines, { maxLines: 10 }, agent as any)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("Grep")
      expect(result.content).toContain("Task tool")
    })

    test("omits Task tool hint when agent lacks task permission", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      const agent = { permission: [{ permission: "task", pattern: "*", action: "deny" as const }] }
      const result = await Truncate.output(lines, { maxLines: 10 }, agent as any)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("Grep")
      expect(result.content).not.toContain("Task tool")
    })

    test("does not write file when not truncated", async () => {
      const content = "short content"
      const result = await Truncate.output(content)

      expect(result.truncated).toBe(false)
      if (result.truncated) throw new Error("expected not truncated")
      expect("outputPath" in result).toBe(false)
    })

    test("includes originalSize and contentHint when truncated", async () => {
      const content = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      const result = await Truncate.output(content, { maxLines: 10 })

      expect(result.truncated).toBe(true)
      if (!result.truncated) throw new Error("expected truncated")
      expect(result.originalSize).toBeGreaterThan(0)
      expect(result.originalSize).toBe(Buffer.byteLength(content, "utf-8"))
      expect(result.truncatedTo).toBeGreaterThan(0)
      expect(result.truncatedTo).toBeLessThan(result.originalSize)
      expect(result.fullOutputPath).toBe(result.outputPath)
      expect(result.contentHint).toBeDefined()
      expect(typeof result.contentHint).toBe("string")
    })

    test("contentHint classifies JSON output", async () => {
      const content = `{ "key": "value" }\n` + "x\n".repeat(200)
      const result = await Truncate.output(content, { maxLines: 10 })

      expect(result.truncated).toBe(true)
      if (!result.truncated) throw new Error("expected truncated")
      expect(result.contentHint).toBe("JSON output")
    })

    test("contentHint classifies test output", async () => {
      const content = `PASS src/foo.test.ts\nFAIL src/bar.test.ts\n` + "x\n".repeat(200)
      const result = await Truncate.output(content, { maxLines: 10 })

      expect(result.truncated).toBe(true)
      if (!result.truncated) throw new Error("expected truncated")
      expect(result.contentHint).toBe("test output")
    })

    test("contentHint classifies error output", async () => {
      const content = `Error: something went wrong\n  at foo.ts:10\n` + "x\n".repeat(200)
      const result = await Truncate.output(content, { maxLines: 10 })

      expect(result.truncated).toBe(true)
      if (!result.truncated) throw new Error("expected truncated")
      expect(result.contentHint).toBe("error output")
    })

    test("contentHint classifies code output", async () => {
      const content = `function hello() {\n  return "world"\n}\n` + "x\n".repeat(200)
      const result = await Truncate.output(content, { maxLines: 10 })

      expect(result.truncated).toBe(true)
      if (!result.truncated) throw new Error("expected truncated")
      expect(result.contentHint).toBe("code output")
    })

    test("loads truncate module in a fresh process", async () => {
      const out = await Process.run([process.execPath, "run", path.join(ROOT, "src", "tool", "truncate.ts")], {
        cwd: ROOT,
      })

      expect(out.code).toBe(0)
    }, 20000)
  })

  describe("cleanup", () => {
    const DAY_MS = 24 * 60 * 60 * 1000

    test("deletes files older than 7 days and preserves recent files", async () => {
      await fs.mkdir(Truncate.DIR, { recursive: true })
      const old = path.join(Truncate.DIR, Identifier.create("tool", false, Date.now() - 10 * DAY_MS))
      const recent = path.join(Truncate.DIR, Identifier.create("tool", false, Date.now() - 3 * DAY_MS))
      try {
        await fs.writeFile(old, "old content")
        await fs.writeFile(recent, "recent content")
        await Truncate.cleanup()

        expect(await exists(old)).toBe(false)
        expect(await exists(recent)).toBe(true)
      } finally {
        await fs.rm(old, { force: true }).catch(() => undefined)
        await fs.rm(recent, { force: true }).catch(() => undefined)
      }
    })
  })
})

async function exists(filepath: string) {
  return fs
    .access(filepath)
    .then(() => true)
    .catch(() => false)
}
