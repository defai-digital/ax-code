import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { CodeNodeID, CodeEdgeID, CodeFileID } from "../../src/code-intelligence/id"
import type { ProjectID } from "../../src/project/schema"

Log.init({ print: false })

// These tests exercise the low-level query layer directly with
// hand-constructed rows. No LSP, no filesystem walk — just the
// storage semantics. Phase 1's public API is a thin wrapper over
// these functions, so covering them here covers most of the API.

function now() {
  return Date.now()
}

function makeNode(overrides: Partial<Parameters<typeof CodeGraphQuery.insertNode>[0]>) {
  const t = now()
  return {
    id: CodeNodeID.ascending(),
    project_id: "proj_test" as ProjectID,
    kind: "function" as const,
    name: "default",
    qualified_name: "default",
    file: "/tmp/file.ts",
    range_start_line: 0,
    range_start_char: 0,
    range_end_line: 1,
    range_end_char: 0,
    signature: null,
    visibility: null,
    metadata: null,
    time_created: t,
    time_updated: t,
    ...overrides,
  }
}

function makeEdge(overrides: Partial<Parameters<typeof CodeGraphQuery.insertEdge>[0]>) {
  const t = now()
  return {
    id: CodeEdgeID.ascending(),
    project_id: "proj_test" as ProjectID,
    kind: "calls" as const,
    from_node: CodeNodeID.make("cnd_default"),
    to_node: CodeNodeID.make("cnd_default"),
    file: "/tmp/file.ts",
    range_start_line: 0,
    range_start_char: 0,
    range_end_line: 1,
    range_end_char: 0,
    time_created: t,
    time_updated: t,
    ...overrides,
  }
}

describe("CodeGraphQuery nodes", () => {
  test("insertNode and findNodesByName roundtrip", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        const n = makeNode({ project_id: projectID, name: "foo", qualified_name: "foo" })
        CodeGraphQuery.insertNode(n)

        const found = CodeGraphQuery.findNodesByName(projectID, "foo")
        expect(found.length).toBe(1)
        expect(found[0].name).toBe("foo")
        expect(found[0].kind).toBe("function")

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })

  test("findNodesByName filters by kind and file", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        CodeGraphQuery.insertNode(
          makeNode({ project_id: projectID, name: "bar", kind: "function", file: "/tmp/a.ts" }),
        )
        CodeGraphQuery.insertNode(
          makeNode({ project_id: projectID, name: "bar", kind: "class", file: "/tmp/b.ts" }),
        )

        const fns = CodeGraphQuery.findNodesByName(projectID, "bar", { kind: "function" })
        expect(fns.length).toBe(1)
        expect(fns[0].kind).toBe("function")

        const inA = CodeGraphQuery.findNodesByName(projectID, "bar", { file: "/tmp/a.ts" })
        expect(inA.length).toBe(1)
        expect(inA[0].file).toBe("/tmp/a.ts")

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })

  test("findNodesByNamePrefix returns name-prefixed matches", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        CodeGraphQuery.insertNode(makeNode({ project_id: projectID, name: "handleRequest" }))
        CodeGraphQuery.insertNode(makeNode({ project_id: projectID, name: "handleResponse" }))
        CodeGraphQuery.insertNode(makeNode({ project_id: projectID, name: "processPayment" }))

        const handles = CodeGraphQuery.findNodesByNamePrefix(projectID, "handle")
        expect(handles.length).toBe(2)
        expect(handles.map((n) => n.name).sort()).toEqual(["handleRequest", "handleResponse"])

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })

  test("findNodesByNamePrefix includes exact-match of the prefix itself", async () => {
    // Regression guard for the range-based prefix implementation:
    // WHERE name >= 'handle' AND name < 'handle\uFFFF' must include
    // a symbol literally named "handle" (equal to the lower bound).
    // If the range were (prefix, upper) instead of [prefix, upper),
    // this case would silently drop.
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        CodeGraphQuery.insertNode(makeNode({ project_id: projectID, name: "handle" }))
        CodeGraphQuery.insertNode(makeNode({ project_id: projectID, name: "handleRequest" }))

        const matches = CodeGraphQuery.findNodesByNamePrefix(projectID, "handle")
        expect(matches.length).toBe(2)
        expect(matches.map((n) => n.name).sort()).toEqual(["handle", "handleRequest"])

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })

  test("findNodesByNamePrefix rejects names outside the prefix range", async () => {
    // The upper bound is `prefix + "\uFFFF"`. Make sure a name that
    // sorts after the upper bound is excluded — e.g. "handleX" should
    // still match (< handle\uFFFF) but "handlez\uFFFF\uFFFF" would not.
    // More importantly: names starting with characters alphabetically
    // after the prefix's last character must be excluded.
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        CodeGraphQuery.insertNode(makeNode({ project_id: projectID, name: "handle" }))
        CodeGraphQuery.insertNode(makeNode({ project_id: projectID, name: "handleFoo" }))
        CodeGraphQuery.insertNode(makeNode({ project_id: projectID, name: "hanger" })) // after "handle" alphabetically
        CodeGraphQuery.insertNode(makeNode({ project_id: projectID, name: "hand" })) // before "handle"

        const matches = CodeGraphQuery.findNodesByNamePrefix(projectID, "handle")
        const names = matches.map((n) => n.name).sort()
        expect(names).toEqual(["handle", "handleFoo"])

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })

  test("analyze() does not throw on empty or populated graphs", async () => {
    // ANALYZE is cheap and its effect is purely statistical — there's
    // no state to assert on directly. The test just guards against
    // the SQL being malformed or the function name being wrong,
    // both of which would be silent regressions otherwise.
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        // Empty graph
        CodeGraphQuery.analyze()

        // Populated graph
        CodeGraphQuery.insertNode(makeNode({ project_id: projectID, name: "x" }))
        CodeGraphQuery.insertNode(makeNode({ project_id: projectID, name: "y" }))
        CodeGraphQuery.analyze()

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })

  test("nodesInFile returns only the requested file", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        CodeGraphQuery.insertNodes([
          makeNode({ project_id: projectID, name: "a", file: "/tmp/x.ts" }),
          makeNode({ project_id: projectID, name: "b", file: "/tmp/x.ts" }),
          makeNode({ project_id: projectID, name: "c", file: "/tmp/y.ts" }),
        ])

        const xs = CodeGraphQuery.nodesInFile(projectID, "/tmp/x.ts")
        expect(xs.length).toBe(2)
        expect(xs.map((n) => n.name).sort()).toEqual(["a", "b"])

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })

  test("deleteNodesInFile removes only nodes in the given file", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        CodeGraphQuery.insertNodes([
          makeNode({ project_id: projectID, name: "a", file: "/tmp/doomed.ts" }),
          makeNode({ project_id: projectID, name: "b", file: "/tmp/safe.ts" }),
        ])
        expect(CodeGraphQuery.countNodes(projectID)).toBe(2)

        CodeGraphQuery.deleteNodesInFile(projectID, "/tmp/doomed.ts")
        expect(CodeGraphQuery.countNodes(projectID)).toBe(1)

        const remaining = CodeGraphQuery.nodesInFile(projectID, "/tmp/safe.ts")
        expect(remaining[0].name).toBe("b")

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })
})

describe("CodeGraphQuery edges", () => {
  test("edgesFrom and edgesTo roundtrip with kind filter", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        const caller = makeNode({ project_id: projectID, name: "caller" })
        const callee = makeNode({ project_id: projectID, name: "callee" })
        const other = makeNode({ project_id: projectID, name: "other" })
        CodeGraphQuery.insertNodes([caller, callee, other])

        CodeGraphQuery.insertEdge(
          makeEdge({
            project_id: projectID,
            kind: "calls",
            from_node: caller.id,
            to_node: callee.id,
          }),
        )
        CodeGraphQuery.insertEdge(
          makeEdge({
            project_id: projectID,
            kind: "references",
            from_node: caller.id,
            to_node: other.id,
          }),
        )

        const callsFromCaller = CodeGraphQuery.edgesFrom(projectID, caller.id, "calls")
        expect(callsFromCaller.length).toBe(1)
        expect(callsFromCaller[0].to_node).toBe(callee.id)

        const allFromCaller = CodeGraphQuery.edgesFrom(projectID, caller.id)
        expect(allFromCaller.length).toBe(2)

        const callsToCallee = CodeGraphQuery.edgesTo(projectID, callee.id, "calls")
        expect(callsToCallee.length).toBe(1)
        expect(callsToCallee[0].from_node).toBe(caller.id)

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })

  test("deleteEdgesTouchingFile removes edges whose endpoints are in the file", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        const inFile = makeNode({ project_id: projectID, name: "inside", file: "/tmp/target.ts" })
        const outsideFile = makeNode({ project_id: projectID, name: "outside", file: "/tmp/other.ts" })
        CodeGraphQuery.insertNodes([inFile, outsideFile])

        CodeGraphQuery.insertEdge(
          makeEdge({
            project_id: projectID,
            from_node: inFile.id,
            to_node: outsideFile.id,
            file: "/tmp/target.ts",
          }),
        )
        CodeGraphQuery.insertEdge(
          makeEdge({
            project_id: projectID,
            from_node: outsideFile.id,
            to_node: inFile.id,
            file: "/tmp/other.ts",
          }),
        )
        expect(CodeGraphQuery.countEdges(projectID)).toBe(2)

        CodeGraphQuery.deleteEdgesTouchingFile(projectID, "/tmp/target.ts")
        // Both edges touch inFile, so both should be gone.
        expect(CodeGraphQuery.countEdges(projectID)).toBe(0)

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })
})

describe("CodeGraphQuery file state", () => {
  test("upsertFile inserts on first call and updates on second", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        const fileId = CodeFileID.ascending()
        const t1 = now()

        CodeGraphQuery.upsertFile({
          id: fileId,
          project_id: projectID,
          path: "/tmp/x.ts",
          sha: "hash1",
          size: 100,
          lang: "typescript",
          indexed_at: t1,
          completeness: "lsp-only",
          time_created: t1,
          time_updated: t1,
        })

        let row = CodeGraphQuery.getFile(projectID, "/tmp/x.ts")
        expect(row?.sha).toBe("hash1")
        expect(row?.size).toBe(100)

        const t2 = t1 + 1000
        CodeGraphQuery.upsertFile({
          id: fileId,
          project_id: projectID,
          path: "/tmp/x.ts",
          sha: "hash2",
          size: 200,
          lang: "typescript",
          indexed_at: t2,
          completeness: "lsp-only",
          time_created: t1,
          time_updated: t2,
        })

        row = CodeGraphQuery.getFile(projectID, "/tmp/x.ts")
        expect(row?.sha).toBe("hash2")
        expect(row?.size).toBe(200)
        expect(row?.indexed_at).toBe(t2)

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })
})

describe("CodeGraphQuery cursor", () => {
  test("upsertCursor tracks commit and counts", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        CodeGraphQuery.upsertCursor(projectID, "abc123", 10, 20)
        let c = CodeGraphQuery.getCursor(projectID)
        expect(c?.commit_sha).toBe("abc123")
        expect(c?.node_count).toBe(10)
        expect(c?.edge_count).toBe(20)

        CodeGraphQuery.upsertCursor(projectID, "def456", 15, 30)
        c = CodeGraphQuery.getCursor(projectID)
        expect(c?.commit_sha).toBe("def456")
        expect(c?.node_count).toBe(15)
        expect(c?.edge_count).toBe(30)

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })
})

describe("CodeGraphQuery regression fixes", () => {
  test("getNode filters by project_id at the SQL layer", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })

    // Seed a node in project A, remember its id.
    const { projectA, nodeFromA } = await Instance.provide({
      directory: tmpA.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)
        const id = CodeNodeID.ascending()
        CodeGraphQuery.insertNode(
          makeNode({ id, project_id: projectID, name: "secret" }),
        )
        return { projectA: projectID, nodeFromA: id }
      },
    })

    // Ask for the same node id under project B. Because getNode now
    // filters by project_id in SQL, we must get undefined back even if
    // the row still exists in another project.
    await Instance.provide({
      directory: tmpB.path,
      fn: async () => {
        const projectB = Instance.project.id
        CodeGraphQuery.clearProject(projectB)
        const leaked = CodeGraphQuery.getNode(projectB, nodeFromA)
        expect(leaked).toBeUndefined()

        // Same id under the correct project still works.
        const found = CodeGraphQuery.getNode(projectA, nodeFromA)
        expect(found).toBeDefined()
        expect(found?.name).toBe("secret")

        CodeGraphQuery.clearProject(projectA)
        CodeGraphQuery.clearProject(projectB)
      },
    })
  })

  test("deleteEdgesTouchingFile handles files with many nodes (SQLite IN-clause chunking)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        // Seed more nodes than SQLite's IN-clause parameter limit (999).
        // The old implementation crashed at ~999; the new chunked
        // version should complete without error.
        const COUNT = 1500
        const nodes = Array.from({ length: COUNT }, (_, i) =>
          makeNode({ project_id: projectID, name: `n${i}`, file: "/tmp/big.ts" }),
        )
        // Insert in chunks of 50 to match builder's internal batching.
        for (let i = 0; i < nodes.length; i += 50) {
          CodeGraphQuery.insertNodes(nodes.slice(i, i + 50))
        }
        expect(CodeGraphQuery.countNodes(projectID)).toBe(COUNT)

        // Add a few edges so deleteEdgesTouchingFile has work to do.
        for (let i = 0; i < 5; i++) {
          CodeGraphQuery.insertEdge(
            makeEdge({
              project_id: projectID,
              from_node: nodes[i].id,
              to_node: nodes[i + 1].id,
              file: "/tmp/big.ts",
            }),
          )
        }
        expect(CodeGraphQuery.countEdges(projectID)).toBe(5)

        // This was the failing call before chunking.
        CodeGraphQuery.deleteEdgesTouchingFile(projectID, "/tmp/big.ts")
        expect(CodeGraphQuery.countEdges(projectID)).toBe(0)

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })
})

describe("CodeGraphQuery.pruneOrphanFiles", () => {
  // Helper: seed a file row + one node + zero or one outgoing edge.
  // Returns the node id so cross-file edge tests can wire up a
  // from/to pair.
  function seed(projectID: ProjectID, p: string, sha = "seed") {
    const t = now()
    const nodeId = CodeNodeID.ascending()
    CodeGraphQuery.insertNode(makeNode({ id: nodeId, project_id: projectID, name: `sym_${p}`, file: p }))
    CodeGraphQuery.upsertFile({
      id: CodeFileID.ascending(),
      project_id: projectID,
      path: p,
      sha,
      size: 10,
      lang: "typescript",
      indexed_at: t,
      completeness: "full",
      time_created: t,
      time_updated: t,
    })
    return nodeId
  }

  test("removes files whose path is not in livePaths", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        seed(projectID, "/tmp/x/a.ts")
        seed(projectID, "/tmp/x/b.ts")
        seed(projectID, "/tmp/x/c.ts")
        expect(CodeGraphQuery.listFiles(projectID).length).toBe(3)
        expect(CodeGraphQuery.countNodes(projectID)).toBe(3)

        const result = CodeGraphQuery.pruneOrphanFiles(projectID, new Set(["/tmp/x/a.ts"]), "/tmp/x")
        expect(result.files).toBe(2)
        expect(result.nodes).toBe(2)
        expect(result.edges).toBe(0)

        const remaining = CodeGraphQuery.listFiles(projectID)
        expect(remaining.length).toBe(1)
        expect(remaining[0].path).toBe("/tmp/x/a.ts")
        expect(CodeGraphQuery.countNodes(projectID)).toBe(1)

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })

  test("scopePrefix protects sibling worktrees from being purged", async () => {
    // The killer case: two worktrees of the same repo share a
    // project id. Running `ax-code index` in worktree A walks only
    // A's files. Without a scope prefix, the prune would delete
    // every row for worktree B's paths. With the prefix, those
    // rows are untouched.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        seed(projectID, "/Users/u/proj1/a.ts")
        seed(projectID, "/Users/u/proj2/b.ts")

        // Walking proj1 only; live set has just proj1's file. Scope
        // is "/Users/u/proj1", so proj2's row is out of scope and
        // must survive.
        const result = CodeGraphQuery.pruneOrphanFiles(
          projectID,
          new Set(["/Users/u/proj1/a.ts"]),
          "/Users/u/proj1",
        )
        expect(result.files).toBe(0)

        const remaining = CodeGraphQuery.listFiles(projectID).map((f) => f.path).sort()
        expect(remaining).toEqual(["/Users/u/proj1/a.ts", "/Users/u/proj2/b.ts"])

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })

  test("is a no-op when every known file is live", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        seed(projectID, "/tmp/y/a.ts")
        seed(projectID, "/tmp/y/b.ts")
        const before = CodeGraphQuery.countNodes(projectID)

        const result = CodeGraphQuery.pruneOrphanFiles(
          projectID,
          new Set(["/tmp/y/a.ts", "/tmp/y/b.ts"]),
          "/tmp/y",
        )
        expect(result).toEqual({ files: 0, nodes: 0, edges: 0 })
        expect(CodeGraphQuery.countNodes(projectID)).toBe(before)

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })

  test("cleans up cross-file edges that touch a purged file's nodes", async () => {
    // Edge from A's node to B's node. Pruning B must remove the
    // edge too — leaving it would make `findCallers`-style queries
    // return dangling edge ids that can't resolve to a to-node.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        const a = seed(projectID, "/tmp/z/a.ts")
        const b = seed(projectID, "/tmp/z/b.ts")
        CodeGraphQuery.insertEdge(
          makeEdge({ project_id: projectID, from_node: a, to_node: b, file: "/tmp/z/a.ts" }),
        )
        expect(CodeGraphQuery.countEdges(projectID)).toBe(1)

        const result = CodeGraphQuery.pruneOrphanFiles(projectID, new Set(["/tmp/z/a.ts"]), "/tmp/z")
        expect(result.files).toBe(1)
        expect(result.edges).toBe(1)
        expect(CodeGraphQuery.countEdges(projectID)).toBe(0)
        // A's node remains; B's is gone.
        expect(CodeGraphQuery.countNodes(projectID)).toBe(1)

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })
})

describe("CodeGraphQuery project isolation", () => {
  test("queries do not leak between projects", async () => {
    // Two separate git repos give us two distinct project IDs that
    // both exist in the `project` table, satisfying the foreign key
    // constraint on code_node.project_id. Without {git: true}, both
    // tmpdirs collapse to the same "global" project.
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })

    const projectA = await Instance.provide({
      directory: tmpA.path,
      fn: async () => {
        const id = Instance.project.id
        CodeGraphQuery.clearProject(id)
        CodeGraphQuery.insertNode(makeNode({ project_id: id, name: "shared" }))
        return id
      },
    })

    const projectB = await Instance.provide({
      directory: tmpB.path,
      fn: async () => {
        const id = Instance.project.id
        CodeGraphQuery.clearProject(id)
        CodeGraphQuery.insertNode(makeNode({ project_id: id, name: "shared" }))
        return id
      },
    })

    await Instance.provide({
      directory: tmpA.path,
      fn: async () => {
        const fromA = CodeGraphQuery.findNodesByName(projectA, "shared")
        const fromB = CodeGraphQuery.findNodesByName(projectB, "shared")
        expect(fromA.length).toBe(1)
        expect(fromB.length).toBe(1)
        expect(fromA[0].project_id).toBe(projectA)
        expect(fromB[0].project_id).toBe(projectB)
        expect(projectA).not.toBe(projectB)
        CodeGraphQuery.clearProject(projectA)
        CodeGraphQuery.clearProject(projectB)
      },
    })
  })
})
