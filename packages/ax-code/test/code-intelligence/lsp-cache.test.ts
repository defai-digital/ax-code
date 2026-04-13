import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import type { ProjectID } from "../../src/project/schema"

Log.init({ print: false })

// S2 cache correctness tests. These exercise the storage-layer cache
// directly (getLspCache / upsertLspCache / pruneExpiredLspCache). The
// LSP-level wiring (content-hash lookup, source: "cache" envelope
// construction) is covered by test/lsp/lsp-cache-integration.test.ts.

describe("CodeGraphQuery LSP cache", () => {
  test("upsert then hit returns the stored payload", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id as ProjectID
        const future = Date.now() + 60_000

        const id = CodeGraphQuery.upsertLspCache({
          projectID,
          operation: "references",
          filePath: "/tmp/a.ts",
          contentHash: "hash_a",
          line: 3,
          character: 7,
          payload: [{ uri: "file:///tmp/a.ts", range: {} }],
          serverIDs: ["typescript"],
          completeness: "full",
          expiresAt: future,
        })
        expect(id).toMatch(/^lsc_/)

        const hit = CodeGraphQuery.getLspCache({
          projectID,
          operation: "references",
          filePath: "/tmp/a.ts",
          contentHash: "hash_a",
          line: 3,
          character: 7,
          now: Date.now(),
        })
        expect(hit).toBeDefined()
        expect(hit!.id).toBe(id)
        expect(hit!.completeness).toBe("full")
        expect(hit!.server_ids_json).toEqual(["typescript"])
        expect(Array.isArray(hit!.payload_json)).toBe(true)
      },
    })
  })

  test("different content hash is a miss (content-addressable invariant)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id as ProjectID
        CodeGraphQuery.upsertLspCache({
          projectID,
          operation: "references",
          filePath: "/tmp/a.ts",
          contentHash: "hash_v1",
          line: 0,
          character: 0,
          payload: ["old"],
          serverIDs: [],
          completeness: "full",
          expiresAt: Date.now() + 60_000,
        })

        // Same file, same position, different content hash — must miss.
        const miss = CodeGraphQuery.getLspCache({
          projectID,
          operation: "references",
          filePath: "/tmp/a.ts",
          contentHash: "hash_v2",
          line: 0,
          character: 0,
          now: Date.now(),
        })
        expect(miss).toBeUndefined()
      },
    })
  })

  test("expired rows are treated as misses", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id as ProjectID
        const past = Date.now() - 1000

        CodeGraphQuery.upsertLspCache({
          projectID,
          operation: "documentSymbol",
          filePath: "/tmp/b.ts",
          contentHash: "hash_b",
          line: -1,
          character: -1,
          payload: [],
          serverIDs: [],
          completeness: "full",
          expiresAt: past,
        })

        const miss = CodeGraphQuery.getLspCache({
          projectID,
          operation: "documentSymbol",
          filePath: "/tmp/b.ts",
          contentHash: "hash_b",
          line: -1,
          character: -1,
          now: Date.now(),
        })
        expect(miss).toBeUndefined()
      },
    })
  })

  test("upsert overwrites on the unique key (expires_at refresh)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id as ProjectID

        const first = CodeGraphQuery.upsertLspCache({
          projectID,
          operation: "references",
          filePath: "/tmp/c.ts",
          contentHash: "h",
          line: 0,
          character: 0,
          payload: ["v1"],
          serverIDs: [],
          completeness: "full",
          expiresAt: Date.now() + 1000,
        })

        const second = CodeGraphQuery.upsertLspCache({
          projectID,
          operation: "references",
          filePath: "/tmp/c.ts",
          contentHash: "h",
          line: 0,
          character: 0,
          payload: ["v2"],
          serverIDs: ["rust"],
          completeness: "full",
          expiresAt: Date.now() + 60_000,
        })
        // Same unique key, different ids — upsert inserts a new id only
        // on first write; on conflict it updates in place and the second
        // call re-uses the existing row's id. We assert the payload has
        // been refreshed regardless of which id is returned.
        expect(typeof first).toBe("string")
        expect(typeof second).toBe("string")

        const hit = CodeGraphQuery.getLspCache({
          projectID,
          operation: "references",
          filePath: "/tmp/c.ts",
          contentHash: "h",
          line: 0,
          character: 0,
          now: Date.now(),
        })
        expect(hit).toBeDefined()
        expect(hit!.payload_json).toEqual(["v2"])
        expect(hit!.server_ids_json).toEqual(["rust"])
      },
    })
  })

  test("pruneExpired removes expired rows and leaves fresh ones", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id as ProjectID
        const now = Date.now()

        CodeGraphQuery.upsertLspCache({
          projectID,
          operation: "references",
          filePath: "/tmp/fresh.ts",
          contentHash: "fresh",
          line: 0,
          character: 0,
          payload: ["fresh"],
          serverIDs: [],
          completeness: "full",
          expiresAt: now + 60_000,
        })
        CodeGraphQuery.upsertLspCache({
          projectID,
          operation: "references",
          filePath: "/tmp/stale.ts",
          contentHash: "stale",
          line: 0,
          character: 0,
          payload: ["stale"],
          serverIDs: [],
          completeness: "full",
          expiresAt: now - 1,
        })

        const removed = CodeGraphQuery.pruneExpiredLspCache(now)
        // >= 1 because other test rows from earlier cases in this
        // suite may also be expired. The invariant we care about:
        // our stale row is gone and our fresh row remains.
        expect(removed).toBeGreaterThanOrEqual(1)

        const fresh = CodeGraphQuery.getLspCache({
          projectID,
          operation: "references",
          filePath: "/tmp/fresh.ts",
          contentHash: "fresh",
          line: 0,
          character: 0,
          now,
        })
        expect(fresh).toBeDefined()

        const stale = CodeGraphQuery.getLspCache({
          projectID,
          operation: "references",
          filePath: "/tmp/stale.ts",
          contentHash: "stale",
          line: 0,
          character: 0,
          now,
        })
        expect(stale).toBeUndefined()
      },
    })
  })

  test("incrementHit updates hit_count", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id as ProjectID

        const id = CodeGraphQuery.upsertLspCache({
          projectID,
          operation: "references",
          filePath: "/tmp/d.ts",
          contentHash: "h",
          line: 0,
          character: 0,
          payload: [],
          serverIDs: [],
          completeness: "full",
          expiresAt: Date.now() + 60_000,
        })

        CodeGraphQuery.incrementLspCacheHit(id)
        CodeGraphQuery.incrementLspCacheHit(id)
        CodeGraphQuery.incrementLspCacheHit(id)

        const hit = CodeGraphQuery.getLspCache({
          projectID,
          operation: "references",
          filePath: "/tmp/d.ts",
          contentHash: "h",
          line: 0,
          character: 0,
          now: Date.now(),
        })
        expect(hit!.hit_count).toBe(3)
      },
    })
  })
})
