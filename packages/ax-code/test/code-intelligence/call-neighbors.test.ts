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

  test("walkCallGraph reproduces the per-node loop: order, parents, scope, budget and depth", async () => {
    await using tmp = await tmpdir({})
    const store = new native!.IndexStore(path.join(tmp.path, "graph.db"))
    try {
      store.insertNodes(
        JSON.stringify([
          node("s", project, "/in/s.ts"),
          node("a", project, "/in/a.ts"),
          node("b", project, "/in/b.ts"),
          node("d", project, "/in/d.ts"),
          node("x", project, "/outside/x.ts"),
          node("y", project, "/in/y.ts"),
          node("foreign", "other", "/in/f.ts"),
        ]),
      )
      store.insertEdges(
        JSON.stringify([
          edge("e1", "a", "s"),
          edge("e2", "x", "s"),
          edge("e3", "b", "a"),
          edge("e4", "d", "a"),
          edge("e5", "a", "d"),
          edge("e6", "y", "x"),
          edge("e7", "a", "s"),
          edge("e8", "missing", "s"),
          edge("e9", "foreign", "s"),
        ]),
      )
      type Visit = { id: string; distance: number; parent: string }
      // The host loop, including its scope filter, written against callNeighbors.
      const loop = (seeds: string[], depth: number, budget: number, roots?: string[]) => {
        const inScope = (file: string) => !roots || roots.some((root) => file === root || file.startsWith(root + "/"))
        const visited = new Set(seeds)
        const queue = seeds.map((id) => ({ id, distance: 0 }))
        const nodes: Visit[] = []
        let truncated = false
        let head = 0
        walk: while (head < queue.length) {
          const { id, distance } = queue[head++]
          if (distance >= depth) continue
          for (const row of JSON.parse(store.callNeighbors(project, id, true)) as { id: string; file: string }[]) {
            if (!inScope(row.file) || visited.has(row.id)) continue
            visited.add(row.id)
            nodes.push({ id: row.id, distance: distance + 1, parent: id })
            if (visited.size >= budget) {
              truncated = true
              break walk
            }
            queue.push({ id: row.id, distance: distance + 1 })
          }
        }
        return { nodes, truncated }
      }
      const walk = (seeds: string[], depth: number, budget: number, roots?: string[]) => {
        const result = JSON.parse(store.walkCallGraph(project, JSON.stringify({ seeds, depth, budget, roots }))) as {
          nodes: Array<Visit & Record<string, unknown>>
          truncated: boolean
        }
        return {
          nodes: result.nodes.map(({ id, distance, parent }) => ({ id, distance, parent })),
          truncated: result.truncated,
        }
      }
      const cases: Array<[string[], number, number, string[] | undefined]> = [
        [["s"], 6, 100, undefined],
        [["s"], 6, 100, ["/in"]],
        [["s"], 6, 3, undefined],
        [["s"], 1, 100, undefined],
        [["y", "s"], 2, 100, undefined],
        [["missing"], 6, 100, undefined],
      ]
      for (const [seeds, depth, budget, roots] of cases) {
        expect(walk(seeds, depth, budget, roots)).toEqual(loop(seeds, depth, budget, roots))
        expect(
          await native!.walkCallGraphAsync!(
            path.join(tmp.path, "graph.db"),
            project,
            JSON.stringify({ seeds, depth, budget, roots }),
            new native!.IndexCancellation!(),
          ),
        ).toBe(store.walkCallGraph(project, JSON.stringify({ seeds, depth, budget, roots })))
      }
      expect(walk(["s"], 6, 100).nodes.map((n) => n.id)).toEqual(["a", "x", "b", "d", "y"])
      expect(walk(["s"], 6, 100, ["/in"]).nodes.map((n) => n.id)).toEqual(["a", "b", "d"])
      expect(walk(["s"], 6, 3)).toMatchObject({ truncated: true })
      // Each node carries the single query's projection columns plus its visit.
      const [first] = JSON.parse(
        store.walkCallGraph(project, JSON.stringify({ seeds: ["s"], depth: 1, budget: 9 })),
      ).nodes
      expect(first).toEqual({ ...JSON.parse(store.callNeighbors(project, "s", true))[0], distance: 1, parent: "s" })
      expect(() => store.walkCallGraph(project, JSON.stringify({ seeds: ["s"], depth: 65, budget: 9 }))).toThrow(
        "Graph query input limit exceeded",
      )
    } finally {
      store.close()
    }
  })

  test("an admitted walk lets JS read the synchronous connection and cancel the worker", async () => {
    await using tmp = await tmpdir({})
    const dbPath = path.join(tmp.path, "walk.db")
    const store = new native!.IndexStore(dbPath)
    const db = new DatabaseSync(dbPath)
    try {
      db.exec(`WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<5999)
        INSERT INTO code_node(id,project_id,kind,name,qualified_name,file,range_start_line,range_start_char,range_end_line,range_end_char)
        SELECT 'n'||i,'neighbors-project','function','n'||i,'n'||i,'/a.ts',0,0,1,0 FROM n`)
      // Use the same project constant as the wrapper fixture.
      db.prepare("UPDATE code_node SET project_id=?").run(project)
      db.exec(`WITH RECURSIVE e(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM e WHERE i<239999)
        INSERT INTO code_edge(id,project_id,kind,from_node,to_node,file)
        SELECT 'e'||i,(SELECT project_id FROM code_node LIMIT 1),'calls','n'||((i/40*7+i%40+1)%6000),'n'||(i/40),'/a.ts' FROM e`)
      store.analyze()
      const token = new native!.IndexCancellation!()
      const pending = native!.walkCallGraphAsync!(
        dbPath,
        project,
        JSON.stringify({ seeds: ["n0"], depth: 6, budget: 10000 }),
        token,
      )
      const rejection = expect(pending).rejects.toThrow("cancelled")
      await new Promise<void>((resolve) => setTimeout(resolve, 1))
      expect(store.countNodes(project)).toBe(6000)
      token.cancel()
      await rejection
      expect(store.countEdges(project)).toBe(240000)
    } finally {
      db.close()
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
      const walk = () =>
        native!.walkCallGraphAsync!(
          dbPath,
          project,
          JSON.stringify({ seeds: ["root"], depth: 6, budget: 100 }),
          new native!.IndexCancellation!(),
        )
      expect(JSON.parse(await walk()).nodes[0].name).toBe("a")
      writer.exec("COMMIT")
      expect(JSON.parse(await read())[0].name).toBe("uncommitted")
      expect(JSON.parse(await walk()).nodes[0].name).toBe("uncommitted")
      const missing = path.join(tmp.path, "absent.db")
      await expect(
        native!.callNeighborsAsync!(missing, project, "root", true, new native!.IndexCancellation!()),
      ).rejects.toThrow()
      await expect(
        native!.walkCallGraphAsync!(
          missing,
          project,
          JSON.stringify({ seeds: [], depth: 6, budget: 100 }),
          new native!.IndexCancellation!(),
        ),
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
      await expect(
        native!.walkCallGraphAsync!(
          dbPath,
          project,
          JSON.stringify({ seeds: ["root"], depth: 6, budget: 100 }),
          new native!.IndexCancellation!(),
          0,
        ),
      ).rejects.toThrow("deadline")
      await expect(
        native!.walkCallGraphAsync!(dbPath, project, JSON.stringify({ seeds: ["root"], depth: 6, budget: 100 }), token),
      ).rejects.toThrow("cancelled")
      await expect(
        native!.walkCallGraphAsync!(dbPath, project, "x".repeat(2 * 1024 * 1024 + 1), new native!.IndexCancellation!()),
      ).rejects.toThrow("input limit")
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

test("walkCallers keeps the host scope rule, one query id per anchor, and hands back to the loop", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const p = Instance.project.id
      const seed = CodeNodeID.ascending(),
        inside = CodeNodeID.ascending(),
        deeper = CodeNodeID.ascending(),
        outside = CodeNodeID.ascending()
      const visit = (id: CodeNodeID, file: string, parent: CodeNodeID, distance: number) => ({
        ...node(id, p, file),
        project_id: p,
        id,
        indexed_at: 12,
        completeness: "full",
        parent,
        distance,
      })
      const walk = vi.spyOn(CodeGraphQuery, "walkCallGraph").mockReturnValue({
        nodes: [
          visit(inside, path.join(tmp.path, "a.ts"), seed, 1),
          visit(deeper, path.join(tmp.path, "b.ts"), inside, 2),
        ],
        truncated: true,
      })
      const opts = { scope: "worktree" as const, depth: 6, budget: 10 }
      const result = CodeIntelligence.walkCallers(p, [seed], opts)
      expect(walk).toHaveBeenCalledWith(p, {
        seeds: [seed],
        callers: true,
        depth: 6,
        budget: 10,
        roots: [path.resolve(tmp.path)],
      })
      expect(result?.truncated).toBe(true)
      expect(result?.nodes.map((n) => [n.symbol.id, n.distance, n.parent])).toEqual([
        [inside, 1, seed],
        [deeper, 2, inside],
      ])
      expect(result?.nodes[0].symbol.explain).toMatchObject({
        source: "code-graph",
        indexedAt: 12,
        completeness: "full",
      })
      expect(result?.nodes[0].symbol.explain.queryId).not.toBe(result?.nodes[1].symbol.explain.queryId)

      // A node the host rule rejects means the native filter disagreed: use the loop.
      walk.mockReturnValue({
        nodes: [visit(outside, path.resolve(tmp.path, "../outside.ts"), seed, 1)],
        truncated: false,
      })
      expect(CodeIntelligence.walkCallers(p, [seed], opts)).toBeUndefined()
      expect(
        CodeIntelligence.walkCallers(p, [seed], { ...opts, scope: "none" })?.nodes.map((n) => n.symbol.id),
      ).toEqual([outside])
      expect(walk).toHaveBeenLastCalledWith(p, expect.objectContaining({ roots: undefined }))
      walk.mockReturnValue(undefined)
      expect(CodeIntelligence.walkCallers(p, [seed], opts)).toBeUndefined()
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
