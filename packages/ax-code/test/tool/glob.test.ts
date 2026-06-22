import { afterEach, describe, expect, test, vi } from "vitest"
import path from "path"
import { GlobTool, parseNativeGlobEntries } from "../../src/tool/glob"
import { NativeAddon } from "../../src/native/addon"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  abort: AbortSignal.any([]),
  ask: async () => {},
} as any

class StopAfterAsk extends Error {}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.glob", () => {
  test("parseNativeGlobEntries decodes valid native output", () => {
    expect(parseNativeGlobEntries(JSON.stringify([{ path: "/repo/a.ts", mtime: 12, size: 34 }]))).toEqual([
      { path: "/repo/a.ts", mtime: 12, size: 34 },
    ])
  })

  test("parseNativeGlobEntries rejects malformed native output", () => {
    expect(() => parseNativeGlobEntries("{not json")).toThrow(SyntaxError)
    expect(() => parseNativeGlobEntries(JSON.stringify({ path: "/repo/a.ts", mtime: 12, size: 34 }))).toThrow(
      SyntaxError,
    )
    expect(() => parseNativeGlobEntries(JSON.stringify([{ path: "/repo/a.ts", mtime: "12", size: 34 }]))).toThrow(
      SyntaxError,
    )
  })

  test("JS fallback keeps vanished matches with mtime 0", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "gone.txt"), "content")
      },
    })

    const target = path.join(tmp.path, "gone.txt")
    const realStat = Filesystem.stat
    const nativeFs = vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)
    const stat = vi.spyOn(Filesystem, "stat").mockImplementation((file) => {
      if (file === target) return undefined
      return realStat(file)
    })

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const glob = await GlobTool.init()
          const result = await glob.execute({ pattern: "gone.txt" }, ctx)

          expect(result.output).toContain(target)
          expect(result.metadata.count).toBe(1)
        },
      })
    } finally {
      nativeFs.mockRestore()
      stat.mockRestore()
    }
  })

  test("native path does not mark exactly 100 results as truncated", async () => {
    await using tmp = await tmpdir({ git: true })
    const entries = Array.from({ length: 100 }, (_, i) => ({
      path: path.join(tmp.path, `file-${String(i).padStart(3, "0")}.ts`),
      mtime: 100 - i,
      size: 1,
    }))
    const nativeFs = vi.spyOn(NativeAddon, "fs").mockReturnValue({
      globFiles: vi.fn(() => JSON.stringify(entries)),
    } as any)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const glob = await GlobTool.init()
          const result = await glob.execute({ pattern: "*.ts" }, ctx)

          expect(result.metadata.count).toBe(100)
          expect(result.metadata.truncated).toBe(false)
          expect(result.output).not.toContain("truncated")
        },
      })
    } finally {
      nativeFs.mockRestore()
    }
  })

  test("native path uses one extra result to detect truncation", async () => {
    await using tmp = await tmpdir({ git: true })
    const entries = Array.from({ length: 101 }, (_, i) => ({
      path: path.join(tmp.path, `file-${String(i).padStart(3, "0")}.ts`),
      mtime: 101 - i,
      size: 1,
    }))
    const globFiles = vi.fn(() => JSON.stringify(entries))
    const nativeFs = vi.spyOn(NativeAddon, "fs").mockReturnValue({ globFiles } as any)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const glob = await GlobTool.init()
          const result = await glob.execute({ pattern: "*.ts" }, ctx)

          expect(globFiles).toHaveBeenCalledWith(tmp.path, "*.ts", 101)
          expect(result.metadata.count).toBe(100)
          expect(result.metadata.truncated).toBe(true)
          expect(result.output).toContain("file-099.ts")
          expect(result.output).not.toContain("file-100.ts")
        },
      })
    } finally {
      nativeFs.mockRestore()
    }
  })

  test("external search paths request external directory permission before glob permission", async () => {
    await using project = await tmpdir({ git: true })
    await using outside = await tmpdir()
    const requests: string[] = []

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const glob = await GlobTool.init()
        await expect(
          glob.execute(
            { pattern: "*.ts", path: outside.path },
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
