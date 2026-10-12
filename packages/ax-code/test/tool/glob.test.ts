import { afterEach, describe, expect, test, vi } from "vitest"
import path from "path"
import { mkdir, symlink, writeFile } from "fs/promises"
import { GlobTool } from "../../src/tool/glob"
import { NativeAddon } from "../../src/native/addon"
import { Instance } from "../../src/project/instance"
import { Ripgrep } from "../../src/file/ripgrep"
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
  test("native relative results resolve against the requested search directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const search = path.join(tmp.path, "nested")
    await mkdir(search)
    const target = path.join(search, "found.ts")
    await writeFile(target, "export {}")
    const nativeFs = vi.spyOn(NativeAddon, "fs").mockReturnValue({
      globFiles: vi.fn(() => JSON.stringify([{ path: "found.ts", mtime: 1, size: 9 }])),
    } as any)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const glob = await GlobTool.init()
          const result = await glob.execute({ pattern: "*.ts", path: search }, ctx)
          expect(result.metadata.count).toBe(1)
          expect(result.data).toEqual({ paths: [target], truncated: false })
          expect(result.output).toBe(target)
        },
      })
    } finally {
      nativeFs.mockRestore()
    }
  })

  test("JS fallback keeps vanished matches with mtime 0", async () => {
    await using tmp = await tmpdir()

    const target = path.join(tmp.path, "gone.txt")
    const nativeFs = vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)
    // The match vanished between the ripgrep listing and the per-file stat.
    const files = vi.spyOn(Ripgrep, "files").mockImplementation(async function* () {
      yield "gone.txt"
    })

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const glob = await GlobTool.init()
          const result = await glob.execute({ pattern: "gone.txt" }, ctx)

          expect(files).toHaveBeenCalled()
          expect(result.output).toContain(target)
          expect(result.metadata.count).toBe(1)
        },
      })
    } finally {
      nativeFs.mockRestore()
      files.mockRestore()
    }
  })

  test("JS fallback propagates real stat errors instead of mis-ordering results", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // rg --files never lists symlinks, so a real self-loop surfaces only when
        // a listed match is replaced by one; stat then fails with ELOOP, a real
        // error the fallback must not swallow into mtime 0.
        await symlink(path.join(dir, "loop.txt"), path.join(dir, "loop.txt"))
      },
    })

    const nativeFs = vi.spyOn(NativeAddon, "fs").mockReturnValue(undefined)
    const files = vi.spyOn(Ripgrep, "files").mockImplementation(async function* () {
      yield "loop.txt"
    })

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const glob = await GlobTool.init()
          await expect(glob.execute({ pattern: "loop.txt" }, ctx)).rejects.toThrow()
        },
      })
    } finally {
      nativeFs.mockRestore()
      files.mockRestore()
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
