import { afterEach, describe, expect, test, vi } from "vitest"
import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { GrepTool } from "../../src/tool/grep"
import { CanonicalOutput } from "../../src/tool/canonical-output"
import { NativeAddon } from "../../src/native/addon"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"
import { Process } from "../../src/util/process"

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

describe("bounded grep context", () => {
  test("cancellation reaps an already streaming subprocess", async () => {
    await using tmp = await tmpdir({ git: true })
    const controller = new AbortController()
    const spawn = Process.spawn
    let child: Process.Child | undefined
    const record =
      JSON.stringify({
        type: "match",
        data: { path: { text: "source.ts" }, lines: { text: "needle\n" }, line_number: 1 },
      }) + "\n"
    const script = `process.stdout.write(${JSON.stringify(record)}); setInterval(() => {}, 1000)`
    vi.spyOn(Process, "spawn").mockImplementation((args, options) => {
      if (!args.includes("--json")) return spawn(args, options)
      child = spawn([process.execPath, "-e", script], options)
      child.stdout!.once("data", () => controller.abort(new Error("Cancelled streaming search")))
      return child
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await GrepTool.init()
        await expect(
          tool.execute({ pattern: "needle", context: 1 }, { ...ctx, abort: controller.signal }),
        ).rejects.toThrow("Cancelled streaming search")
        expect(child).toBeDefined()
        await child!.exited
        expect(child!.exitCode !== null || child!.signalCode !== null).toBe(true)
      },
    })
  })

  test.each(["\n", "\r\n"])("returns full matching lines and merges adjacent context with %j endings", async (eol) => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "prompt space.ts")
    await writeFile(
      file,
      ["before", "const contentWidth = 80", "const sidebarPreferred = false", "after", "outside"].join(eol),
    )
    // Context must not rely on the native substring-only representation.
    const searchContent = vi.fn(() => {
      throw new Error("Native context is incomplete")
    })
    vi.spyOn(NativeAddon, "fs").mockReturnValue({ searchContent } as any)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await GrepTool.init()
        const result = await tool.execute({ pattern: "contentWidth|sidebarPreferred", path: file, context: 1 }, ctx)
        const data = CanonicalOutput.Grep.parse(result.data)
        expect(data.matches.map((m) => m.text)).toEqual(["const contentWidth = 80", "const sidebarPreferred = false"])
        expect(data.context!.map((m) => [m.line, m.isMatch])).toEqual([
          [1, false],
          [2, true],
          [3, true],
          [4, false],
        ])
        expect(data.truncated).toBe(false)
        expect(result.output).not.toContain("outside")
        expect(searchContent).not.toHaveBeenCalled()
        // Source edits are visible immediately; context search is not cached.
        await writeFile(file, "const contentWidth = 120\n")
        const fresh = await tool.execute({ pattern: "contentWidth", path: file, context: 1 }, ctx)
        expect(fresh.output).toContain("const contentWidth = 120")
        expect(fresh.output).not.toContain("= 80")
      },
    })
  })

  test("limits matches globally with an honest truncation marker", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(path.join(tmp.path, "a.ts"), "before\nneedle one\nafter\ngap\nneedle two\nlast\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await GrepTool.init()
        const result = await tool.execute({ pattern: "needle", context: 1, limit: 1 }, ctx)
        expect(CanonicalOutput.Grep.parse(result.data).matches).toHaveLength(1)
        expect(result.output).toContain("after")
        expect(result.output).not.toContain("needle two")
        expect(result.metadata.truncated).toBe(true)
        expect(result.output).toContain("Showing 1 matches")
        const exact = await tool.execute({ pattern: "needle", context: 1, limit: 2 }, ctx)
        expect(exact.metadata.truncated).toBe(false)
        expect(CanonicalOutput.Grep.parse(exact.data).matches).toHaveLength(2)
      },
    })
  })

  test("enforces line, UTF-8 byte, and oversized record budgets", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "large.ts")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await GrepTool.init()
        await writeFile(
          file,
          Array.from({ length: 1000 }, (_, i) => (i % 22 === 10 ? "needle" : `line ${i}`)).join("\n"),
        )
        const lines = await tool.execute({ pattern: "needle", context: 10, limit: 100 }, ctx)
        expect(CanonicalOutput.Grep.parse(lines.data).context).toHaveLength(200)
        expect(lines.metadata.truncated).toBe(true)
        await writeFile(file, Array.from({ length: 100 }, () => `needle ${"\u{1F680}".repeat(400)}`).join("\n"))
        const bytes = await tool.execute({ pattern: "needle", context: 1, limit: 100 }, ctx)
        expect(bytes.metadata.truncated).toBe(true)
        expect(Buffer.byteLength(bytes.output)).toBeLessThan(33 * 1024)
        expect(CanonicalOutput.Grep.parse(bytes.data).context!.length).toBeLessThan(100)
        await writeFile(file, "needle " + "x".repeat(2 * 1024 * 1024))
        const huge = await tool.execute({ pattern: "needle", context: 1 }, ctx)
        expect(huge.metadata.truncated).toBe(true)
        expect(huge.output).not.toBe("No files found")
        expect(huge.output.length).toBeLessThan(200)
      },
    })
  })

  test("scopes includes, omits git data, and does not cache empty results", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(path.join(tmp.path, "a.ts"), "needle code\n")
    await writeFile(path.join(tmp.path, "b.txt"), "needle excluded\n")
    await mkdir(path.join(tmp.path, ".git", "context-fixture"))
    await writeFile(path.join(tmp.path, ".git", "context-fixture", "c.ts"), "needle private\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await GrepTool.init()
        const result = await tool.execute({ pattern: "needle", include: "*.ts", context: 1 }, ctx)
        expect(CanonicalOutput.Grep.parse(result.data).matches).toHaveLength(1)
        expect(result.output).not.toContain("excluded")
        expect(result.output).not.toContain("needle private")
        expect((await tool.execute({ pattern: "absent", context: 1 }, ctx)).output).toBe("No files found")
        await writeFile(path.join(tmp.path, "new.ts"), "absent\n")
        expect(
          CanonicalOutput.Grep.parse((await tool.execute({ pattern: "absent", context: 1 }, ctx)).data).matches,
        ).toHaveLength(1)
        await expect(tool.execute({ pattern: "[", context: 1 }, ctx)).rejects.toThrow("ripgrep failed")
      },
    })
  })

  test("preserves external permission order and rejects cancellation", async () => {
    await using tmp = await tmpdir({ git: true })
    await using outside = await tmpdir()
    const ask = vi.fn(async () => {
      throw new Error("Denied")
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await GrepTool.init()
        await expect(
          tool.execute({ pattern: "needle", path: outside.path, context: 2 }, { ...ctx, ask }),
        ).rejects.toThrow("Denied")
        expect(ask).toHaveBeenCalledTimes(1)
        expect(ask.mock.calls[0]).toMatchObject([{ permission: "external_directory" }])
        const externalFile = path.join(outside.path, "source.ts")
        await writeFile(externalFile, "needle\n")
        ask.mockClear()
        await expect(
          tool.execute({ pattern: "needle", path: externalFile, context: 2 }, { ...ctx, ask }),
        ).rejects.toThrow("Denied")
        expect(ask.mock.calls[0]).toMatchObject([
          { permission: "external_directory", metadata: { parentDir: outside.path } },
        ])
        const controller = new AbortController()
        controller.abort(new Error("Cancelled search"))
        await expect(
          tool.execute({ pattern: "needle", context: 2 }, { ...ctx, abort: controller.signal }),
        ).rejects.toThrow("Cancelled search")
        await expect(tool.execute({ pattern: "needle", context: 11 }, ctx)).rejects.toThrow()
        await expect(tool.execute({ pattern: "needle", limit: 0 }, ctx)).rejects.toThrow()
      },
    })
  })
})
