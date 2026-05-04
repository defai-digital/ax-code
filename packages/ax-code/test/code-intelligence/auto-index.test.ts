import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { setTimeout as sleep } from "node:timers/promises"
import { AutoIndex } from "../../src/code-intelligence/auto-index"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { Ripgrep } from "../../src/file/ripgrep"
import { NativeAddon } from "../../src/native/addon"
import { Instance } from "../../src/project/instance"
import { ProjectID } from "../../src/project/schema"
import { tmpdir } from "../fixture/fixture"

let nativeIndexSpy: ReturnType<typeof spyOn> | undefined
let countNodesSpy: ReturnType<typeof spyOn> | undefined
let filesSpy: ReturnType<typeof spyOn> | undefined
let indexFilesSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  nativeIndexSpy?.mockRestore()
  nativeIndexSpy = undefined
  countNodesSpy?.mockRestore()
  countNodesSpy = undefined
  filesSpy?.mockRestore()
  filesSpy = undefined
  indexFilesSpy?.mockRestore()
  indexFilesSpy = undefined
})

describe("AutoIndex.maybeStart", () => {
  test("runs with fallback concurrency when the native index addon is unavailable", async () => {
    await using tmp = await tmpdir()
    nativeIndexSpy = spyOn(NativeAddon, "index").mockReturnValue(undefined)
    countNodesSpy = spyOn(CodeGraphQuery, "countNodes").mockReturnValue(0)
    filesSpy = spyOn(Ripgrep, "files").mockImplementation(async function* () {
      yield "src/example.ts"
    })
    indexFilesSpy = spyOn(CodeIntelligence, "indexFiles").mockResolvedValue({
      nodes: 1,
      edges: 0,
      files: 1,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      pruned: { files: 0, nodes: 0, edges: 0 },
      timings: {
        readFile: 0,
        lspTouch: 0,
        lspDocumentSymbol: 0,
        symbolWalk: 0,
        lspReferences: 0,
        edgeResolve: 0,
        dbTransaction: 0,
        total: 0,
      },
    })

    await Instance.reload({
      directory: tmp.path,
      worktree: tmp.path,
      project: {
        id: ProjectID.make("proj_auto_index_fallback"),
        worktree: tmp.path,
        name: "auto-index-fallback",
        time: { created: Date.now(), updated: Date.now() },
        sandboxes: [],
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: () => AutoIndex.maybeStart(ProjectID.make("proj_auto_index_fallback")),
    })

    for (let i = 0; i < 20 && (indexFilesSpy?.mock.calls.length ?? 0) === 0; i++) {
      await sleep(10)
    }

    expect(countNodesSpy).toHaveBeenCalled()
    expect(indexFilesSpy).toHaveBeenCalledWith(
      ProjectID.make("proj_auto_index_fallback"),
      [expect.stringContaining("src/example.ts")],
      expect.objectContaining({
        concurrency: 1,
        lock: "try",
      }),
    )
  })
})
