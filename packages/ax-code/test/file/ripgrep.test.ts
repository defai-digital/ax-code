import { afterEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { PassThrough } from "node:stream"
import { NativeAddon } from "../../src/native/addon"
import { Process } from "../../src/util/process"
import { tmpdir } from "../fixture/fixture"
import { Ripgrep } from "../../src/file/ripgrep"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("file.ripgrep", () => {
  test("decodeJsonResult decodes already-parsed ripgrep records", () => {
    expect(
      Ripgrep.decodeJsonResult({
        type: "begin",
        data: {
          path: { text: "src/index.ts" },
        },
      }),
    ).toEqual({
      type: "begin",
      data: {
        path: { text: "src/index.ts" },
      },
    })
    expect(Ripgrep.decodeJsonResult({ type: "match", data: {} })).toBeUndefined()
  })

  test("parseJsonLine decodes ripgrep JSON records", () => {
    expect(
      Ripgrep.parseJsonLine(
        `  ${JSON.stringify({
          type: "match",
          data: {
            path: { text: "src/index.ts" },
            lines: { text: "const needle = true\n" },
            line_number: 1,
            absolute_offset: 0,
            submatches: [
              {
                match: { text: "needle" },
                start: 6,
                end: 12,
              },
            ],
          },
        })}\n`,
      ),
    ).toMatchObject({
      type: "match",
      data: {
        path: { text: "src/index.ts" },
        line_number: 1,
      },
    })
  })

  test("parseJsonLine rejects malformed ripgrep JSON records", () => {
    expect(Ripgrep.parseJsonLine("{not json")).toBeUndefined()
    expect(Ripgrep.parseJsonLine("")).toBeUndefined()
    expect(Ripgrep.parseJsonLine(JSON.stringify({ type: "match", data: {} }))).toBeUndefined()
  })

  test("defaults to include hidden", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "visible.txt"), "hello")
        await fs.mkdir(path.join(dir, ".ax-code"), { recursive: true })
        await Bun.write(path.join(dir, ".ax-code", "thing.json"), "{}")
      },
    })

    const files = await Array.fromAsync(Ripgrep.files({ cwd: tmp.path }))
    const hasVisible = files.includes("visible.txt")
    const hasHidden = files.includes(path.join(".ax-code", "thing.json"))
    expect(hasVisible).toBe(true)
    expect(hasHidden).toBe(true)
  })

  test("hidden false excludes hidden", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "visible.txt"), "hello")
        await fs.mkdir(path.join(dir, ".ax-code"), { recursive: true })
        await Bun.write(path.join(dir, ".ax-code", "thing.json"), "{}")
      },
    })

    const files = await Array.fromAsync(Ripgrep.files({ cwd: tmp.path, hidden: false }))
    const hasVisible = files.includes("visible.txt")
    const hasHidden = files.includes(path.join(".ax-code", "thing.json"))
    expect(hasVisible).toBe(true)
    expect(hasHidden).toBe(false)
  })

  test("search returns empty when nothing matches", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "match.ts"), "const value = 'other'\n")
      },
    })

    const hits = await Ripgrep.search({
      cwd: tmp.path,
      pattern: "needle",
    })

    expect(hits).toEqual([])
  })

  test("search treats zero limit as no results", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "match.ts"), "const value = 'needle'\n")
      },
    })

    const hits = await Ripgrep.search({
      cwd: tmp.path,
      pattern: "needle",
      limit: 0,
    })

    expect(hits).toEqual([])
  })

  test("search limit caps total matches, not matches per file", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.ts"), "needle one\nneedle two\n")
        await Bun.write(path.join(dir, "b.ts"), "needle three\nneedle four\n")
      },
    })

    const hits = await Ripgrep.search({
      cwd: tmp.path,
      pattern: "needle",
      limit: 1,
    })

    expect(hits).toHaveLength(1)
  })

  test("files() surfaces inaccessible cwd instead of reporting it missing", async () => {
    if (process.platform === "win32") return

    await using tmp = await tmpdir()
    const locked = path.join(tmp.path, "locked")
    const cwd = path.join(locked, "project")
    await fs.mkdir(locked)
    await fs.chmod(locked, 0)
    vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)

    try {
      await expect(Array.fromAsync(Ripgrep.files({ cwd }))).rejects.toMatchObject({ code: "EACCES" })
    } finally {
      await fs.chmod(locked, 0o700)
    }
  })

  test("files() terminates spawned ripgrep process when generator is returned early", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "visible.txt"), "hello")
      },
    })

    const nativeFs = vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)
    const proc = {
      exitCode: null,
      signalCode: null,
      exited: new Promise<number>(() => {}),
      stdout: new PassThrough(),
    }
    const spawn = vi.spyOn(Process, "spawn").mockReturnValue(proc as never)
    const killProcessTree = vi.spyOn(Process, "killProcessTree").mockResolvedValue(undefined)

    const iterator = Ripgrep.files({ cwd: tmp.path })[Symbol.asyncIterator]()
    proc.stdout.write("visible.txt\n")

    const first = await iterator.next()
    expect(first.value).toBe("visible.txt")

    const result = await iterator.return()
    expect(result.done).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(killProcessTree).toHaveBeenCalledWith(proc as never)
    expect(killProcessTree).toHaveBeenCalledTimes(1)
  })
})
