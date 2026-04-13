import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { LSP } from "../../src/lsp"
import { Log } from "../../src/util/log"

Log.init({ print: false })

// Semantic Trust v2 §S4: code-graph results are wrapped in an envelope
// stamped with graph provenance. Tests exercise graphEnvelope() against
// a live cursor row — no LSP, no builder needed, just the query layer.

describe("CodeIntelligence.graphEnvelope", () => {
  test("returns degraded=true when no cursor exists for the project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        // Fresh project — no cursor row has been written yet.
        const env = CodeIntelligence.graphEnvelope(projectID, ["sym"])
        expect(env.source).toBe("graph")
        expect(env.degraded).toBe(true)
        // Timestamp defaults to Date.now() when cursor missing.
        expect(env.timestamp).toBeLessThanOrEqual(Date.now())
        expect(env.serverIDs).toEqual([])
      },
    })
  })

  test("stamps timestamp from cursor.time_updated when cursor exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.upsertCursor(projectID, "abc123", 100, 500)
        const cursor = CodeGraphQuery.getCursor(projectID)
        expect(cursor).toBeDefined()

        const env = CodeIntelligence.graphEnvelope(projectID, ["sym"])
        expect(env.source).toBe("graph")
        expect(env.degraded).toBe(false)
        expect(env.timestamp).toBe(cursor!.time_updated)
      },
    })
  })

  test("completeness is empty when payload is empty array", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.upsertCursor(projectID, null, 0, 0)
        const env = CodeIntelligence.graphEnvelope(projectID, [])
        expect(env.completeness).toBe("empty")
      },
    })
  })

  test("completeness is full when payload has entries", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.upsertCursor(projectID, null, 1, 2)
        const env = CodeIntelligence.graphEnvelope(projectID, [{ id: "x" }])
        expect(env.completeness).toBe("full")
      },
    })
  })

  test("explicit opts.isEmpty overrides payload inspection", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.upsertCursor(projectID, null, 1, 2)
        // Non-empty payload, but caller marks empty (e.g. filtered to
        // nothing in scope). The override wins.
        const env = CodeIntelligence.graphEnvelope(projectID, [1, 2, 3], { isEmpty: true })
        expect(env.completeness).toBe("empty")
      },
    })
  })

  test("freshness is derivable from the envelope via LSP.envelopeFreshness", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.upsertCursor(projectID, null, 1, 1)
        const env = CodeIntelligence.graphEnvelope(projectID, ["x"])
        // Just-upserted cursor → fresh.
        expect(LSP.envelopeFreshness(env)).toBe("fresh")
        // 2 hours later → warm.
        expect(LSP.envelopeFreshness(env, env.timestamp + 2 * 60 * 60 * 1000)).toBe("warm")
        // 25 hours later → stale.
        expect(LSP.envelopeFreshness(env, env.timestamp + 25 * 60 * 60 * 1000)).toBe("stale")
      },
    })
  })

  test("degraded=true when cursor missing even with fresh payload", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        // No upsertCursor — simulate interrupted indexing run
        // (nodes/edges inserted but cursor never sealed).
        const env = CodeIntelligence.graphEnvelope(projectID, [{ some: "node" }])
        expect(env.degraded).toBe(true)
        expect(env.completeness).toBe("full") // payload isn't empty
        expect(env.source).toBe("graph")
      },
    })
  })
})
