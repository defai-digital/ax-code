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
