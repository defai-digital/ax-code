import { afterEach, describe, expect, test } from "vitest"
import os from "os"
import path from "path"
import { existsSync } from "node:fs"
import { Database } from "../../src/storage/db"
import { Shard } from "../../src/storage/shard"
import { Global } from "../../src/global"

// ProjectID is a branded string; tests use plain strings through `as any` since
// the shard layer only reads the raw value (path encoding + map key).
const pid = (id: string) => id as any

// The open-handle LRU cache is module-level mutable state — reset it between
// tests so eviction/handle counts from one test never leak into the next.
afterEach(() => Shard.closeAll())

describe("Shard.pathFor", () => {
  test("derives a base64url-encoded path under Global.Path.data/shards", () => {
    const encoded = Buffer.from("project/1", "utf8").toString("base64url")
    expect(Shard.pathFor(pid("project/1"))).toBe(path.join(Global.Path.data, "shards", `${encoded}.db`))
  })

  test("Global.Path.data is isolated into the per-file test tmpdir", () => {
    // test/preload.ts sets XDG_DATA_HOME under os.tmpdir()/opencode-test-data-*.
    expect(Global.Path.data).toContain(os.tmpdir())
    expect(Global.Path.data).toContain("opencode-test-data")
  })
})

describe("Shard.handle", () => {
  test("opens a shard client, creates the file, and closes it", () => {
    const id = pid("project-open")
    const result = Shard.handle(id).use((db) => {
      db.run("CREATE TABLE IF NOT EXISTS smoke (id INTEGER PRIMARY KEY)")
      return 42
    })
    expect(result).toBe(42)
    expect(Shard.openCount()).toBe(1)
    expect(Shard.peek(id)).toBeDefined()
    expect(existsSync(Shard.pathFor(id))).toBe(true)

    Shard.close(id)
    expect(Shard.openCount()).toBe(0)
    expect(Shard.peek(id)).toBeUndefined()
  })

  test("reuses an already-open client for repeated access", () => {
    const id = pid("project-reuse")
    Shard.handle(id).use(() => {})
    expect(Shard.openCount()).toBe(1)
    Shard.handle(id).use(() => {})
    expect(Shard.openCount()).toBe(1)
    Shard.close(id)
  })
})

describe("Shard LRU eviction", () => {
  test("evicts least-recently-used handles beyond MAX_OPEN", () => {
    const total = Shard.MAX_OPEN + 3
    const ids = Array.from({ length: total }, (_, i) => pid(`project-${i}`))
    for (const id of ids) Shard.handle(id).use(() => {})

    expect(Shard.openCount()).toBe(Shard.MAX_OPEN)
    // The first `total - MAX_OPEN` entries were evicted oldest-first.
    expect(Shard.peek(ids[0])).toBeUndefined()
    expect(Shard.peek(ids[1])).toBeUndefined()
    expect(Shard.peek(ids[2])).toBeUndefined()
    // The most-recently-used entries remain open.
    expect(Shard.peek(ids[ids.length - 1])).toBeDefined()
  })
})

describe("Database project resolver", () => {
  test("resolveProjectID returns undefined before a resolver is set", () => {
    // shard.test.ts does not import project/instance.ts, so no resolver is wired.
    expect(Database.resolveProjectID()).toBeUndefined()
  })

  test("setProjectResolver wires and overrides the ambient resolver", () => {
    Database.setProjectResolver(() => pid("project-resolved"))
    expect(Database.resolveProjectID()).toBe("project-resolved")
    Database.setProjectResolver(() => undefined)
    expect(Database.resolveProjectID()).toBeUndefined()
  })
})

describe("Database.close integration", () => {
  test("closes all open shard handles", () => {
    Shard.handle(pid("project-close-a")).use(() => {})
    Shard.handle(pid("project-close-b")).use(() => {})
    expect(Shard.openCount()).toBe(2)

    Database.close()
    expect(Shard.openCount()).toBe(0)
  })
})
