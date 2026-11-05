import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { WorkspaceID } from "../../src/control-plane/schema"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { Project } from "../../src/project/project"
import { Database } from "../../src/storage/db"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { GlobalBus } from "../../src/bus/global"
import { resetDatabase } from "../fixture/db"
import * as adaptors from "../../src/control-plane/adaptors"
import type { Adaptor } from "../../src/control-plane/types"
import { AX_CODE_WORKSPACE_HEADER, LEGACY_OPENCODE_WORKSPACE_HEADER } from "../../src/util/workspace-headers"

afterEach(async () => {
  vi.restoreAllMocks()
  await resetDatabase()
  adaptors.removeAdaptor("testing")
})

beforeEach(() => {
  adaptors.installAdaptor("testing", TestAdaptor)
})

Log.init({ print: false })

const remote = { type: "testing", name: "remote-a" } as unknown as typeof WorkspaceTable.$inferInsert

const TestAdaptor: Adaptor = {
  configure(config) {
    return config
  },
  async create() {
    throw new Error("not used")
  },
  async remove() {},
  async fetch() {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('data: {"type":"remote.ready","properties":{}}\n\n'))
        controller.close()
      },
    })
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
    })
  },
}

describe("control-plane/workspace.startSyncing", () => {
  test("backs off consecutive empty streams and cancels the retry wait on stop", async () => {
    const { Workspace } = await import("../../src/control-plane/workspace")
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    await Workspace.create({ projectID: project.id, type: "testing" })
    const fetch = vi.spyOn(TestAdaptor, "fetch").mockImplementation(async () => new Response(""))
    vi.useFakeTimers()
    const sync = Workspace.startSyncing(project)
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(fetch).toHaveBeenCalledTimes(1)
      for (const [delay, calls] of [
        [1000, 2],
        [2000, 3],
        [4000, 4],
      ]) {
        await vi.advanceTimersByTimeAsync(delay - 1)
        expect(fetch).toHaveBeenCalledTimes(calls - 1)
        await vi.advanceTimersByTimeAsync(1)
        expect(fetch).toHaveBeenCalledTimes(calls)
      }
      await sync.stop()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      void sync.stop()
      vi.useRealTimers()
    }
  })

  test("remote heartbeat bytes renew the idle deadline", async () => {
    const { Workspace } = await import("../../src/control-plane/workspace")
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    await Workspace.create({ projectID: project.id, type: "testing" })
    let body!: ReadableStreamDefaultController<Uint8Array>
    const fetch = vi.spyOn(TestAdaptor, "fetch").mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              body = controller
            },
          }),
        ),
    )
    vi.useFakeTimers()
    const sync = Workspace.startSyncing(project)
    try {
      await vi.advanceTimersByTimeAsync(59_000)
      body.enqueue(new TextEncoder().encode(": heartbeat\n\n"))
      await vi.advanceTimersByTimeAsync(59_000)
      expect(fetch).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(2001)
      expect(fetch).toHaveBeenCalledTimes(2)
      await sync.stop()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      void sync.stop()
      vi.useRealTimers()
    }
  })

  test("cleans up adaptor responses arriving after shutdown", async () => {
    const { Workspace } = await import("../../src/control-plane/workspace")
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    await Workspace.create({ projectID: project.id, type: "testing" })
    const response = Promise.withResolvers<Response>()
    vi.spyOn(TestAdaptor, "fetch").mockReturnValue(response.promise)
    const cancelled = vi.fn()
    const sync = Workspace.startSyncing(project)
    await sync.stop()
    response.resolve(new Response(new ReadableStream({ cancel: cancelled })))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(cancelled).toHaveBeenCalledTimes(1)
  })

  test.each(["fetch", "idle", "closed", "resume"])(
    "recovers a remote %s stream with bounded retries",
    async (scenario) => {
      const { Workspace } = await import("../../src/control-plane/workspace")
      await using tmp = await tmpdir({ git: true })
      const { project } = await Project.fromDirectory(tmp.path)
      const workspace = await Workspace.create({ projectID: project.id, type: "testing" })
      const requests: Array<RequestInit | undefined> = []
      const cancelled = vi.fn()
      vi.spyOn(TestAdaptor, "fetch").mockImplementation(async (_config, _input, init) => {
        requests.push(init)
        // Bound the failing-before EOF loop so the test cannot starve timers.
        if (requests.length > 1 || scenario === "fetch") return new Promise<Response>(() => {})
        if (scenario === "idle") return new Response(new ReadableStream({ cancel: cancelled }))
        return new Response(scenario === "resume" ? 'id: remote-cursor\ndata: {"type":"remote.ready"}\n\n' : "")
      })
      vi.useFakeTimers()
      const sync = Workspace.startSyncing(project)
      try {
        await vi.advanceTimersByTimeAsync(0)
        expect(requests).toHaveLength(1)
        if (scenario === "fetch" || scenario === "idle")
          await vi.advanceTimersByTimeAsync(scenario === "fetch" ? 10_000 : 60_000)
        else {
          await vi.advanceTimersByTimeAsync(999)
          expect(requests).toHaveLength(1)
        }
        await vi.advanceTimersByTimeAsync(1001)
        expect(requests).toHaveLength(2)
        expect(new Headers(requests[1]?.headers).get(AX_CODE_WORKSPACE_HEADER)).toBe(workspace!.id)
        if (scenario === "resume") expect(new Headers(requests[1]?.headers).get("Last-Event-ID")).toBe("remote-cursor")
        if (scenario === "idle") expect(cancelled).toHaveBeenCalledTimes(1)
        const stopped = vi.fn()
        const stopping = sync.stop().then(stopped)
        await vi.advanceTimersByTimeAsync(0)
        expect(stopped).toHaveBeenCalledTimes(1)
        await stopping
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        // stop() must remain non-blocking even if an adaptor ignores its signal.
        void sync.stop()
        vi.useRealTimers()
      }
    },
  )

  test("syncs only remote workspaces and emits remote SSE events", async () => {
    const { Workspace } = await import("../../src/control-plane/workspace")
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const id1 = WorkspaceID.ascending()
    const id2 = WorkspaceID.ascending()

    Database.use((db) =>
      db
        .insert(WorkspaceTable)
        .values([
          {
            id: id1,
            branch: "main",
            project_id: project.id,
            type: remote.type,
            name: remote.name,
          },
          {
            id: id2,
            branch: "main",
            project_id: project.id,
            type: "worktree",
            directory: tmp.path,
            name: "local",
          },
        ])
        .run(),
    )

    const seenCurrentHeaders: string[] = []
    const seenLegacyHeaders: string[] = []
    const originalFetch = TestAdaptor.fetch
    TestAdaptor.fetch = async (config, input, init) => {
      const url =
        input instanceof Request || input instanceof URL
          ? input.toString()
          : new URL(input, "http://workspace.test").toString()
      const request = new Request(url, init)
      seenCurrentHeaders.push(request.headers.get(AX_CODE_WORKSPACE_HEADER) ?? "")
      seenLegacyHeaders.push(request.headers.get(LEGACY_OPENCODE_WORKSPACE_HEADER) ?? "")
      return originalFetch(config, input, init)
    }

    const done = new Promise<void>((resolve) => {
      const listener = (event: { directory?: string; payload: { type: string } }) => {
        if (event.directory !== id1) return
        if (event.payload.type !== "remote.ready") return
        GlobalBus.off("event", listener)
        resolve()
      }
      GlobalBus.on("event", listener)
    })

    const sync = Workspace.startSyncing(project)
    await Promise.race([
      done,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for sync event")), 2000)),
    ])

    await sync.stop()
    expect(seenCurrentHeaders).toContain(id1)
    expect(seenLegacyHeaders).toContain(id1)
    TestAdaptor.fetch = originalFetch
  })

  test("reconnects when remote workspace sync returns an empty response body", async () => {
    const { Workspace } = await import("../../src/control-plane/workspace")
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const id = WorkspaceID.ascending()
    Database.use((db) =>
      db
        .insert(WorkspaceTable)
        .values([
          {
            id,
            branch: "main",
            project_id: project.id,
            type: remote.type,
            name: remote.name,
          },
        ])
        .run(),
    )

    const originalFetch = TestAdaptor.fetch
    let calls = 0
    TestAdaptor.fetch = async (config, input, init) => {
      calls++
      if (calls === 1) {
        return new Response(null, {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
          },
        })
      }
      return originalFetch(config, input, init)
    }

    const done = new Promise<void>((resolve) => {
      const listener = (event: { directory?: string; payload: { type: string } }) => {
        if (event.directory !== id) return
        if (event.payload.type !== "remote.ready") return
        GlobalBus.off("event", listener)
        resolve()
      }
      GlobalBus.on("event", listener)
    })

    const sync = Workspace.startSyncing(project)
    try {
      await Promise.race([
        done,
        new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for reconnect")), 3000)),
      ])
      expect(calls).toBeGreaterThanOrEqual(2)
    } finally {
      await sync.stop()
      TestAdaptor.fetch = originalFetch
    }
  })
})
