import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { afterEach, expect, test, vi } from "vitest"
import type { TuiRuntimeEvent } from "../../../src/cli/tui/context/sdk"
import type { DurableFollowUp } from "../../../src/cli/tui/component/prompt/durable-follow-up"
import { createFollowUpRefresh } from "../../../src/cli/tui/util/follow-up-refresh"

// Node's default Solid entry is SSR; these lifecycle tests need the client runtime.
vi.mock("solid-js", async () => {
  const { createRequire } = await import("node:module")
  return createRequire(import.meta.url)("solid-js/dist/solid.cjs") as typeof import("solid-js")
})
vi.mock("solid-js/store", async () => {
  const { createRequire } = await import("node:module")
  const require = createRequire(import.meta.url)
  require("solid-js/dist/solid.cjs")
  const runtimePath = require.resolve("solid-js")
  const previous = require.cache[runtimePath]
  require.cache[runtimePath] = require.cache[require.resolve("solid-js/dist/solid.cjs")]
  try {
    return require("solid-js/store/dist/store.cjs") as typeof import("solid-js/store")
  } finally {
    if (previous) require.cache[runtimePath] = previous
    else delete require.cache[runtimePath]
  }
})

type RefreshOptions = Parameters<typeof createFollowUpRefresh>[0]
const disposers: Array<() => void> = []

function row(id: string, sessionID = "ses_one"): DurableFollowUp {
  return {
    id,
    sessionID,
    kind: "followup",
    status: "queued",
    title: id,
    position: 1,
    time: { created: 1 },
    payload: {},
  }
}

function setup(
  initial: { connected?: boolean; loading?: boolean; rows?: DurableFollowUp[]; fetch?: typeof fetch } = {},
) {
  const requests: Array<{
    url: string
    init?: RequestInit
    reply: ReturnType<typeof Promise.withResolvers<Response>>
  }> = []
  const errors: unknown[] = []
  const subscriptions: Array<{ name: string; stops: number }> = []
  return createRoot((dispose) => {
    disposers.push(dispose)
    const events = createGlobalEmitter<{ [K in TuiRuntimeEvent["type"]]: Extract<TuiRuntimeEvent, { type: K }> }>()
    const on: typeof events.on = (name, listener) => {
      const stop = events.on(name, listener)
      const subscription = { name, stops: 0 }
      subscriptions.push(subscription)
      return () => {
        subscription.stops++
        stop()
      }
    }
    const [sessionID, setSession] = createSignal<string | undefined>("ses_one")
    const [directory, setDirectory] = createSignal("/project/測試%")
    const [connected, setConnected] = createSignal(initial.connected ?? true)
    const [state, setState] = createStore<RefreshOptions["state"]>({
      status: initial.loading ? "loading" : "complete",
      task_queue: initial.rows ?? [],
    })
    const fetcher: typeof fetch = (input, init) => {
      const reply = Promise.withResolvers<Response>()
      requests.push({ url: String(input), init, reply })
      return reply.promise
    }
    createFollowUpRefresh({
      sdk: {
        url: "http://localhost:4096/",
        get directory() {
          return directory()
        },
        get sseConnected() {
          return connected()
        },
        fetch: initial.fetch ?? fetcher,
        event: { on },
      },
      state,
      sessionID,
      update: (merge) => setState("task_queue", merge),
      onError: (error) => errors.push(error),
    })
    return { dispose, events, requests, errors, subscriptions, state, setState, setSession, setDirectory, setConnected }
  })
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  vi.restoreAllMocks()
})

test("refresh waits for readiness, scopes the request and does not refetch on cache updates", async () => {
  const h = setup({ connected: false, loading: true })
  expect(h.requests).toHaveLength(0)
  h.setConnected(true)
  await settle()
  expect(h.requests).toHaveLength(0)
  h.setState("status", "complete")
  await settle()
  expect(h.requests).toHaveLength(1)
  expect(h.requests[0].url).toBe("http://localhost:4096/task-queue?sessionID=ses_one")
  const headers = new Headers(h.requests[0].init?.headers)
  expect(headers.get("x-ax-code-directory")).toBe(encodeURIComponent("/project/測試%"))
  expect(headers.get("x-opencode-directory")).toBe(headers.get("x-ax-code-directory"))
  h.setState("task_queue", [row("event")])
  await settle()
  expect(h.requests).toHaveLength(1)
  h.requests[0].reply.resolve(Response.json([row("snapshot")]))
  await settle()
  expect(h.state.task_queue.map((item) => item.id).sort()).toEqual(["event", "snapshot"])
  const listener = h.subscriptions.find((item) => item.name === "task.queue.deleted")!
  expect(listener.stops).toBe(1)
  h.dispose()
  expect(listener.stops).toBe(1)
})

test("refresh preserves newer events, deletions and other sessions while removing stale rows", async () => {
  const original = row("a")
  const h = setup({ rows: [original, row("stale"), row("deleted"), row("other", "ses_two")] })
  h.setState("task_queue", (current) => [
    ...current
      .filter((item) => item.id !== "deleted")
      .map((item) => (item.id === "a" ? { ...item, status: "completed" } : item)),
    row("event-new"),
  ])
  h.events.emit("task.queue.deleted", {
    type: "task.queue.deleted",
    properties: { id: "deleted", projectID: "project_one" },
  })
  h.requests[0].reply.resolve(Response.json([original, row("deleted")]))
  await settle()
  expect(h.state.task_queue.map((item) => item.id).sort()).toEqual(["a", "event-new", "other"])
  expect(h.state.task_queue.find((item) => item.id === "a")?.status).toBe("completed")
  expect(h.requests).toHaveLength(1)
})

test.each(["server.connected", "server.resync_required"] as const)(
  "%s cancels the old request and ignores its late response",
  async (event) => {
    const h = setup()
    if (event === "server.connected") h.events.emit(event, { type: event, properties: {} })
    else h.events.emit(event, { type: event, properties: { reason: "server_restarted", cursor: "cursor" } })
    await settle()
    expect(h.requests).toHaveLength(2)
    expect(h.requests[0].init?.signal?.aborted).toBe(true)
    h.requests[1].reply.resolve(Response.json([{ ...row("same"), status: "paused" }]))
    await settle()
    h.requests[0].reply.resolve(Response.json([row("same")]))
    await settle()
    expect(h.state.task_queue.find((item) => item.id === "same")?.status).toBe("paused")
    expect(h.errors).toEqual([])
  },
)

test("session changes cancel refresh and encode the new session id", async () => {
  const h = setup()
  h.setSession("ses_two?x=1")
  await settle()
  expect(h.requests[0].init?.signal?.aborted).toBe(true)
  expect(h.requests[1].url).toBe("http://localhost:4096/task-queue?sessionID=ses_two%3Fx%3D1")
  h.requests[0].reply.reject(new Error("stale request failed"))
  h.requests[1].reply.resolve(Response.json([row("new", "ses_two?x=1")]))
  await settle()
  expect(h.state.task_queue.map((item) => item.id)).toEqual(["new"])
  expect(h.errors).toEqual([])
})

test("directory changes cancel and fence old results", async () => {
  const h = setup()
  h.setDirectory("/other")
  await settle()
  expect(h.requests).toHaveLength(2)
  expect(h.requests[0].init?.signal?.aborted).toBe(true)
  expect(new Headers(h.requests[1].init?.headers).get("x-ax-code-directory")).toBe("/other")
  h.requests[1].reply.resolve(Response.json([row("current")]))
  h.requests[0].reply.resolve(Response.json([row("stale")]))
  await settle()
  expect(h.state.task_queue.map((item) => item.id)).toEqual(["current"])
})

test.each([{ response: {} }, { response: [null] }, { response: [row("valid"), { ...row("bad"), status: "invalid" }] }])(
  "malformed response $response preserves cached rows and reports failure",
  async ({ response }) => {
    const h = setup({ rows: [row("keep")] })
    h.requests[0].reply.resolve(Response.json(response))
    await settle()
    expect(h.state.task_queue.map((item) => item.id)).toEqual(["keep"])
    expect(h.errors).toHaveLength(1)
  },
)

test("HTTP failure preserves rows, while a valid empty response removes stale rows", async () => {
  const h = setup({ rows: [row("keep")] })
  h.requests[0].reply.resolve(new Response("unavailable", { status: 503 }))
  await settle()
  expect(h.state.task_queue.map((item) => item.id)).toEqual(["keep"])
  expect(h.errors).toHaveLength(1)
  h.events.emit("server.connected", { type: "server.connected", properties: {} })
  await settle()
  h.requests[1].reply.resolve(Response.json([]))
  await settle()
  expect(h.state.task_queue).toEqual([])
})

test("cleanup aborts the request and suppresses its failure", async () => {
  const h = setup()
  h.dispose()
  expect(h.requests[0].init?.signal?.aborted).toBe(true)
  h.requests[0].reply.reject(new Error("aborted transport"))
  await settle()
  expect(h.errors).toEqual([])
  expect(h.subscriptions.every((item) => item.stops === 1)).toBe(true)
})

test("request timeout is reported and releases its deletion listener", async () => {
  const timeout = new AbortController()
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal)
  const h = setup()
  const error = new DOMException("Timed out", "TimeoutError")
  timeout.abort(error)
  h.requests[0].reply.resolve(Response.json([row("too-late")]))
  await settle()
  expect(h.errors).toEqual([error])
  expect(h.state.task_queue).toEqual([])
  expect(h.subscriptions.find((item) => item.name === "task.queue.deleted")?.stops).toBe(1)
})

test("synchronous transport failures are reported and release the listener", () => {
  const error = new Error("custom transport failed")
  const h = setup({
    fetch: () => {
      throw error
    },
  })
  expect(h.errors).toEqual([error])
  expect(h.subscriptions.find((item) => item.name === "task.queue.deleted")?.stops).toBe(1)
})
