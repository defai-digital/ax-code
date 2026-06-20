import { describe, expect, test } from "vitest"
import { promises as fsp } from "fs"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("Session.list", () => {
  test("filters by directory", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const first = await Session.create({})

        const otherDir = path.join(projectRoot, "..", "__session_list_other")
        const second = await Instance.provide({
          directory: otherDir,
          fn: async () => Session.create({}),
        })

        const sessions = [...Session.list({ directory: projectRoot })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(first.id)
        expect(ids).not.toContain(second.id)
      },
    })
  })

  test("filters root sessions", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const root = await Session.create({ title: "root-session" })
        const child = await Session.create({ title: "child-session", parentID: root.id })

        const sessions = [...Session.list({ roots: true })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(root.id)
        expect(ids).not.toContain(child.id)
      },
    })
  })

  test("filters by start time", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({ title: "new-session" })
        const futureStart = Date.now() + 86400000

        const sessions = [...Session.list({ start: futureStart })]
        expect(sessions.length).toBe(0)
      },
    })
  })

  test("filters by search term", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await Session.create({ title: "unique-search-term-abc" })
        await Session.create({ title: "other-session-xyz" })

        const sessions = [...Session.list({ search: "unique-search" })]
        const titles = sessions.map((s) => s.title)

        expect(titles).toContain("unique-search-term-abc")
        expect(titles).not.toContain("other-session-xyz")
      },
    })
  })

  test("respects limit parameter", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await Session.create({ title: "session-1" })
        await Session.create({ title: "session-2" })
        await Session.create({ title: "session-3" })

        const sessions = [...Session.list({ limit: 2 })]
        expect(sessions.length).toBe(2)
      },
    })
  })
})

describe("GET /session", () => {
  test("session patch coerces archived timestamp from string values", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "archive-route-session" })
        const archivedAt = 50_000
        const app = Server.Default()

        try {
          const response = await app.request(`/session/${session.id}?directory=${encodeURIComponent(tmp.path)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ time: { archived: String(archivedAt) } }),
          })

          expect(response.status).toBe(200)
          const body = (await response.json()) as { time: { archived?: number } }
          expect(body.time.archived).toBe(archivedAt)
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })

  test("session patch rejects empty archived timestamps", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "empty-archive-route-session" })
        const app = Server.Default()

        try {
          const response = await app.request(`/session/${session.id}?directory=${encodeURIComponent(tmp.path)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ time: { archived: "" } }),
          })

          expect(response.status).toBe(400)
          expect((await Session.get(session.id)).time.archived).toBeUndefined()
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })

  test("uses canonical request directory when filtering sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    const link = path.join(tmp.path, "..", `${path.basename(tmp.path)}-session-list-link`)

    await fsp.symlink(tmp.path, link, process.platform === "win32" ? "junction" : undefined)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "symlink-session-list" })
        const app = Server.Default()

        try {
          const response = await app.request(`/session?directory=${encodeURIComponent(link)}`)

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
