import { describe, expect, test } from "vitest"
import fs from "node:fs/promises"
import { GlobalBus, type GlobalBusEvent } from "../../src/bus/global"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database, eq } from "../../src/storage/db"
import { SessionTable } from "../../src/session/session.sql"
import { Server } from "../../src/server/server"
import { ServerRuntimeAuth } from "../../src/server/runtime-auth"
import { tmpdir } from "../fixture/fixture"

describe("global session archive", () => {
  test("archives and restores an orphaned session without bootstrapping its directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const session = await Instance.provide({ directory: tmp.path, fn: () => Session.create({ title: "Historical" }) })
    await Instance.provide({ directory: tmp.path, fn: () => Instance.dispose() })
    await fs.rm(tmp.path, { recursive: true, force: true })
    const app = Server.createApp({ runtimeAuth: true })
    const events: GlobalBusEvent[] = []
    const listener = (event: GlobalBusEvent) => events.push(event)
    GlobalBus.on("event", listener)
    const patch = (body: unknown, authenticated = true) =>
      app.request(`/global/session/${session.id}/archive?directory=${encodeURIComponent(tmp.path)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(authenticated ? ServerRuntimeAuth.headers() : {}) },
        body: JSON.stringify(body),
      })
    try {
      expect((await patch({ archived: 123 }, false)).status).toBe(403)
      expect((await Session.get(session.id)).time.archived).toBeUndefined()
      expect((await patch({ archived: 123, title: "Unwanted edit" })).status).toBe(400)
      expect((await patch({ archived: -1 })).status).toBe(400)
      const response = await patch({ archived: 123 })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ id: session.id, title: "Historical", time: { archived: 123 } })
      expect((await Session.get(session.id)).time.archived).toBe(123)
      expect(events).toContainEqual({
        directory: tmp.path,
        payload: { type: "session.updated", properties: { info: expect.objectContaining({ id: session.id }) } },
      })
      expect((await patch({ archived: null })).status).toBe(200)
      expect((await Session.get(session.id)).time.archived).toBeUndefined()
      expect(await fs.stat(tmp.path).catch(() => null)).toBeNull()
    } finally {
      GlobalBus.off("event", listener)
    }
  })

  test("supports historical project identities while execution and transcript routes remain scoped", async () => {
    await using original = await tmpdir({ git: true })
    await using current = await tmpdir({ git: true })
    const session = await Instance.provide({ directory: original.path, fn: () => Session.create({}) })
    // Reproduce an imported session whose recorded directory now belongs to another project.
    Database.use((db) =>
      db.update(SessionTable).set({ directory: current.path }).where(eq(SessionTable.id, session.id)).run(),
    )
    const app = Server.createApp({ runtimeAuth: true })
    const headers = { "Content-Type": "application/json", ...ServerRuntimeAuth.headers() }
    const scoped = `/session/${session.id}?directory=${encodeURIComponent(current.path)}`
    expect((await app.request(scoped, { headers })).status).toBe(409)
    expect(
      (await app.request(scoped, { method: "PATCH", headers, body: JSON.stringify({ title: "Blocked" }) })).status,
    ).toBe(409)
    expect(
      (
        await app.request(`/global/session/${session.id}/archive`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ archived: 456 }),
        })
      ).status,
    ).toBe(200)
    expect((await Session.get(session.id)).projectID).toBe(session.projectID)
    expect((await app.request(scoped, { headers })).status).toBe(409)
  })
})
