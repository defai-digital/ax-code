import { afterEach, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database, eq } from "../../src/storage/db"
import { SessionTable } from "../../src/session/session.sql"
import { Server } from "../../src/server/server"
import { ServerRuntimeAuth } from "../../src/server/runtime-auth"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

const remove = (id: string, directory: string, authenticated = true) =>
  Server.createApp({ runtimeAuth: true }).request(
    `/global/session/${id}/archived?directory=${encodeURIComponent(directory)}`,
    {
      method: "DELETE",
      headers: authenticated ? ServerRuntimeAuth.headers() : {},
    },
  )

test("deletes archived history after its original project directory disappears", async () => {
  await using tmp = await tmpdir({ git: true })
  const session = await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ title: "Archived history" })
      await Session.setArchived({ sessionID: session.id, time: 123 })
      return session
    },
  })
  await Instance.provide({ directory: tmp.path, fn: () => Instance.dispose() })
  await fs.rm(tmp.path, { recursive: true, force: true })
  expect((await remove(session.id, tmp.path, false)).status).toBe(403)
  expect((await remove(session.id, tmp.path)).status).toBe(200)
  await expect(Session.get(session.id)).rejects.toThrow()
  expect(await fs.stat(tmp.path).catch(() => null)).toBeNull()
  expect(Instance.list()).not.toContain(tmp.path)
})

test("allows archived historical identities while active history remains protected", async () => {
  await using original = await tmpdir({ git: true })
  await using current = await tmpdir({ git: true })
  const session = await Instance.provide({ directory: original.path, fn: () => Session.create({}) })
  Database.use((db) =>
    db.update(SessionTable).set({ directory: current.path }).where(eq(SessionTable.id, session.id)).run(),
  )
  expect((await remove(session.id, current.path)).status).toBe(409)
  await Session.setArchivedGlobally({ sessionID: session.id, time: 123 })
  expect(
    (
      await Server.createApp({ runtimeAuth: true }).request(
        `/session/${session.id}?directory=${encodeURIComponent(current.path)}`,
        { headers: ServerRuntimeAuth.headers() },
      )
    ).status,
  ).toBe(409)
  expect((await remove(session.id, current.path)).status).toBe(200)
  await expect(Session.get(session.id)).rejects.toThrow()
})

test("deletes archived ancestors while retaining active descendants as independent sessions", async () => {
  await using original = await tmpdir({ git: true })
  await using current = await tmpdir({ git: true })
  const { root, child } = await Instance.provide({
    directory: original.path,
    fn: async () => {
      const root = await Session.create({})
      const child = await Session.create({ parentID: root.id })
      await Session.setArchived({ sessionID: root.id, time: 123 })
      return { root, child }
    },
  })
  Database.use((db) =>
    db.update(SessionTable).set({ directory: current.path }).where(eq(SessionTable.id, root.id)).run(),
  )
  expect((await remove(root.id, current.path)).status).toBe(200)
  await expect(Session.get(root.id)).rejects.toThrow()
  expect(await Session.get(child.id)).toMatchObject({ id: child.id, title: child.title, directory: child.directory })
  expect((await Session.get(child.id)).parentID).toBeUndefined()
  expect((await Session.get(child.id)).time.archived).toBeUndefined()
})

test("cleans live process state without running user lifecycle hooks", async () => {
  const { SessionPrompt } = await import("../../src/session/prompt")
  const { LifecycleHooks } = await import("../../src/hooks/lifecycle")
  const { GlobalBus } = await import("../../src/bus/global")
  await using tmp = await tmpdir({ git: true })
  const session = await Instance.provide({ directory: tmp.path, fn: () => Session.create({}) })
  await Session.setArchivedGlobally({ sessionID: session.id, time: 123 })
  // Let creation's detached hook resolve before observing maintenance.
  await new Promise((resolve) => setTimeout(resolve, 0))
  const hook = vi.spyOn(LifecycleHooks, "runForWorkspace").mockResolvedValue({ ok: true, blocked: false, outputs: [] })
  const cancel = vi.spyOn(SessionPrompt, "cancel").mockResolvedValue(undefined)
  const events: string[] = []
  const listener = (event: { payload?: { type?: string; properties?: { info?: { id?: string } } } }) => {
    if (event.payload?.type === "session.deleted") events.push(event.payload.properties?.info?.id ?? "")
  }
  GlobalBus.on("event", listener)
  try {
    expect((await remove(session.id, tmp.path)).status).toBe(200)
    expect(cancel).toHaveBeenCalledWith(session.id)
    expect(hook).not.toHaveBeenCalled()
    expect(events).toContain(session.id)
  } finally {
    GlobalBus.off("event", listener)
  }
})
