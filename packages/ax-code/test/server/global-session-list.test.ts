import { describe, expect, test } from "vitest"
import { promises as fsp } from "fs"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { Database, inArray } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("Session.listGlobal", () => {
  test("lists sessions across projects with project metadata", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    const firstSession = await Instance.provide({
      directory: first.path,
      fn: async () => Session.create({ title: "first-session" }),
    })
    const secondSession = await Instance.provide({
      directory: second.path,
      fn: async () => Session.create({ title: "second-session" }),
    })

    const sessions = [...Session.listGlobal({ limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).toContain(firstSession.id)
    expect(ids).toContain(secondSession.id)

    const firstProject = Project.get(firstSession.projectID)
    const secondProject = Project.get(secondSession.projectID)

    const firstItem = sessions.find((session) => session.id === firstSession.id)
    const secondItem = sessions.find((session) => session.id === secondSession.id)

    expect(firstItem?.project?.id).toBe(firstProject?.id)
    expect(firstItem?.project?.worktree).toBe(firstProject?.worktree)
    expect(secondItem?.project?.id).toBe(secondProject?.id)
    expect(secondItem?.project?.worktree).toBe(secondProject?.worktree)
  })

  test("excludes archived sessions by default", async () => {
    await using tmp = await tmpdir({ git: true })

    const archived = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ title: "archived-session" }),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.setArchived({ sessionID: archived.id, time: Date.now() }),
    })

    const sessions = [...Session.listGlobal({ limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).not.toContain(archived.id)

    const allSessions = [...Session.listGlobal({ limit: 200, archived: true })]
    const allIds = allSessions.map((session) => session.id)

    expect(allIds).toContain(archived.id)
  })

  test("supports cursor pagination", async () => {
    await using tmp = await tmpdir({ git: true })

    const first = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ title: "page-one" }),
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ title: "page-two" }),
    })

    const page = [...Session.listGlobal({ directory: tmp.path, limit: 1 })]
    expect(page.length).toBe(1)
    expect(page[0].id).toBe(second.id)

    const next = [...Session.listGlobal({ directory: tmp.path, limit: 10, cursor: page[0].time.updated })]
    const ids = next.map((session) => session.id)

    expect(ids).toContain(first.id)
    expect(ids).not.toContain(second.id)
  })

  test("cursor pagination does not drop sessions sharing the boundary timestamp", async () => {
    await using tmp = await tmpdir({ git: true })

    const created = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await Session.create({ title: "tie-one" })
        const second = await Session.create({ title: "tie-two" })
        const third = await Session.create({ title: "tie-three" })
        // Force identical time_updated values so all three share one
        // timestamp — the exact condition where a timestamp-only cursor
        // silently loses rows (ordering is (time_updated DESC, id DESC)).
        const shared = Date.now()
        Database.use((db) => {
          const ids = [first.id, second.id, third.id] as Array<(typeof SessionTable.$inferSelect)["id"]>
          db.update(SessionTable).set({ time_updated: shared }).where(inArray(SessionTable.id, ids)).run()
        })
        return { first, second, third, shared }
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: () => {
        // Full ordered set for reference. The ordering key is
        // (time_updated DESC, id DESC) — id tiebreak is lexicographic on
        // the random id suffix, not creation order.
        const expected = [created.third.id, created.second.id, created.first.id].sort().reverse()
        const all = [...Session.listGlobal({ directory: tmp.path, limit: 10 })]
        expect(all.length).toBeGreaterThanOrEqual(3)
        // The shared-timestamp group must be contiguous and id-desc.
        const byTimestamp = all.filter((s) => s.time.updated === created.shared)
        expect(byTimestamp.map((s) => s.id)).toEqual(expected)

        // Old behavior: a timestamp-only cursor skips every row tied at the
        // boundary timestamp below the id tiebreaker.
        const pageOne = [...Session.listGlobal({ directory: tmp.path, limit: 2 })]
        expect(pageOne).toHaveLength(2)

        // New behavior: resuming with (cursor, cursorID) must return the
        // remaining tied session, not skip past it.
        const tail = pageOne[pageOne.length - 1]
        const pageTwo = [
          ...Session.listGlobal({
            directory: tmp.path,
            limit: 10,
            cursor: tail.time.updated,
            cursorID: tail.id,
          }),
        ]
        const seen = [...pageOne, ...pageTwo].map((s) => s.id)
        for (const session of all) {
          expect(seen).toContain(session.id)
        }
      },
    })
  })

  test("experimental session route exposes the id tiebreaker cursor", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessions = [
          await Session.create({ title: "route-tie-one" }),
          await Session.create({ title: "route-tie-two" }),
          await Session.create({ title: "route-tie-three" }),
        ]
        const shared = Date.now()
        Database.use((db) => {
          const ids = sessions.map((s) => s.id) as Array<(typeof SessionTable.$inferSelect)["id"]>
          db.update(SessionTable).set({ time_updated: shared }).where(inArray(SessionTable.id, ids)).run()
        })
        const app = Server.Default()

        try {
          const seen: string[] = []
          let url = `/experimental/session?limit=2&directory=${encodeURIComponent(tmp.path)}`
          for (let page = 0; page < 5; page++) {
            const response = await app.request(url)
            expect(response.status).toBe(200)
            const body = (await response.json()) as Array<{ id: string }>
            seen.push(...body.map((s) => s.id))
            const nextCursor = response.headers.get("x-next-cursor")
            const nextCursorId = response.headers.get("x-next-cursor-id")
            if (!nextCursor || !nextCursorId) break
            url = `/experimental/session?limit=2&directory=${encodeURIComponent(tmp.path)}&cursor=${nextCursor}&cursorId=${encodeURIComponent(nextCursorId)}`
          }

          for (const session of sessions) {
            expect(seen).toContain(session.id)
          }
        } finally {
          for (const session of sessions) {
            await Session.remove(session.id)
          }
        }
      },
    })
  })

  test("experimental session route filters by canonical request directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const link = path.join(tmp.path, "..", `${path.basename(tmp.path)}-global-session-list-link`)

    await fsp.symlink(tmp.path, link, process.platform === "win32" ? "junction" : undefined)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "symlink-global-session-list" })
        const app = Server.Default()

        try {
          const response = await app.request(`/experimental/session?directory=${encodeURIComponent(link)}`)

          expect(response.status).toBe(200)
          const body = (await response.json()) as Array<{ id: string }>
          expect(body.some((item) => item.id === session.id)).toBe(true)
        } finally {
          await Session.remove(session.id)
          await fsp.unlink(link).catch(() => {})
        }
      },
    })
  })
})
