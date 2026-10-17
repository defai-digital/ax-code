import { afterEach, describe, expect, test, vi } from "vitest"
import { createTwoFilesPatch, diffLines, formatPatch } from "diff"
import type { StructuredPatch } from "diff"
import { NativePerf } from "../../src/perf/native"
import { NativeAddon } from "../../src/native/addon"
import { diffPreview, diffPreviewSync } from "../../src/tool/diff-preview"
import { parseJsonStrict } from "@ax-code/util/json-value"

const native = NativeAddon.diff()
const enabled = !!native?.diffPreviewAsync && !!native.DiffCancellation
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  NativePerf.reset()
})

function expected(before: string, after: string, normalize = false, file = "a file😀.ts") {
  let additions = 0,
    deletions = 0
  for (const change of diffLines(before, after)) {
    if (change.added) additions += change.count
    if (change.removed) deletions += change.count
  }
  return {
    diff: createTwoFilesPatch(
      file,
      file,
      normalize ? before.replace(/\r\n/g, "\n") : before,
      normalize ? after.replace(/\r\n/g, "\n") : after,
    ),
    additions,
    deletions,
  }
}

describe.skipIf(!enabled)("native canonical diff preview", () => {
  test("byte-exact jsdiff parity across seeded ties, Unicode, EOF and EOL fixtures", async () => {
    let seed = 76543
    const pick = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % n
    }
    const words = ["a", "b", "", "😀", "\uFEFF", "\u2028", "\u2029", "a\r", "x\t", "é"]
    const fixtures: Array<[string, string]> = [
      ["", ""],
      ["", "a"],
      ["a", ""],
      ["a", "a\n"],
      ["a\n", "a"],
      ["a\nb\na\n", "b\na\nb\n"],
    ]
    for (const gap of [7, 8, 9])
      fixtures.push(["old\n" + "same\n".repeat(gap) + "old\n", "new\n" + "same\n".repeat(gap) + "new\n"])
    for (let i = 0; i < 500; i++) {
      const make = () =>
        Array.from({ length: pick(35) }, () => words[pick(words.length)] + (pick(3) ? "\n" : "\r\n")).join("") +
        (pick(2) ? "tail" : "")
      fixtures.push([make(), make()])
    }
    for (const [before, after] of fixtures)
      for (const normalize of [false, true]) {
        const json = await native!.diffPreviewAsync!(before, after, normalize, new native!.DiffCancellation!())
        const result = parseJsonStrict(json) as {
          hunks: StructuredPatch["hunks"]
          additions: number
          deletions: number
        }
        expect(
          {
            diff: formatPatch({
              oldFileName: "a file😀.ts",
              newFileName: "a file😀.ts",
              oldHeader: undefined,
              newHeader: undefined,
              hunks: result.hunks,
            }),
            additions: result.additions,
            deletions: result.deletions,
          },
          JSON.stringify([before, after, normalize]),
        ).toEqual(expected(before, after, normalize))
      }
  })

  test("actual large host dispatch preserves normalized preview and raw statistics", async () => {
    vi.stubEnv("AX_CODE_PROFILE_NATIVE", "1")
    const before = "head\r\n" + "unchanged\r\n".repeat(10_000) + "old"
    const after = before.replace("head\r\n", "head\n").replace(/old$/, "new\n")
    expect(await diffPreview("a file😀.ts", before, after, undefined, true)).toEqual(expected(before, after, true))
    expect(NativePerf.snapshot().operations.find((row) => row.name === "diff.preview")?.phases).toMatchObject({
      admit: { calls: 1 },
      queue: { calls: 1 },
      native: { calls: 1 },
      decode: { calls: 1 },
      format: { calls: 1 },
      total: { calls: 1 },
    })
  })

  test("pre-cancelled and running native computations reject, never publish partial hunks", async () => {
    const cancellation = new native!.DiffCancellation!()
    cancellation.cancel()
    await expect(native!.diffPreviewAsync!("a", "b", false, cancellation)).rejects.toThrow("cancelled")
    const running = new native!.DiffCancellation!()
    const promise = native!.diffPreviewAsync!("a\n".repeat(50_000), "b\n".repeat(50_000), false, running)
    running.cancel()
    await expect(promise).rejects.toThrow("cancelled")
  })

  test("adversarial work and line budgets fail explicitly", async () => {
    await expect(
      native!.diffPreviewAsync!("a\n".repeat(3000), "b\n".repeat(3000), false, new native!.DiffCancellation!()),
    ).rejects.toThrow("resource limit")
    await expect(
      native!.diffPreviewAsync!("\n".repeat(200_001), "", false, new native!.DiffCancellation!()),
    ).rejects.toThrow("resource limit")
  })
})

test("missing/old addons and lone surrogates preserve canonical fallback output", async () => {
  const spy = vi.spyOn(NativeAddon, "diff").mockReturnValue(undefined)
  const before = "common\n".repeat(6_000) + "\ud800old"
  const after = before.replace(/old$/, "new")
  expect(await diffPreview("a file😀.ts", before, after)).toEqual(expected(before, after))
  const worker = vi.fn()
  spy.mockReturnValue({ diffPreviewAsync: worker } as unknown as ReturnType<typeof NativeAddon.diff>)
  expect(await diffPreview("a file😀.ts", "old\r\n", "new\n", undefined, true)).toEqual(
    expected("old\r\n", "new\n", true),
  )
  spy.mockReturnValue({
    ...native,
    diffPreviewAsync: worker,
    DiffCancellation: class {
      cancel() {}
    },
  } as unknown as ReturnType<typeof NativeAddon.diff>)
  expect(await diffPreview("a file😀.ts", before, after)).toEqual(expected(before, after))
  expect(worker).not.toHaveBeenCalled()
})

test("worker errors and malformed output do not launch fallback", async () => {
  const worker = vi.fn().mockRejectedValue(new DOMException("deadline", "TimeoutError"))
  vi.spyOn(NativeAddon, "diff").mockReturnValue({
    diffPreviewAsync: worker,
    DiffCancellation: class {
      cancel() {}
    },
  } as unknown as ReturnType<typeof NativeAddon.diff>)
  await expect(diffPreview("file", "a\n".repeat(40_000), "b")).rejects.toThrow("deadline")
  worker.mockResolvedValue('{"version":1,"hunks":[],"additions":-1,"deletions":0}')
  await expect(diffPreview("file", "a\n".repeat(40_000), "b")).rejects.toThrow("Invalid native")
})

test("pre-abort and late completion cannot publish a preview", async () => {
  let complete!: (value: string) => void
  const cancel = vi.fn()
  const worker = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        complete = resolve
      }),
  )
  vi.spyOn(NativeAddon, "diff").mockReturnValue({
    diffPreviewAsync: worker,
    DiffCancellation: class {
      cancel = cancel
    },
  } as unknown as ReturnType<typeof NativeAddon.diff>)
  await expect(diffPreview("file", "a", "b", AbortSignal.abort())).rejects.toThrow()
  expect(worker).not.toHaveBeenCalled()
  const controller = new AbortController()
  const promise = diffPreview("file", "a\n".repeat(40_000), "b", controller.signal)
  controller.abort()
  await expect(promise).rejects.toThrow()
  expect(cancel).toHaveBeenCalledTimes(1)
  complete('{"version":1,"hunks":[],"additions":0,"deletions":0}')
})

test("legacy synchronous fallback is bounded and retains canonical small patches", () => {
  expect(diffPreviewSync("a file😀.ts", "a\nb\n", "b\na\n")).toEqual(expected("a\nb\n", "b\na\n"))
  expect(() => diffPreviewSync("file", "a\n".repeat(3000), "b\n".repeat(3000))).toThrow("resource limit")
})

test.each(["edit", "patch"])("%s rejects failed preview before approval or file mutation", async (kind) => {
  const { tmpdir } = await import("../fixture/fixture")
  const { Instance } = await import("../../src/project/instance")
  const { FileTime } = await import("../../src/file/time")
  const { EditTool } = await import("../../src/tool/edit-impl")
  const { ApplyPatchTool } = await import("../../src/tool/apply_patch")
  const { SessionID, MessageID } = await import("../../src/session/schema")
  const fs = await import("node:fs/promises")
  const path = await import("node:path")
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "large.txt")
  const content = "old\n" + "common\n".repeat(10_000)
  await fs.writeFile(file, content)
  const worker = vi.fn(async () => {
    throw new DOMException("preview deadline", "TimeoutError")
  })
  vi.spyOn(NativeAddon, "diff").mockReturnValue({
    diffPreviewAsync: worker,
    DiffCancellation: class {
      cancel() {}
    },
  } as unknown as ReturnType<typeof NativeAddon.diff>)
  const ask = vi.fn()
  const ctx = {
    sessionID: SessionID.make("ses_preview_failure"),
    messageID: MessageID.make(""),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata() {},
    ask,
  }
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await FileTime.read(ctx.sessionID, file)
        const promise =
          kind === "edit"
            ? (await EditTool.init()).execute({ filePath: file, oldString: "old", newString: "new" }, ctx)
            : (await ApplyPatchTool.init()).execute(
                { patchText: "*** Begin Patch\n*** Update File: large.txt\n@@\n-old\n+new\n*** End Patch" },
                ctx,
              )
        await expect(promise).rejects.toThrow("preview deadline")
        expect(worker).toHaveBeenCalledTimes(1)
        expect(ask).not.toHaveBeenCalled()
        expect(await fs.readFile(file, "utf8")).toBe(content)
      },
    })
  } finally {
    await Instance.disposeAll()
  }
})

test.skipIf(!enabled)(
  "patch preview stays bound to its original snapshot if the file changes during the worker",
  async () => {
    const { tmpdir } = await import("../fixture/fixture")
    const { Instance } = await import("../../src/project/instance")
    const { FileTime } = await import("../../src/file/time")
    const { ApplyPatchTool } = await import("../../src/tool/apply_patch")
    const { SessionID, MessageID } = await import("../../src/session/schema")
    const fs = await import("node:fs/promises")
    const path = await import("node:path")
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "large.txt")
    const content = "old\n" + "common\n".repeat(10_000)
    await fs.writeFile(file, content)
    const worker = vi.fn(
      async (
        before: string,
        after: string,
        normalize: boolean,
        cancel: InstanceType<NonNullable<typeof native>["DiffCancellation"] & {}>,
      ) => {
        expect(before).toBe(content)
        await fs.writeFile(file, "concurrent edit\n")
        return native!.diffPreviewAsync!(before, after, normalize, cancel)
      },
    )
    vi.spyOn(NativeAddon, "diff").mockReturnValue({ ...native, diffPreviewAsync: worker } as ReturnType<
      typeof NativeAddon.diff
    >)
    const ctx = {
      sessionID: SessionID.make("ses_preview_stale"),
      messageID: MessageID.make(""),
      callID: "",
      agent: "build",
      abort: AbortSignal.any([]),
      messages: [],
      metadata() {},
      ask: vi.fn(),
    }
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(ctx.sessionID, file)
          await expect(
            (await ApplyPatchTool.init()).execute(
              { patchText: "*** Begin Patch\n*** Update File: large.txt\n@@\n-old\n+new\n*** End Patch" },
              ctx,
            ),
          ).rejects.toThrow("modified between verification and write")
          expect(worker).toHaveBeenCalledTimes(1)
          expect(await fs.readFile(file, "utf8")).toBe("concurrent edit\n")
        },
      })
    } finally {
      await Instance.disposeAll()
    }
  },
)
