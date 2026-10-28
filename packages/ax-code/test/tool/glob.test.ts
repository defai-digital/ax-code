import { afterEach, describe, expect, test, vi } from "vitest"
import path from "path"
import { mkdir, symlink, writeFile } from "fs/promises"
import { GlobTool } from "../../src/tool/glob"
import { NativeAddon } from "../../src/native/addon"
import { Instance } from "../../src/project/instance"
import { Ripgrep } from "../../src/file/ripgrep"
import { tmpdir } from "../fixture/fixture"
import { parseJsonStrict } from "@ax-code/util/json-value"

const ctx = {
  abort: AbortSignal.any([]),
  ask: async () => {},
} as any

class StopAfterAsk extends Error {}

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

const nativeBinding = NativeAddon.fs()
test.skipIf(!nativeBinding?.globFilesAsync)(
  "native glob worker keeps newest entries and stable ties with bounded selection",
  async () => {
    const { utimes } = await import("node:fs/promises")
    await using tmp = await tmpdir({ git: true })
    await writeFile(path.join(tmp.path, ".gitignore"), "ignored.txt\n")
    for (let i = 0; i < 150; i++) {
      const file = path.join(tmp.path, `file-${i}.txt`)
      await writeFile(file, "test")
      await utimes(file, 1000, i > 130 ? 2000 : 1000)
    }
    await writeFile(path.join(tmp.path, "ignored.txt"), "ignore")
    await writeFile(path.join(tmp.path, ".hidden.txt"), "hidden")
    const full = parseJsonStrict(nativeBinding!.globFiles(tmp.path, "**/*.txt", 1000)) as unknown[]
    const async = parseJsonStrict(
      await nativeBinding!.globFilesAsync!(tmp.path, "**/*.txt", 101, new nativeBinding!.ScanCancellation()),
    )
    expect(async).toEqual(full.slice(0, 101))
    expect(JSON.stringify(async)).not.toContain("ignored.txt")
    expect(JSON.stringify(full)).toContain(".hidden.txt")
    const cancel = new nativeBinding!.ScanCancellation()
    cancel.cancel()
    await expect(nativeBinding!.globFilesAsync!(tmp.path, "*", 101, cancel)).rejects.toThrow("cancelled")
    await expect(
      nativeBinding!.globFilesAsync!(tmp.path, "*", 10001, new nativeBinding!.ScanCancellation()),
    ).rejects.toThrow("input limit")
  },
)

test.skipIf(!nativeBinding?.globFiles)(
  "native glob does not let * cross /, matching the ripgrep fallback",
  async () => {
    await using tmp = await tmpdir({ git: true })
    await mkdir(path.join(tmp.path, "sub", "deep"), { recursive: true })
    await writeFile(path.join(tmp.path, "sub", "b.ts"), "")
    await writeFile(path.join(tmp.path, "sub", "deep", "c.ts"), "")
    const shallow = (parseJsonStrict(nativeBinding!.globFiles(tmp.path, "sub/*.ts", 10)) as { path: string }[]).map(
      (m) => m.path,
    )
    // `rg --files -g 'sub/*.ts'` returns only the direct child.
    expect(shallow).toEqual(["sub/b.ts"])
    // A slash-less pattern still matches at any depth (ripgrep basename rule).
    const anyDepth = (parseJsonStrict(nativeBinding!.globFiles(tmp.path, "*.ts", 10)) as { path: string }[])
      .map((m) => m.path)
      .sort()
    expect(anyDepth).toEqual(["sub/b.ts", "sub/deep/c.ts"])
  },
)

test("old native glob capability falls back without invoking its synchronous export", async () => {
  await using tmp = await tmpdir({ git: true })
  await writeFile(path.join(tmp.path, "file.ts"), "export {}")
  const sync = vi.fn()
  vi.spyOn(NativeAddon, "fs").mockReturnValue({ globFiles: sync } as unknown as ReturnType<typeof NativeAddon.fs>)
  const files = vi.spyOn(Ripgrep, "files").mockImplementation(async function* () {
    yield "file.ts"
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = await (await GlobTool.init()).execute({ pattern: "*.ts" }, ctx)
      expect(result.data).toEqual({ paths: [path.join(tmp.path, "file.ts")], truncated: false })
    },
  })
  expect(sync).not.toHaveBeenCalled()
  expect(files).toHaveBeenCalledTimes(1)
})

test("glob abort cancels the worker and never falls back or publishes a late result", async () => {
  await using tmp = await tmpdir({ git: true })
  let complete!: (value: string) => void
  const cancel = vi.fn()
  const started = Promise.withResolvers<void>()
  const worker = vi.fn(() => {
    started.resolve()
    return new Promise<string>((resolve) => {
      complete = resolve
    })
  })
  vi.spyOn(NativeAddon, "fs").mockReturnValue({
    globFilesAsync: worker,
    ScanCancellation: class {
      cancel = cancel
    },
  } as unknown as ReturnType<typeof NativeAddon.fs>)
  const fallback = vi.spyOn(Ripgrep, "files")
  const controller = new AbortController()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const promise = (await GlobTool.init()).execute({ pattern: "*.ts" }, { ...ctx, abort: controller.signal })
      await started.promise
      controller.abort()
      await expect(promise).rejects.toThrow()
      expect(cancel).toHaveBeenCalledTimes(1)
      complete("[]")
    },
  })
  expect(fallback).not.toHaveBeenCalled()
})

describe("tool.glob", () => {
  test("native relative results resolve against the requested search directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const search = path.join(tmp.path, "nested")
    await mkdir(search)
    const target = path.join(search, "found.ts")
    await writeFile(target, "export {}")
    const nativeFs = vi.spyOn(NativeAddon, "fs").mockReturnValue({
      ScanCancellation: class {
        cancel() {}
      },
      globFilesAsync: vi.fn(async () => JSON.stringify([{ path: "found.ts", mtime: 1, size: 9 }])),
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

  test("titles a search of the workspace root instead of leaving it blank", async () => {
    await using tmp = await tmpdir({ git: true })
    const nativeFs = vi.spyOn(NativeAddon, "fs").mockReturnValue({
      ScanCancellation: class {
        cancel() {}
      },
      globFilesAsync: vi.fn(async () => JSON.stringify([{ path: path.join(tmp.path, "a.ts"), mtime: 1, size: 1 }])),
    } as any)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const glob = await GlobTool.init()
          const result = await glob.execute({ pattern: "*.ts" }, ctx)

          expect(result.title).toBe(tmp.path)
        },
      })
    } finally {
      nativeFs.mockRestore()
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
      ScanCancellation: class {
        cancel() {}
      },
      globFilesAsync: vi.fn(async () => JSON.stringify(entries)),
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
    const nativeFs = vi.spyOn(NativeAddon, "fs").mockReturnValue({
      globFilesAsync: globFiles,
      ScanCancellation: class {
        cancel() {}
      },
    } as any)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const glob = await GlobTool.init()
          const result = await glob.execute({ pattern: "*.ts" }, ctx)

          expect(globFiles).toHaveBeenCalledWith(
            tmp.path,
            "*.ts",
            101,
            expect.objectContaining({ cancel: expect.any(Function) }),
          )
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
