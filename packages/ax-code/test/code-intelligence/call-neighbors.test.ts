import { afterEach, describe, expect, test, vi } from "vitest"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { existsSync } from "node:fs"
import { NativeAddon } from "../../src/native/addon"
import { CodeNodeID } from "../../src/code-intelligence/id"
import type { ProjectID } from "../../src/project/schema"
import { decodeCallNeighbors } from "../../src/code-intelligence/call-neighbors"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { CodeIntelligence } from "../../src/code-intelligence"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const prior = process.env.AX_CODE_NATIVE_INDEX
process.env.AX_CODE_NATIVE_INDEX = "1"
const native = NativeAddon.index()
if (prior === undefined) delete process.env.AX_CODE_NATIVE_INDEX
else process.env.AX_CODE_NATIVE_INDEX = prior
const enabled = !!native?.callNeighborsAsync && !!native.IndexCancellation
const project = "neighbor-project"
afterEach(() => vi.restoreAllMocks())
function node(id: string, p = project, file = "/a😀.ts") {
  return {
    id,
    project_id: p as ProjectID,
    kind: "function" as const,
    name: id,
    qualified_name: id,
    file,
    range_start_line: 1,
    range_start_char: 3,
    range_end_line: 4,
    range_end_char: 5,
    signature: null,
    visibility: null,
  }
}
function edge(id: string, from_node: string, to_node: string, p = project) {
  return {
    id,
    project_id: p,
    kind: "calls",
    from_node,
    to_node,
    file: "/a😀.ts",
    range_start_line: 0,
    range_start_char: 0,
    range_end_line: 1,
    range_end_char: 0,
  }
}
function legacy(store: InstanceType<NonNullable<typeof native>["IndexStore"]>, symbol: string, callers: boolean) {
  const edges = JSON.parse(
    callers ? store.edgesTo(project, symbol, "calls") : store.edgesFrom(project, symbol, "calls"),
  ) as ReturnType<typeof edge>[]
  return edges.flatMap((e) => {
    const json = store.getNode(project, callers ? e.from_node : e.to_node)
    if (!json) return []
    const n = JSON.parse(json) as ReturnType<typeof node>
    const jsonFile = store.getFile(project, n.file)
    const f = jsonFile ? JSON.parse(jsonFile) : undefined
    return [
      { ...node(n.id, n.project_id, n.file), indexed_at: f?.indexed_at ?? null, completeness: f?.completeness ?? null },
    ]
  })
}

describe.skipIf(!enabled)("native call neighbor projections", () => {
  test("single join matches legacy order, duplicates, project isolation and missing provenance", async () => {
    await using tmp = await tmpdir({})
    const dbPath = path.join(tmp.path, "graph.db")
    const store = new native!.IndexStore(dbPath)
    try {
      store.insertNodes(
        JSON.stringify([node("root"), node("a"), node("b", project, "/missing.ts"), node("foreign", "other")]),
      )
      store.upsertFile(
        JSON.stringify({
          id: "file",
          project_id: project,
          path: "/a😀.ts",
          sha: "x",
          size: 1,
          lang: "typescript",
          completeness: "unexpected",
        }),
      )
      store.insertEdges(
        JSON.stringify([
          edge("z", "a", "root"),
          edge("a", "b", "root"),
          edge("duplicate", "a", "root"),
          edge("foreign", "foreign", "root"),
          edge("dangling", "absent", "root"),
          edge("outgoing", "root", "b"),
        ]),
      )
      for (const callers of [true, false]) {
        const expected = legacy(store, "root", callers)
        expect(JSON.parse(store.callNeighbors(project, "root", callers))).toEqual(expected)
        expect(
          JSON.parse(
            await native!.callNeighborsAsync!(dbPath, project, "root", callers, new native!.IndexCancellation!()),
          ),
        ).toEqual(expected)
      }
      expect(JSON.parse(store.callNeighbors(project, "root", true)).map((n: { id: string }) => n.id)).toEqual([
        "a",
        "b",
        "a",
      ])
    } finally {
      store.close()
    }
  })

  test("async readers observe committed WAL snapshots and never create a missing DB", async () => {
    await using tmp = await tmpdir({})
    const dbPath = path.join(tmp.path, "graph.db")
    const store = new native!.IndexStore(dbPath)
    const writer = new DatabaseSync(dbPath)
    try {
      store.insertNodes(JSON.stringify([node("root"), node("a")]))
      store.insertEdges(JSON.stringify([edge("edge", "a", "root")]))
      writer.exec("BEGIN IMMEDIATE; UPDATE code_node SET name='uncommitted' WHERE id='a'")
      const read = () => native!.callNeighborsAsync!(dbPath, project, "root", true, new native!.IndexCancellation!())
      expect(JSON.parse(await read())[0].name).toBe("a")
      writer.exec("COMMIT")
      expect(JSON.parse(await read())[0].name).toBe("uncommitted")
      const missing = path.join(tmp.path, "absent.db")
      await expect(
        native!.callNeighborsAsync!(missing, project, "root", true, new native!.IndexCancellation!()),
      ).rejects.toThrow()
      expect(existsSync(missing)).toBe(false)
    } finally {
      writer.close()
      store.close()
    }
  })

  test("cancellation and input/output/row budgets reject instead of truncating", async () => {
    await using tmp = await tmpdir({})
    const dbPath = path.join(tmp.path, "graph.db")
    const store = new native!.IndexStore(dbPath)
    const writer = new DatabaseSync(dbPath)
    try {
      store.insertNodes(JSON.stringify([node("root"), node("a")]))
      const token = new native!.IndexCancellation!()
      token.cancel()
      await expect(native!.callNeighborsAsync!(dbPath, project, "root", true, token)).rejects.toThrow("cancelled")
      await expect(
        native!.callNeighborsAsync!(dbPath, "x".repeat(16385), "root", true, new native!.IndexCancellation!()),
      ).rejects.toThrow("input limit")
      store.insertEdges(JSON.stringify(Array.from({ length: 50001 }, (_, i) => edge(`edge${i}`, "a", "root"))))
      await expect(
        native!.callNeighborsAsync!(dbPath, project, "root", true, new native!.IndexCancellation!()),
      ).rejects.toThrow("row limit")
      writer.exec("DELETE FROM code_edge WHERE id!='edge0'")
      writer.prepare("UPDATE code_node SET name=? WHERE id='a'").run("x".repeat(16 * 1024 * 1024))
      await expect(
        native!.callNeighborsAsync!(dbPath, project, "root", true, new native!.IndexCancellation!()),
      ).rejects.toThrow("output limit")
    } finally {
      writer.close()
      store.close()
    }
  })
})

test("public sync/async APIs preserve scope, duplicates and normalized explanation without N+1 queries", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const p = Instance.project.id
      const root = CodeNodeID.ascending(),
        inside = CodeNodeID.ascending(),
        outside = CodeNodeID.ascending()
      const rows = [
        {
          ...node(inside, p, path.join(tmp.path, "a.ts")),
          project_id: p,
          id: inside,
          indexed_at: 12,
          completeness: "unknown",
        },
        {
          ...node(outside, p, path.resolve(tmp.path, "../outside.ts")),
          project_id: p,
          id: outside,
          indexed_at: null,
          completeness: null,
        },
      ]
      rows.push(rows[0])
      vi.spyOn(CodeGraphQuery, "callNeighbors").mockReturnValue(rows)
      vi.spyOn(CodeGraphQuery, "callNeighborsAsync").mockResolvedValue(rows)
      const getNode = vi.spyOn(CodeGraphQuery, "getNode")
      const getFile = vi.spyOn(CodeGraphQuery, "getFile")
      const sync = CodeIntelligence.findCallers(p, root, { scope: "worktree" })
      const asyncResult = await CodeIntelligence.findCallersAsync(p, root, { scope: "worktree" })
      const normalize = (result: typeof sync) =>
        result.map(({ symbol, depth }) => ({ depth, ...symbol, explain: { ...symbol.explain, queryId: "ignored" } }))
      expect(normalize(asyncResult)).toEqual(normalize(sync))
      expect(sync.map((entry) => entry.symbol.id)).toEqual([inside, inside])
      expect(sync[0].symbol.explain).toMatchObject({ indexedAt: 12, completeness: "partial" })
      expect(getNode).not.toHaveBeenCalled()
      expect(getFile).not.toHaveBeenCalled()
    },
  })
})

test("native result schema rejects malformed and cross-project projections", () => {
  const p = project as ProjectID
  expect(() => decodeCallNeighbors("{}", p)).toThrow("Invalid native graph neighbors")
  expect(() =>
    decodeCallNeighbors(JSON.stringify([{ ...node("a", "wrong"), indexed_at: 0, completeness: null }]), p),
  ).toThrow("project boundary")
})

test.each(["caller", "shutdown"])(
  "reader %s cancellation drains underlying work before closing the store",
  async (mode) => {
    let fail!: (error: Error) => void
    const cancel = vi.fn(),
      close = vi.fn()
    const call = vi.fn(
      () =>
        new Promise<string>((_resolve, reject) => {
          fail = reject
        }),
    )
    class FakeStore {
      close = close
    }
    vi.spyOn(NativeAddon, "index").mockReturnValue({
      ...native,
      IndexStore: FakeStore,
      callNeighborsAsync: call,
      IndexCancellation: class {
        cancel = cancel
      },
    } as unknown as ReturnType<typeof NativeAddon.index>)
    const module = "../../src/code-intelligence/native-store.ts?reader-" + mode
    const { NativeStore } = (await import(module)) as typeof import("../../src/code-intelligence/native-store")
    const controller = new AbortController()
    const pending = NativeStore.callNeighborsAsync(
      project as ProjectID,
      CodeNodeID.make("root"),
      true,
      controller.signal,
    )
    const rejection = expect(pending).rejects.toThrow()
    let closed = false
    let closing: Promise<void> | undefined
    if (mode === "caller") controller.abort(new Error("caller stopped"))
    else
      closing = NativeStore.close().then(() => {
        closed = true
      })
    await Promise.resolve()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(closed).toBe(false)
    expect(close).not.toHaveBeenCalled()
    fail(new Error("native cancelled"))
    await rejection
    if (mode === "caller") await expect(pending).rejects.toBe(controller.signal.reason)
    await (closing ?? NativeStore.close())
    expect(close).toHaveBeenCalledTimes(1)
    await expect(NativeStore.callNeighborsAsync(project as ProjectID, CodeNodeID.make("root"), true)).rejects.toThrow(
      "closed",
    )
  },
)

test("cold native store creates its parent before the first graph write", async () => {
  await using tmp = await tmpdir({})
  const original = Global.Path.data
  Global.Path.data = path.join(tmp.path, "not-created", "nested")
  const insert = vi.fn(),
    close = vi.fn()
  class FakeStore {
    constructor(db: string) {
      expect(existsSync(path.dirname(db))).toBe(true)
    }
    insertNodes = insert
    close = close
  }
  vi.spyOn(NativeAddon, "index").mockReturnValue({ ...native, IndexStore: FakeStore } as unknown as ReturnType<
    typeof NativeAddon.index
  >)
  try {
    const module = "../../src/code-intelligence/native-store.ts?cold-parent"
    const { NativeStore } = (await import(module)) as typeof import("../../src/code-intelligence/native-store")
    NativeStore.insertNodes([node("cold")])
    expect(insert).toHaveBeenCalledTimes(1)
    await NativeStore.close()
  } finally {
    Global.Path.data = original
  }
})
