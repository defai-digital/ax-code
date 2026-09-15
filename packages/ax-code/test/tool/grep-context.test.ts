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

  test("a clamped long line does not mark the whole result truncated", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "long-line.ts")
    await writeFile(file, "needle " + "x".repeat(2_500) + "\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await GrepTool.init()
        // A single clamped source line drops no match or context line, so the
        // context path must agree with the non-context path: not truncated.
        // `truncated` is the "results were capped" signal, and the clamped line
        // is already marked with a trailing ellipsis in the output.
        const plain = await tool.execute({ pattern: "needle", path: file }, ctx)
        const context = await tool.execute({ pattern: "needle", path: file, context: 2 }, ctx)
        expect(plain.metadata.truncated).toBe(false)
        expect(context.metadata.truncated).toBe(false)
        expect(CanonicalOutput.Grep.parse(context.data).matches).toHaveLength(1)
        expect(context.output).toContain("...")
      },
    })
  })

  test("keeps a clamped line well-formed when the cut lands mid-surrogate", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "emoji-cut.ts")
    // Padding puts the rocket's high surrogate exactly at the MAX_LINE_LENGTH cut.
    await writeFile(file, "needle " + "A".repeat(1_992) + "\u{1F680}" + "B".repeat(50) + "\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await GrepTool.init()
        const result = await tool.execute({ pattern: "needle", context: 1 }, ctx)
        const [match] = CanonicalOutput.Grep.parse(result.data).matches
        expect(match?.text).toBeDefined()
        // A lone surrogate is invalid UTF-16 and would render as U+FFFD.
        expect(match!.text.isWellFormed()).toBe(true)
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

  test("does not emit before-context that belongs to a match rejected by the limit", async () => {
    await using tmp = await tmpdir({ git: true })
    // ripgrep emits a match's before-context lines before the match itself, so
    // the second match's before-context ("gap") arrives before the limit
    // rejection. It must not survive as an orphan with no visible match.
    await writeFile(path.join(tmp.path, "a.ts"), "before\nneedle one\nafter\ngap\nneedle two\nlast\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await GrepTool.init()
        const result = await tool.execute({ pattern: "needle", context: 1, limit: 1 }, ctx)
        const data = CanonicalOutput.Grep.parse(result.data)
        expect(data.matches).toHaveLength(1)
        expect(result.output).toContain("after")
        expect(result.output).not.toContain("gap")
        expect(data.context!.map((m) => [m.line, m.isMatch])).toEqual([
          [1, false],
          [2, true],
          [3, false],
        ])
      },
    })
  })

  test("keeps context attribution per file when the stream interleaves files", async () => {
    await using tmp = await tmpdir({ git: true })
    const spawn = Process.spawn
    const record = (type: string, file: string, line: number, text: string) =>
      JSON.stringify({ type, data: { path: { text: file }, lines: { text: text + "\n" }, line_number: line } })
    // Real ripgrep emits contiguous per-file blocks, but the budget logic must
    // not depend on that: in an interleaved stream, a.ts:9 has no match, so it
    // must not be emitted as if it were before-context of b.ts:20.
    const stream =
      [
        record("context", "a.ts", 9, "a-before"),
        record("context", "b.ts", 19, "b-before"),
        record("match", "b.ts", 20, "needle b"),
      ].join("\n") + "\n"
    const script = `process.stdout.write(${JSON.stringify(stream)}); process.stdout.end()`
    vi.spyOn(Process, "spawn").mockImplementation((args, options) => {
      if (!args.includes("--json")) return spawn(args, options)
      return spawn([process.execPath, "-e", script], options)
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await GrepTool.init()
        const result = await tool.execute({ pattern: "needle", context: 2, limit: 10 }, ctx)
        const data = CanonicalOutput.Grep.parse(result.data)
        expect(result.output).toContain("b-before")
        expect(result.output).toContain("needle b")
        expect(result.output).not.toContain("a-before")
        expect(data.matches).toHaveLength(1)
        expect(data.context!.map((m) => [m.path, m.line, m.isMatch])).toEqual([
          ["b.ts", 19, false],
          ["b.ts", 20, true],
        ])
      },
    })
  })
})
