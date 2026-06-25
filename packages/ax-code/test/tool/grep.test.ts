import { afterEach, describe, expect, test, vi } from "vitest"
import path from "path"
import { writeFile } from "fs/promises"
import { GrepTool, parseNativeSearchMatches, parseRipgrepLineNumber } from "../../src/tool/grep"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { NativeAddon } from "../../src/native/addon"

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

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.grep", () => {
  test("parseNativeSearchMatches decodes valid native output", () => {
    expect(
      parseNativeSearchMatches(JSON.stringify([{ path: "/repo/a.ts", line: 2, column: 4, matchText: "needle" }])),
    ).toEqual([{ path: "/repo/a.ts", line: 2, column: 4, matchText: "needle" }])
  })

  test("parseNativeSearchMatches rejects malformed native output", () => {
    expect(() => parseNativeSearchMatches("{not json")).toThrow(SyntaxError)
    expect(() =>
      parseNativeSearchMatches(JSON.stringify({ path: "/repo/a.ts", line: 2, column: 4, matchText: "needle" })),
    ).toThrow(SyntaxError)
    expect(() =>
      parseNativeSearchMatches(JSON.stringify([{ path: "/repo/a.ts", line: "2", column: 4, matchText: "needle" }])),
    ).toThrow(SyntaxError)
  })

  test("parseRipgrepLineNumber accepts only complete safe integers", () => {
    expect(parseRipgrepLineNumber("12")).toBe(12)
    expect(parseRipgrepLineNumber("12abc")).toBeUndefined()
    expect(parseRipgrepLineNumber("-1")).toBeUndefined()
    expect(parseRipgrepLineNumber("1.5")).toBeUndefined()
    expect(parseRipgrepLineNumber("9007199254740992")).toBeUndefined()
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
      searchContent: vi.fn(() => JSON.stringify(matches)),
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
    const nativeFs = vi.spyOn(NativeAddon, "fs").mockReturnValue({ searchContent } as any)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const grep = await GrepTool.init()
          const result = await grep.execute({ pattern: "needle", include: "*.ts" }, ctx)

          expect(JSON.parse(searchContent.mock.calls[0]![2])).toMatchObject({ glob: "*.ts", limit: 101 })
          expect(result.metadata.matches).toBe(100)
          expect(result.metadata.truncated).toBe(true)
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
