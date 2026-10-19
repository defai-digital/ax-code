import { describe, expect, test, vi } from "vitest"
import { readFileSync } from "node:fs"
import { transformSync } from "esbuild"
import { createStore } from "solid-js/store"
import { createStoreBackedSessionSyncController } from "../../../src/cli/tui/context/sync-session-sync"
import { createEarlierMessageLoader } from "../../../src/cli/tui/context/sync-earlier-messages"
import { adoptHistoryCursor, sessionMessageLimit } from "../../../src/cli/tui/context/sync-message-window"
import { applyEarlierMessagePage } from "../../../src/cli/tui/context/sync-session-store"
import { createSyncContextValue } from "../../../src/cli/tui/context/sync-result"

type Message = { id: string }
type Part = { id: string }
function fixture(count = 100) {
  const store = {
    session: [{ id: "session" }],
    session_risk: {},
    status: "complete" as const,
    workspaceList: [],
    message: {
      session: Array.from({ length: count }, (_, i) => ({ id: `msg_${String(100 + i).padStart(4, "0")}` })),
    } as Record<string, Message[]>,
    part: {} as Record<string, Part[]>,
    message_cursor: { session: "opaque-cursor" } as Record<string, string>,
    message_window: {} as Record<string, number>,
    message_truncated: { session: true },
  }
  const response = {
    data: [{ info: { id: "msg_0000" }, parts: [{ id: "part_0" }] }],
    response: new Response(null, { headers: { "X-Next-Cursor": "next-cursor" } }),
  }
  const pending = Promise.withResolvers<typeof response>()
  const fetchPage = vi.fn((_id: string, _before: string, _limit: number, _signal: AbortSignal) => pending.promise)
  const applyPage = vi.fn((id: string, page: typeof response.data, cursor: string | undefined) => {
    applyEarlierMessagePage(store, id, page, cursor, { maxMessages: 300 })
  })
  const createFetchPage = vi.fn(() => fetchPage)
  const loader = createEarlierMessageLoader<Message, Part>({ store, createFetchPage, applyPage })
  return { store, response, pending, fetchPage, applyPage, createFetchPage, loader }
}

describe("load earlier message flights", () => {
  test("deduplicates clicks and uses the exact cursor and remaining capacity", async () => {
    const f = fixture(250)
    const flight = f.loader.loadEarlier("session")
    expect(await f.loader.loadEarlier("session")).toBe("busy")
    expect(f.fetchPage).toHaveBeenCalledExactlyOnceWith("session", "opaque-cursor", 50, expect.any(AbortSignal))
    f.pending.resolve(f.response)
    expect(await flight).toBe("loaded")
    expect(f.store.message.session).toHaveLength(251)
    expect(f.store.message_cursor.session).toBe("next-cursor")
    expect(f.store.message_window.session).toBe(251)
  })

  test.each(["exhausted", "limit", "stale"] as const)("returns %s without starting a request", async (result) => {
    const f = fixture(result === "limit" ? 300 : 100)
    if (result === "exhausted") delete f.store.message_cursor.session
    if (result === "stale") delete f.store.message.session
    expect(await f.loader.loadEarlier("session")).toBe(result)
    expect(f.fetchPage).not.toHaveBeenCalled()
  })

  test.each(["cursor", "unloaded"])("ignores a result after the %s changes", async (change) => {
    const f = fixture()
    const flight = f.loader.loadEarlier("session")
    if (change === "cursor") f.store.message_cursor.session = "resynced-cursor"
    else delete f.store.message.session
    f.pending.resolve(f.response)
    expect(await flight).toBe("stale")
    expect(f.applyPage).not.toHaveBeenCalled()
  })

  test("clear aborts immediately and a late response cannot overwrite re-entry using the same cursor", async () => {
    const f = fixture()
    const first = f.loader.loadEarlier("session")
    const firstSignal = f.fetchPage.mock.calls[0][3]
    f.loader.clear("session")
    expect(firstSignal.aborted).toBe(true)
    expect(await first).toBe("stale")
    const second = f.loader.loadEarlier("session")
    expect(await f.loader.loadEarlier("session")).toBe("busy")
    f.pending.resolve(f.response)
    expect(await second).toBe("loaded")
    expect(f.applyPage).toHaveBeenCalledTimes(1)
  })

  test("sessions have independent flights and reset aborts every request", async () => {
    const f = fixture()
    f.store.message.other = []
    f.store.message_cursor.other = "other-cursor"
    const first = f.loader.loadEarlier("session")
    const other = f.loader.loadEarlier("other")
    expect(f.fetchPage).toHaveBeenCalledTimes(2)
    f.loader.reset()
    expect(await first).toBe("stale")
    expect(await other).toBe("stale")
    expect(f.fetchPage.mock.calls.every((call) => call[3].aborted)).toBe(true)
    expect(f.applyPage).not.toHaveBeenCalled()
  })

  test("network failures release the flight for retry", async () => {
    const f = fixture()
    const flight = f.loader.loadEarlier("session")
    f.pending.reject(new Error("offline"))
    await expect(flight).rejects.toThrow("offline")
    f.fetchPage.mockResolvedValueOnce(f.response)
    expect(await f.loader.loadEarlier("session")).toBe("loaded")
  })

  test("times out after ten seconds, aborting the request and releasing the flight", async () => {
    vi.useFakeTimers()
    try {
      const f = fixture()
      const flight = f.loader.loadEarlier("session")
      const rejected = expect(flight).rejects.toThrow("timed out after 10000ms")
      await vi.advanceTimersByTimeAsync(10_000)
      await rejected
      expect(f.fetchPage.mock.calls[0][3].aborted).toBe(true)
      expect(f.applyPage).not.toHaveBeenCalled()
      f.fetchPage.mockResolvedValueOnce(f.response)
      expect(await f.loader.loadEarlier("session")).toBe("loaded")
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("message window integration", () => {
  test("forced resync retains the admitted window and clears an exhausted server cursor", async () => {
    const f = fixture(200)
    const [store, setStore] = createStore({
      ...f.store,
      todo: {},
      session_diff: {},
      session_goal: {},
    })
    setStore("message_window", "session", 200)
    let cursor: string | undefined = "refreshed-cursor"
    const controller = createStoreBackedSessionSyncController<
      { id: string },
      unknown,
      Message,
      Part,
      unknown,
      unknown,
      unknown,
      typeof store
    >({
      timeoutMs: 10_000,
      withTimeout: async (_label, promise) => promise,
      setStore,
      fetchSession: async () => ({ data: { id: "session" } }),
      fetchMessages: async () => ({
        data: store.message.session.map((info) => ({ info, parts: [] })),
        history: { cursor },
      }),
      fetchTodo: async () => ({ data: [] }),
      fetchDiff: async () => ({ data: [] }),
    })
    await controller.sync("session")
    expect(store.message.session).toHaveLength(200)
    expect(store.message_cursor.session).toBe("refreshed-cursor")
    cursor = undefined
    await controller.sync("session", { force: true })
    expect(store.message.session).toHaveLength(200)
    expect(store.message_cursor.session).toBeUndefined()
    expect(store.message_truncated.session).toBe(false)
  })

  test("requests exactly the admitted window and reads the server cursor without dropping a message", async () => {
    const source = readFileSync(new URL("../../../src/cli/tui/context/sync.tsx", import.meta.url), "utf8")
    const start = source.indexOf("      fetchMessages: async (sessionID) => {")
    const end = source.indexOf("\n      fetchTodo:", start)
    const code = transformSync(`({${source.slice(start, end)}})`, { loader: "ts" }).code
    const data = Array.from({ length: 200 }, (_, i) => ({ info: { id: String(i) }, parts: [] }))
    const messages = vi.fn(async () => ({
      data,
      response: new Response(null, { headers: { "X-Next-Cursor": "server-only" } }),
    }))
    const store = { message_window: { session: 200 } as Record<string, number> }
    const fetch = new Function("sdk", "store", "sessionMessageLimit", `return ${code}`)(
      { client: { session: { messages } } },
      store,
      sessionMessageLimit,
    ).fetchMessages
    expect(await fetch("session")).toMatchObject({ data, history: { cursor: "server-only" } })
    expect(messages.mock.calls[0]).toEqual([{ sessionID: "session", limit: 200 }, { throwOnError: true }])
    await fetch("other")
    expect(messages.mock.calls[1]).toEqual([{ sessionID: "other", limit: 100 }, { throwOnError: true }])
  })

  test("adopts the undo cursor and clamps the admitted count through the public facade", async () => {
    const f = fixture(350)
    const sync = createSyncContextValue({
      store: f.store,
      setStore: null,
      sessionSync: () => {},
      sessionLoadEarlier: f.loader.loadEarlier,
      sessionAdoptHistoryCursor: (id, cursor) => adoptHistoryCursor(f.store, id, cursor),
      workspaceSync: () => {},
      bootstrap: () => {},
      runtime: {},
    })
    sync.session.adoptHistoryCursor("session", "undo-cursor")
    expect(f.store.message_cursor.session).toBe("undo-cursor")
    expect(f.store.message_window.session).toBe(300)
    expect(await sync.session.loadEarlier("session")).toBe("limit")
    sync.session.adoptHistoryCursor("session", undefined)
    expect(f.store.message_cursor.session).toBeUndefined()
    expect(await sync.session.loadEarlier("session")).toBe("exhausted")
    expect(sessionMessageLimit({ message_window: { session: 1 } }, "session")).toBe(100)
    expect(sessionMessageLimit({ message_window: { session: 999 } }, "session")).toBe(300)
  })
})
