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
