import { describe, expect, test, vi } from "vitest"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "../fixture/fixture"
import { NativeAddon } from "../../src/native/addon"
import type { ProjectID } from "../../src/project/schema"

const originalFlag = process.env.AX_CODE_NATIVE_INDEX
process.env.AX_CODE_NATIVE_INDEX = "1"
const binding = NativeAddon.index()
if (originalFlag === undefined) delete process.env.AX_CODE_NATIVE_INDEX
else process.env.AX_CODE_NATIVE_INDEX = originalFlag
const enabled = !!binding?.ingestFileAsync && !!binding.IndexCancellation
const project = "worker-project"
function data(name = "new", count = 2) {
  const nodes = Array.from({ length: count }, (_, n) => ({
    id: `${name}-${n}`,
    project_id: project,
    kind: "function",
    name: `${name}${n}`,
    qualified_name: `${name}${n}`,
    file: "/a.ts",
    range_start_line: n,
    range_start_char: 0,
    range_end_line: n,
    range_end_char: 5,
  }))
  const edges = [
    {
      id: `${name}-edge`,
      project_id: project,
      kind: "calls",
      from_node: nodes[0].id,
      to_node: nodes[1].id,
      file: "/a.ts",
      range_start_line: 0,
      range_start_char: 0,
      range_end_line: 0,
      range_end_char: 5,
    },
  ]
  const meta = {
    id: "file-a",
    project_id: project,
    path: "/a.ts",
    sha: name,
    size: 100,
    lang: "typescript",
    completeness: "full",
  }
  return { nodes, edges, meta }
}

describe.skipIf(!enabled)("native graph worker", () => {
  test("atomic replacement removes incoming edges and preserves unrelated rows", async () => {
    await using tmp = await tmpdir({})
    const dbPath = path.join(tmp.path, "graph.db")
    const store = new binding!.IndexStore(dbPath)
    try {
      const old = data("old")
      store.ingestFile(project, "/a.ts", JSON.stringify(old.nodes), JSON.stringify(old.edges), JSON.stringify(old.meta))
      store.insertNodes(JSON.stringify([{ ...old.nodes[0], id: "other", file: "/b.ts" }]))
      store.insertEdges(
        JSON.stringify([
          { ...old.edges[0], id: "incoming", from_node: "other", to_node: old.nodes[0].id, file: "/b.ts" },
        ]),
      )
      const next = data()
      await binding!.ingestFileAsync!(
        dbPath,
        project,
        "/a.ts",
        JSON.stringify(next.nodes),
        JSON.stringify(next.edges),
        JSON.stringify(next.meta),
        new binding!.IndexCancellation!(),
      )
      expect(store.countNodes(project)).toBe(3)
      expect(store.countEdges(project)).toBe(1)
      expect(store.getNode(project, "other")).toBeTruthy()
      expect(store.getNode(project, "old-0")).toBeNull()
      expect(store.getFile(project, "/a.ts")).toContain('"sha":"new"')
      await binding!.optimizeIndexAsync!(dbPath, new binding!.IndexCancellation!())
      store.refreshPlannerStatistics()
      expect(store.edgesTo(project, "new-1", null)).toContain("new-edge")
    } finally {
      store.close()
    }
  })

  test("bounded optimize retains selective inbound, outbound and file query plans", async () => {
    await using tmp = await tmpdir({})
    const dbPath = path.join(tmp.path, "graph.db")
    const store = new binding!.IndexStore(dbPath)
    try {
      const fixture = data("plan", 1000)
      store.insertNodes(JSON.stringify(fixture.nodes.map((node, i) => ({ ...node, file: `/file-${i % 100}.ts` }))))
      store.insertEdges(
        JSON.stringify(
          Array.from({ length: 20_000 }, (_, i) => ({
            ...fixture.edges[0],
            id: `edge-${i}`,
            from_node: `plan-${i % 1000}`,
            to_node: `plan-${(i + 1) % 1000}`,
            kind: ["calls", "imports", "references"][i % 3],
            file: `/file-${i % 100}.ts`,
          })),
        ),
      )
      await binding!.optimizeIndexAsync!(dbPath, new binding!.IndexCancellation!())
      store.refreshPlannerStatistics()
      const db = new DatabaseSync(dbPath)
      try {
        const inbound = db
          .prepare("EXPLAIN QUERY PLAN SELECT * FROM code_edge WHERE project_id = ? AND to_node = ? AND kind = ?")
          .all(project, "plan-5", "calls")
        const outbound = db
          .prepare("EXPLAIN QUERY PLAN SELECT * FROM code_edge WHERE project_id = ? AND from_node = ? AND kind = ?")
          .all(project, "plan-5", "calls")
        const file = db
          .prepare("EXPLAIN QUERY PLAN SELECT * FROM code_node WHERE project_id = ? AND file = ?")
          .all(project, "/file-5.ts")
        expect(JSON.stringify(inbound)).toContain("code_edge_to_idx")
        expect(JSON.stringify(outbound)).toContain("code_edge_from_idx")
        expect(JSON.stringify(file)).toMatch(/code_node_project_file_idx/)
      } finally {
        db.close()
      }
    } finally {
      store.close()
    }
  })

  test("host ingestion round-trips structured syntactic metadata", async () => {
    const spy = vi.spyOn(NativeAddon, "index").mockReturnValue(binding)
    const module = "../../src/code-intelligence/native-store.ts?index-worker-metadata"
    const { NativeStore } = (await import(module)) as typeof import("../../src/code-intelligence/native-store")
    try {
      const fixture = data()
      const nodes = fixture.nodes.map((node) => ({
        ...node,
        metadata: { source: "tree-sitter", precision: "syntactic" },
      }))
      await NativeStore.ingestFileAsync(project as ProjectID, "/a.ts", nodes, fixture.edges, fixture.meta)
      expect(NativeStore.nodesInFile(project as ProjectID, "/a.ts")[0].metadata).toEqual(nodes[0].metadata)
    } finally {
      NativeStore.clearProject(project as ProjectID)
      await NativeStore.close()
      spy.mockRestore()
    }
  })

  test("a competing WAL writer does not block JS reads or drop admitted ingestion", async () => {
    await using tmp = await tmpdir({})
    const dbPath = path.join(tmp.path, "graph.db")
    const store = new binding!.IndexStore(dbPath)
    const db = new DatabaseSync(dbPath)
    try {
      const old = data("old")
      store.ingestFile(project, "/a.ts", JSON.stringify(old.nodes), JSON.stringify(old.edges), JSON.stringify(old.meta))
      db.exec("BEGIN IMMEDIATE")
      const next = data()
      const pending = binding!.ingestFileAsync!(
        dbPath,
        project,
        "/a.ts",
        JSON.stringify(next.nodes),
        JSON.stringify(next.edges),
        JSON.stringify(next.meta),
        new binding!.IndexCancellation!(),
      )
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
      expect(store.countNodes(project)).toBe(2)
      db.exec("ROLLBACK")
      await pending
      expect(store.getNode(project, "new-0")).toBeTruthy()
    } finally {
      db.close()
      store.close()
    }
  })

  test("invalid scope, SQL errors and pre-cancellation leave the old graph intact", async () => {
    await using tmp = await tmpdir({})
    const dbPath = path.join(tmp.path, "graph.db")
    const store = new binding!.IndexStore(dbPath)
    try {
      const old = data("old")
      store.ingestFile(project, "/a.ts", JSON.stringify(old.nodes), JSON.stringify(old.edges), JSON.stringify(old.meta))
      for (const variant of ["scope", "duplicate", "cancel"]) {
        const next = data()
        if (variant === "scope") next.nodes[1].project_id = "wrong"
        if (variant === "duplicate") next.nodes[1].id = next.nodes[0].id
        const cancel = new binding!.IndexCancellation!()
        if (variant === "cancel") cancel.cancel()
        await expect(
          binding!.ingestFileAsync!(
            dbPath,
            project,
            "/a.ts",
            JSON.stringify(next.nodes),
            JSON.stringify(next.edges),
            JSON.stringify(next.meta),
            cancel,
          ),
        ).rejects.toThrow()
        expect(store.countNodes(project)).toBe(2)
        expect(store.countEdges(project)).toBe(1)
        expect(store.getNode(project, "old-0")).toBeTruthy()
        expect(store.getFile(project, "/a.ts")).toContain('"sha":"old"')
      }
    } finally {
      store.close()
    }
  })

  test("WAL reads and event-loop callbacks run during large ingestion; cancellation rolls back", async () => {
    await using tmp = await tmpdir({})
    const dbPath = path.join(tmp.path, "graph.db")
    const store = new binding!.IndexStore(dbPath)
    try {
      const old = data("old")
      store.ingestFile(project, "/a.ts", JSON.stringify(old.nodes), JSON.stringify(old.edges), JSON.stringify(old.meta))
      const next = data("large", 30_000)
      const cancel = new binding!.IndexCancellation!()
      const promise = binding!.ingestFileAsync!(
        dbPath,
        project,
        "/a.ts",
        JSON.stringify(next.nodes),
        JSON.stringify(next.edges),
        JSON.stringify(next.meta),
        cancel,
      )
      await new Promise<void>((resolve) => setTimeout(resolve, 1))
      expect(store.countNodes(project)).toBe(2)
      cancel.cancel()
      await expect(promise).rejects.toThrow()
      expect(store.countNodes(project)).toBe(2)
      expect(store.getNode(project, "old-0")).toBeTruthy()
    } finally {
      store.close()
    }
  })
})

test("NativeStore.close drains active work and cancels queued work before closing the primary connection", async () => {
  const events: string[] = []
  let finish!: () => void
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  class TestStore {
    close() {
      events.push("close")
    }
  }
  class Cancellation {
    cancel() {
      events.push("cancel")
    }
  }
  const ingest = vi.fn(async () => {
    started()
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    events.push("finished")
  })
  const spy = vi.spyOn(NativeAddon, "index").mockReturnValue({
    IndexStore: TestStore,
    IndexCancellation: Cancellation,
    ingestFileAsync: ingest,
  } as unknown as ReturnType<typeof NativeAddon.index>)
  try {
    const module = "../../src/code-intelligence/native-store.ts?index-worker-lifecycle"
    const { NativeStore } = (await import(module)) as typeof import("../../src/code-intelligence/native-store")
    const first = NativeStore.ingestFileAsync(project as ProjectID, "/a.ts", [], [], {})
    const queued = NativeStore.ingestFileAsync(project as ProjectID, "/b.ts", [], [], {})
    const settled = Promise.allSettled([first, queued])
    await ready
    const closing = NativeStore.close()
    expect(events).toEqual(["cancel"])
    finish()
    await closing
    await settled
    expect(ingest).toHaveBeenCalledTimes(1)
    expect(events).toEqual(["cancel", "finished", "close"])
    await expect(NativeStore.ingestFileAsync(project as ProjectID, "/c.ts", [], [], {})).rejects.toThrow("closed")
    await NativeStore.close()
    expect(events.filter((e) => e === "close")).toHaveLength(1)
  } finally {
    spy.mockRestore()
  }
})
