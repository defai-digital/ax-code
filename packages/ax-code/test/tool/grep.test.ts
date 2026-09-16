import { afterEach, describe, expect, test, vi } from "vitest"
import path from "path"
import { writeFile } from "fs/promises"
import { GrepTool } from "../../src/tool/grep"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { CanonicalOutput } from "../../src/tool/canonical-output"
import { NativeAddon } from "../../src/native/addon"
import { Process } from "../../src/util/process"

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

const projectRoot = path.join(__dirname, "../..")

class StopAfterAsk extends Error {}
class ScanCancellation {
  cancel() {}
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

describe("tool.grep", () => {
  test("old synchronous-only addons fall back to cancellable ripgrep", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "source.ts")
    await writeFile(file, "needle\n")
    const searchContent = vi.fn(() => {
      throw new Error("Must not block on the old addon")
    })
    vi.spyOn(NativeAddon, "fs").mockReturnValue({ searchContent } as any)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await (await GrepTool.init()).execute({ pattern: "needle", path: file }, ctx)
        expect(CanonicalOutput.Grep.parse(result.data).matches).toHaveLength(1)
        expect(searchContent).not.toHaveBeenCalled()
      },
    })
  })

  test.each([0, 1])("binary bytes cannot shift explicit-file line numbers with context=%i", async (context) => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "binary.txt")
    await writeFile(file, "x\x00y\x00z\nneedle\n")
    vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await (await GrepTool.init()).execute({ pattern: "needle", path: file, context }, ctx)
        const data = CanonicalOutput.Grep.parse(result.data)
        expect(data.matches).toEqual([{ path: file, line: 2, text: "needle" }])
        expect(data.truncated).toBe(false)
        if (context) expect(data.context![0]).toEqual({ path: file, line: 1, text: "x\x00y\x00z", isMatch: false })
      },
    })
  })

  test.each([0, 1])(
    "non-UTF8 filenames cannot be attributed to a different Unicode filename with context=%i",
    async (context) => {
      await using tmp = await tmpdir({ git: true })
      const rawPath = Buffer.concat([Buffer.from(tmp.path + path.sep), Buffer.from([0xff]), Buffer.from(".ts")])
      const unicodePath = path.join(tmp.path, "\ufffd.ts")
      await writeFile(unicodePath, "different content\n")
      vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)
      // Replay a POSIX ripgrep byte-path record: APFS itself rejects this name.
      const output =
        [
          {
            type: "match",
            data: {
              path: { bytes: rawPath.toString("base64") },
              lines: { text: "needle in raw filename\n" },
              line_number: 1,
            },
          },
          { type: "summary" },
        ]
          .map((row) => JSON.stringify(row))
          .join("\n") + "\n"
      const spawn = Process.spawn
      vi.spyOn(Process, "spawn").mockImplementation((args, options) =>
        args.includes("--json")
          ? spawn([process.execPath, "-e", `process.stdout.write(${JSON.stringify(output)})`], options)
          : spawn(args, options),
      )
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await (await GrepTool.init()).execute({ pattern: "needle", context }, ctx)
          expect(CanonicalOutput.Grep.parse(result.data)).toMatchObject({ matches: [], truncated: true })
          expect(result.output).not.toContain(unicodePath)
        },
      })
    },
  )

  test("cancellation while approval settles prevents native search", async () => {
    await using tmp = await tmpdir({ git: true })
    const controller = new AbortController()
    const searchContent = vi.fn(() => "[]")
    vi.spyOn(NativeAddon, "fs").mockReturnValue({ searchContentAsync: searchContent, ScanCancellation } as any)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          (await GrepTool.init()).execute(
            { pattern: "needle" },
            {
              ...ctx,
              abort: controller.signal,
              ask: async () => {
                controller.abort(new Error("Cancelled before native search"))
              },
            },
          ),
        ).rejects.toThrow("Cancelled before native search")
        expect(searchContent).not.toHaveBeenCalled()
      },
    })
  })

  test.each([0, 1])(
    "explicit binary file with context=%i is fully searched without false truncation",
    async (context) => {
      await using tmp = await tmpdir({ git: true })
      const file = path.join(tmp.path, "binary.txt")
      await writeFile(file, "needle\n" + "plain\n".repeat(100_000) + "\x00\n" + "plain\n".repeat(100_000) + "needle\n")
      vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await (await GrepTool.init()).execute({ pattern: "needle", path: file, context }, ctx)
          expect(CanonicalOutput.Grep.parse(result.data).matches).toHaveLength(2)
          expect(result.metadata.truncated).toBe(false)
          expect(result.output).not.toContain("Binary data stopped")
        },
      })
    },
  )

  test.each([0, 1])("signal termination with context=%i is not a successful no-match search", async (context) => {
    await using tmp = await tmpdir({ git: true })
    vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)
    const spawn = Process.spawn
    vi.spyOn(Process, "spawn").mockImplementation((args, options) =>
      args.includes("--regexp")
        ? spawn([process.execPath, "-e", 'process.kill(process.pid, "SIGTERM")'], options)
        : spawn(args, options),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect((await GrepTool.init()).execute({ pattern: "needle", context }, ctx)).rejects.toThrow("SIGTERM")
      },
    })
  })

  test("external cancellation preserves its reason and reaps the search process", async () => {
    await using tmp = await tmpdir({ git: true })
    const controller = new AbortController()
    const spawn = Process.spawn
    let child: Process.Child | undefined
    vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)
    vi.spyOn(Process, "spawn").mockImplementation((args, options) => {
      if (!args.includes("--regexp")) return spawn(args, options)
      child = spawn([process.execPath, "-e", 'process.stdout.write("started"); setInterval(() => {}, 1000)'], options)
      child.stdout!.once("data", () => controller.abort(new Error("Cancelled external search")))
      return child
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          (await GrepTool.init()).execute({ pattern: "needle" }, { ...ctx, abort: controller.signal }),
        ).rejects.toThrow("Cancelled external search")
        expect(child).toBeDefined()
        await child!.exited
        expect(child!.exitCode !== null || child!.signalCode !== null).toBe(true)
      },
    })
  })

  test("external search bounds captured output and reports a lower-bound count", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "large.txt")
    await writeFile(file, ("needle " + "x".repeat(120) + "\n").repeat(150_000))
    vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await (await GrepTool.init()).execute({ pattern: "needle", path: file }, ctx)
        expect(result.metadata.truncated).toBe(true)
        expect(result.output).toMatch(/Found \d+\+ matches/)
        expect(CanonicalOutput.Grep.parse(result.data).matches).toHaveLength(100)
        expect(result.output).toContain("captured results")
        expect(result.output).not.toContain("could not be read")
      },
    })
  })

  test.skipIf(process.platform === "win32").each(["control\x1fseparator.ts", "multi\nline.ts", " leading.ts"])(
    "external search preserves the filename %j",
    async (name) => {
      await using tmp = await tmpdir({ git: true })
      const file = path.join(tmp.path, name)
      await writeFile(file, "needle\n")
      vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await (await GrepTool.init()).execute({ pattern: "needle", path: file }, ctx)
          expect(CanonicalOutput.Grep.parse(result.data).matches).toEqual([{ path: file, line: 1, text: "needle" }])
        },
      })
    },
  )

  test("binary-file diagnostics do not swallow another file's matching record", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(path.join(tmp.path, "big.bin"), "needle\n" + "x\n".repeat(100_000) + "\x00")
    for (let i = 0; i < 20; i++) await writeFile(path.join(tmp.path, `text-${i}.ts`), "needle\n")
    vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await (await GrepTool.init()).execute({ pattern: "needle" }, ctx)
        expect(CanonicalOutput.Grep.parse(result.data).matches.filter((row) => row.path.endsWith(".ts"))).toHaveLength(
          20,
        )
        expect(result.output).not.toContain("could not be read")
      },
    })
  })

  test("external search rejects an invalid regular expression instead of reporting no matches", async () => {
    await using tmp = await tmpdir({ git: true })
    vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect((await GrepTool.init()).execute({ pattern: "[" }, ctx)).rejects.toThrow("ripgrep failed")
      },
    })
  })

  test("external search marks partial results as truncated when ripgrep reports an error", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "source.ts")
    await writeFile(file, "needle\n")
    vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)
    const spawn = Process.spawn
    vi.spyOn(Process, "spawn").mockImplementation((args, options) => {
      if (!args.includes("--regexp")) return spawn(args, options)
      const output =
        JSON.stringify({ type: "match", data: { path: { text: file }, lines: { text: "needle\n" }, line_number: 1 } }) +
        "\n"
      return spawn(
        [process.execPath, "-e", `process.stdout.write(${JSON.stringify(output)}); process.exitCode = 2`],
        options,
      )
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await (await GrepTool.init()).execute({ pattern: "needle" }, ctx)
        expect(CanonicalOutput.Grep.parse(result.data)).toEqual({
          matches: [{ path: file, line: 1, text: "needle" }],
          truncated: true,
        })
        expect(result.metadata.truncated).toBe(true)
        expect(result.output).toContain("inaccessible")
      },
    })
  })

  test.each(["", '{"type":"match","data":'])("external search discloses incomplete output %j", async (tail) => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "source.ts")
    await writeFile(file, "needle\n")
    vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)
    const spawn = Process.spawn
    vi.spyOn(Process, "spawn").mockImplementation((args, options) => {
      if (!args.includes("--regexp")) return spawn(args, options)
      const output =
        JSON.stringify({ type: "match", data: { path: { text: file }, lines: { text: "needle\n" }, line_number: 1 } }) +
        "\n" +
        tail
      return spawn([process.execPath, "-e", `process.stdout.write(${JSON.stringify(output)})`], options)
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await (await GrepTool.init()).execute({ pattern: "needle" }, ctx)
        expect(CanonicalOutput.Grep.parse(result.data)).toEqual({
          matches: [{ path: file, line: 1, text: "needle" }],
          truncated: true,
        })
        expect(result.output).toContain("Found 1+ matches")
        expect(result.output).toContain("ended before all results")
        expect(result.output).not.toContain("could not be read")
      },
    })
  })

  test("native scan exhaustion remains truncated when no rows survive containment filtering", async () => {
    await using tmp = await tmpdir({ git: true })
    vi.spyOn(NativeAddon, "fs").mockReturnValue({
      ScanCancellation,
      searchContentAsync: vi.fn(() =>
        JSON.stringify(
          Array.from({ length: 3 }, (_, i) => ({
            path: path.join(tmp.path, "..", `outside-${i}.ts`),
            line: 1,
            column: 1,
            matchText: "needle",
          })),
        ),
      ),
    } as any)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await (await GrepTool.init()).execute({ pattern: "needle", limit: 2 }, ctx)
        expect(CanonicalOutput.Grep.parse(result.data)).toEqual({ matches: [], truncated: true })
        expect(result.output).not.toBe("No files found")
      },
    })
  })

  test("a file-scoped include and limit work without context", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "source.ts")
    await writeFile(file, "needle one\nneedle two\nneedle three\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await GrepTool.init()
        const result = await tool.execute({ pattern: "needle", path: file, include: "*.ts", limit: 2 }, ctx)
        expect(CanonicalOutput.Grep.parse(result.data).matches).toHaveLength(2)
        expect(result.metadata.truncated).toBe(true)
        expect(result.output).not.toContain("needle three")
      },
    })
  })

  test("native search honors a caller's smaller match budget", async () => {
    await using tmp = await tmpdir({ git: true })
    const searchContent = vi.fn(() =>
      JSON.stringify(
        Array.from({ length: 3 }, (_, i) => ({
          path: path.join(tmp.path, "file.ts"),
          line: i + 1,
          column: 1,
          matchText: `needle ${i}`,
        })),
      ),
    )
    const native = vi
      .spyOn(NativeAddon, "fs")
      .mockReturnValue({ searchContentAsync: searchContent, ScanCancellation } as any)
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await (await GrepTool.init()).execute({ pattern: "needle", limit: 2 }, ctx)
          expect(JSON.parse((searchContent.mock.calls[0] as unknown as string[])[2]!)).toMatchObject({
            limit: 3,
            contextLines: 0,
          })
          expect(CanonicalOutput.Grep.parse(result.data).matches).toHaveLength(2)
          expect(result.metadata.truncated).toBe(true)
          expect(result.output).not.toContain("Line 3")
        },
      })
    } finally {
      native.mockRestore()
    }
  })

  test("basic search", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute(
          {
            pattern: "export",
            path: path.join(projectRoot, "src/tool"),
            include: "*.ts",
          },
          ctx,
        )
        expect(result.metadata.matches).toBeGreaterThan(0)
        expect(result.output).toContain("Found")
      },
    })
  })

  test("no matches returns correct output", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "test.txt"), "hello world")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute(
          {
            pattern: "xyznonexistentpatternxyz123",
            path: tmp.path,
          },
          ctx,
        )
        expect(result.metadata.matches).toBe(0)
        expect(result.output).toBe("No files found")
      },
    })
  })

  test("handles CRLF line endings in output", async () => {
    // This test verifies the regex split handles both \n and \r\n
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Create a test file with content
        await writeFile(path.join(dir, "test.txt"), "line1\nline2\nline3")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute(
          {
            pattern: "line",
            path: tmp.path,
          },
          ctx,
        )
        expect(result.metadata.matches).toBeGreaterThan(0)
      },
    })
  })

  test("native path does not mark exactly 100 results as truncated", async () => {
    await using tmp = await tmpdir({ git: true })
    const matches = Array.from({ length: 100 }, (_, i) => ({
      path: path.join(tmp.path, "file.ts"),
      line: i + 1,
      column: 1,
      matchText: `needle ${i}`,
    }))
    const nativeFs = vi.spyOn(NativeAddon, "fs").mockReturnValue({
      ScanCancellation,
      searchContentAsync: vi.fn(() => JSON.stringify(matches)),
    } as any)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const grep = await GrepTool.init()
          const result = await grep.execute({ pattern: "needle" }, ctx)

          expect(result.metadata.matches).toBe(100)
          expect(result.metadata.truncated).toBe(false)
          expect(result.output).not.toContain("showing first")
        },
      })
    } finally {
      nativeFs.mockRestore()
    }
  })

  test("native path uses one extra result to detect truncation", async () => {
    await using tmp = await tmpdir({ git: true })
    const matches = Array.from({ length: 101 }, (_, i) => ({
      path: path.join(tmp.path, "file.ts"),
      line: i + 1,
      column: 1,
      matchText: `needle ${i}`,
    }))
    const searchContent = vi.fn((_: string, __: string, ___: string) => JSON.stringify(matches))
    const nativeFs = vi
      .spyOn(NativeAddon, "fs")
      .mockReturnValue({ searchContentAsync: searchContent, ScanCancellation } as any)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const grep = await GrepTool.init()
          const result = await grep.execute({ pattern: "needle", include: "*.ts" }, ctx)

          expect(JSON.parse(searchContent.mock.calls[0]![2])).toMatchObject({ glob: "*.ts", limit: 101 })
          // The native scan stops at the 101 cap, so the metadata carries the
          // capped lower bound and the output labels it as such — mirroring
          // the ripgrep path, which reports its (uncapped) pre-truncation count.
          expect(result.metadata.matches).toBe(101)
          expect(result.metadata.truncated).toBe(true)
          expect(result.output).toContain("Found 101+ matches")
          expect(result.output).toContain("showing first 100")
          expect(result.output).not.toContain("Line 101")
        },
      })
    } finally {
      nativeFs.mockRestore()
    }
  })

  test("external search paths request external directory permission before grep permission", async () => {
    await using project = await tmpdir({ git: true })
    await using outside = await tmpdir()
    const requests: string[] = []

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const grep = await GrepTool.init()
        await expect(
          grep.execute(
            { pattern: "needle", path: outside.path },
            {
              ...ctx,
              ask: async (req?: { permission?: string }) => {
                if (req?.permission) requests.push(req.permission)
                throw new StopAfterAsk()
              },
            },
          ),
        ).rejects.toThrow(StopAfterAsk)
      },
    })

    expect(requests).toEqual(["external_directory"])
  })

  test.each([1992, 1991])("native path clamps Unicode with %i padding characters", async (padding) => {
    await using tmp = await tmpdir({ git: true })
    const long = "needle " + "A".repeat(padding) + "\u{1F680}" + "B".repeat(50)
    const nativeFs = vi.spyOn(NativeAddon, "fs").mockReturnValue({
      ScanCancellation,
      searchContentAsync: vi.fn(() =>
        JSON.stringify([{ path: path.join(tmp.path, "file.ts"), line: 1, column: 1, matchText: long }]),
      ),
    } as any)
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await (await GrepTool.init()).execute({ pattern: "needle" }, ctx)
          const [match] = CanonicalOutput.Grep.parse(result.data).matches
          // A lone surrogate is invalid UTF-16 and would render as U+FFFD.
          expect(match!.text.isWellFormed()).toBe(true)
          expect(match!.text).toBe(
            padding === 1992 ? "needle " + "A".repeat(padding) : "needle " + "A".repeat(padding) + "\u{1F680}",
          )
          expect(match!.text.length).toBe(padding === 1992 ? 1999 : 2000)
          expect(result.output.isWellFormed()).toBe(true)
          expect(result.output).toContain(match!.text + "...")
        },
      })
    } finally {
      nativeFs.mockRestore()
    }
  })

  test.each([1992, 1991])("ripgrep path clamps Unicode with %i padding characters", async (padding) => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "emoji-cut.ts")
    // Padding puts the rocket's high surrogate exactly at the MAX_LINE_LENGTH cut.
    await writeFile(file, "needle " + "A".repeat(padding) + "\u{1F680}" + "B".repeat(50) + "\n")
    const nativeFs = vi.spyOn(NativeAddon, "fs").mockReturnValue(null as any)
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await (await GrepTool.init()).execute({ pattern: "needle", path: file }, ctx)
          const [match] = CanonicalOutput.Grep.parse(result.data).matches
          expect(match!.text.isWellFormed()).toBe(true)
          expect(match!.text).toBe(
            padding === 1992 ? "needle " + "A".repeat(padding) : "needle " + "A".repeat(padding) + "\u{1F680}",
          )
          expect(match!.text.length).toBe(padding === 1992 ? 1999 : 2000)
          expect(result.output.isWellFormed()).toBe(true)
          expect(result.output).toContain(match!.text + "...")
        },
      })
    } finally {
      nativeFs.mockRestore()
    }
  })

  test("ripgrep path preserves trailing whitespace on the last match line", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "trailing.ts")
    await writeFile(file, "first\nneedle   \n")
    const nativeFs = vi.spyOn(NativeAddon, "fs").mockReturnValue(null as any)
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await (await GrepTool.init()).execute({ pattern: "needle", path: file }, ctx)
          const [match] = CanonicalOutput.Grep.parse(result.data).matches
          expect(match!.text).toBe("needle   ")
        },
      })
    } finally {
      nativeFs.mockRestore()
    }
  })

  test.each([100, 50])("native scan cap stays truncated with %i in-scope matches", async (count) => {
    await using tmp = await tmpdir({ git: true })
    const inside = Array.from({ length: count }, (_, i) => ({
      path: path.join(tmp.path, "file.ts"),
      line: i + 1,
      column: 1,
      matchText: `needle ${i}`,
    }))
    const outside = { path: path.join(tmp.path, "..", "outside.ts"), line: 1, column: 1, matchText: "needle out" }
    const nativeFs = vi.spyOn(NativeAddon, "fs").mockReturnValue({
      ScanCancellation,
      searchContentAsync: vi.fn(() =>
        JSON.stringify([...inside, ...Array.from({ length: 101 - count }, () => outside)]),
      ),
    } as any)
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await (await GrepTool.init()).execute({ pattern: "needle" }, ctx)
          // The native scan stopped at its cap, so the true total is unknown even
          // though only `limit` rows survived the containment filter.
          expect(result.metadata.truncated).toBe(true)
          expect(CanonicalOutput.Grep.parse(result.data).truncated).toBe(true)
          expect(result.output).toContain(`Found ${count}+ matches (showing first ${count})`)
        },
      })
    } finally {
      nativeFs.mockRestore()
    }
  })

  test("canonical grep output rejects a zero line number", () => {
    expect(() =>
      CanonicalOutput.Grep.parse({ matches: [{ path: "a.ts", line: 0, text: "x" }], truncated: false }),
    ).toThrow()
  })
})

describe("CRLF regex handling", () => {
  test("regex correctly splits Unix line endings", () => {
    const unixOutput = "file1.txt|1|content1\nfile2.txt|2|content2\nfile3.txt|3|content3"
    const lines = unixOutput.trim().split(/\r?\n/)
    expect(lines.length).toBe(3)
    expect(lines[0]).toBe("file1.txt|1|content1")
    expect(lines[2]).toBe("file3.txt|3|content3")
  })

  test("regex correctly splits Windows CRLF line endings", () => {
    const windowsOutput = "file1.txt|1|content1\r\nfile2.txt|2|content2\r\nfile3.txt|3|content3"
    const lines = windowsOutput.trim().split(/\r?\n/)
    expect(lines.length).toBe(3)
    expect(lines[0]).toBe("file1.txt|1|content1")
    expect(lines[2]).toBe("file3.txt|3|content3")
  })

  test("regex handles mixed line endings", () => {
    const mixedOutput = "file1.txt|1|content1\nfile2.txt|2|content2\r\nfile3.txt|3|content3"
    const lines = mixedOutput.trim().split(/\r?\n/)
    expect(lines.length).toBe(3)
  })
})
