import { describe, expect, test } from "bun:test"

import {
  lruFor,
  markPrefetched,
  prefetchLimit,
  queueFor,
  queuePrefetch,
  trimPrefetchedDirs,
  trimPrefetchQueues,
  warmSessions,
} from "./prefetch"

describe("layout prefetch helpers", () => {
  test("reuses queue and lru state per directory", () => {
    const queues = new Map()
    const dirs = new Map()

    expect(queueFor(queues, "/tmp")).toBe(queueFor(queues, "/tmp"))
    expect(lruFor(dirs, "/tmp")).toBe(lruFor(dirs, "/tmp"))
  })

  test("trims hidden prefetch dirs and idle queues", () => {
    const dirs = new Map<string, Set<string>>([
      ["/keep", new Set(["a"])],
      ["/drop", new Set(["b"])],
    ])
    const queues = new Map([
      ["/keep", { inflight: new Set<string>(), pending: ["a"], pendingSet: new Set(["a"]), running: 1 }],
      ["/drop", { inflight: new Set<string>(), pending: ["b"], pendingSet: new Set(["b"]), running: 0 }],
      ["/busy", { inflight: new Set(["c"]), pending: ["c"], pendingSet: new Set(["c"]), running: 1 }],
    ])

    trimPrefetchedDirs(dirs, ["/keep"])
    trimPrefetchQueues(queues, ["/keep"])

    expect([...dirs.keys()]).toEqual(["/keep"])
    expect(queues.has("/keep")).toBe(true)
    expect(queues.has("/drop")).toBe(false)
    expect(queues.has("/busy")).toBe(true)
    expect(queues.get("/busy")?.pending).toEqual([])
    expect([...((queues.get("/busy")?.pendingSet ?? new Set()) as Set<string>)].length).toBe(0)
  })

  test("marks prefetched sessions and preserves the active session", () => {
    const dirs = new Map<string, Set<string>>([["/tmp", new Set(["a", "b", "c"])], ["/other", new Set(["x", "y"])]] )

    const stale = markPrefetched({
      dirs,
      directory: "/tmp",
      sessionID: "d",
      limit: 3,
      active: "a",
      current: "/tmp",
    })

    expect(stale).toEqual(["b"])
    expect([...lruFor(dirs, "/tmp")]).toEqual(["a", "c", "d"])

    const next = markPrefetched({
      dirs,
      directory: "/other",
      sessionID: "z",
      limit: 2,
      active: "x",
      current: "/tmp",
    })

    expect(next).toEqual(["x"])
  })

  test("queues high priority items first and respects the lru limit", () => {
    const q = queueFor(new Map(), "/tmp")
    const lru = new Set(["a", "b"])

    expect(
      queuePrefetch({ q, lru, sessionID: "c", priority: "low", limit: 2, pendingLimit: 3 }),
    ).toBe(false)
    expect(q.pending).toEqual([])

    expect(
      queuePrefetch({ q, lru, sessionID: "c", priority: "high", limit: 2, pendingLimit: 3 }),
    ).toBe(true)
    expect(q.pending).toEqual(["c"])

    expect(
      queuePrefetch({ q, lru: new Set(["c"]), sessionID: "d", priority: "low", limit: prefetchLimit, pendingLimit: 3 }),
    ).toBe(true)
    expect(
      queuePrefetch({ q, lru: new Set(["c", "d"]), sessionID: "e", priority: "low", limit: prefetchLimit, pendingLimit: 3 }),
    ).toBe(true)
    expect(q.pending).toEqual(["c", "d", "e"])

    expect(
      queuePrefetch({ q, lru: new Set(["c", "d", "e"]), sessionID: "e", priority: "high", limit: prefetchLimit, pendingLimit: 3 }),
    ).toBe(false)
    expect(q.pending).toEqual(["e", "c", "d"])
  })

  test("warms nearby sessions with high priority first", () => {
    const calls: [string, "high" | "low"][] = []
    warmSessions(
      [
        { id: "a", directory: "/tmp" },
        { id: "b", directory: "/tmp" },
        { id: "c", directory: "/tmp" },
        { id: "d", directory: "/tmp" },
        { id: "e", directory: "/tmp" },
      ],
      2,
      2,
      (session, priority) => calls.push([session.id, priority]),
    )

    expect(calls).toEqual([
      ["d", "high"],
      ["b", "high"],
      ["e", "low"],
      ["a", "low"],
    ])
  })
})
