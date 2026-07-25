import { describe, expect, test } from "vitest"
import path from "path"
import { readFile } from "node:fs/promises"
import { LSP } from "../../src/lsp/index-impl"

// Regression guard for the LSP client explosion: clients are keyed by
// (root, serverID) and NearestRoot() mints one root per nested marker
// directory, so a tree with a CMakeLists.txt at every level (a vendored
// KDE checkout in one observed session) spawned 52 concurrent clangd
// processes, each indexing C++ independently, until the machine ran out
// of memory. index-impl now caps connected clients per server and evicts
// the least-recently-used ones once a fresh spawn passes the cap.

type FakeClient = { serverID: string; root: string }

const client = (serverID: string, root: string): FakeClient => ({ serverID, root })

describe("LSP per-server client cap", () => {
  test("no evictions while at or under the cap", () => {
    const clients = [client("clangd", "/a"), client("clangd", "/b"), client("pyright", "/c")]
    expect(LSP.selectClientEvictions(clients, "clangd", 2, () => 0)).toEqual([])
    expect(LSP.selectClientEvictions(clients, "clangd", 3, () => 0)).toEqual([])
  })

  test("evicts the least-recently-used clients of that server only", () => {
    const oldest = client("clangd", "/plasma/kcms")
    const older = client("clangd", "/plasma/applets")
    const fresh = client("clangd", "/plasma/shell")
    const other = client("pyright", "/py")
    const lastUse = new Map<FakeClient, number>([
      [oldest, 1],
      [older, 2],
      [fresh, 3],
      [other, 0],
    ])

    const evicted = LSP.selectClientEvictions([other, fresh, oldest, older], "clangd", 1, (c) => lastUse.get(c)!)
    expect(evicted).toEqual([oldest, older])
    // The unrelated server's client is never an eviction candidate, even
    // though it is the globally least-recently-used entry.
    expect(evicted).not.toContain(other)
  })

  test("does not mutate the live client list while selecting", () => {
    const clients = [client("clangd", "/b"), client("clangd", "/a")]
    const snapshot = [...clients]
    LSP.selectClientEvictions(clients, "clangd", 1, (c) => (c.root === "/a" ? 1 : 2))
    expect(clients).toEqual(snapshot)
  })

  test("a burst of distinct roots can never keep more than the cap connected", () => {
    const clients: FakeClient[] = []
    const lastUse = new Map<FakeClient, number>()
    const CAP = 8
    for (let i = 0; i < 52; i++) {
      const c = client("clangd", `/plasma/subproject-${i}`)
      clients.push(c)
      lastUse.set(c, i)
      // Mirrors scheduleClient: register, then evict down to the cap.
      for (const evict of LSP.selectClientEvictions(clients, "clangd", CAP, (x) => lastUse.get(x)!)) {
        clients.splice(clients.indexOf(evict), 1)
      }
    }
    expect(clients.length).toBe(CAP)
    // The survivors are exactly the most recently used roots.
    expect(clients.map((c) => c.root)).toEqual(
      Array.from({ length: CAP }, (_, i) => `/plasma/subproject-${52 - CAP + i}`),
    )
  })
})

describe("LSP client cap wiring (source guardrails)", () => {
  test("fresh registrations mark use and evict, reuses refresh the LRU clock", async () => {
    const source = await readFile(path.join(__dirname, "../../src/lsp/index-impl.ts"), "utf-8")

    expect(source).toContain("const MAX_CLIENTS_PER_SERVER")

    // scheduleClient: push → mark → evict, in that order.
    const registration = source.slice(source.indexOf("s.clients.push(client)"))
    expect(registration).toContain("markClientUsed(s, client)")
    expect(registration.indexOf("evictExcessClients(s, server.id)")).toBeGreaterThan(
      registration.indexOf("markClientUsed(s, client)"),
    )

    // queueClientForRoot: reusing a connected client refreshes its slot.
    const reuse = source.slice(
      source.indexOf("const match = s.clients.find"),
      source.indexOf("const inflight = s.spawning.get(key)"),
    )
    expect(reuse).toContain("markClientUsed(s, match)")

    // Eviction must not poison the root for future spawns.
    const evictBody = source.slice(source.indexOf("function evictExcessClients"), source.indexOf("async function resolveRoot"))
    expect(evictBody).not.toContain("markBroken")
    expect(evictBody).toContain("client.shutdown()")
  })
})
