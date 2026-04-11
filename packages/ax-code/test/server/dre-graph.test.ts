import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

describe("dre graph route", () => {
  test("renders a browser session index", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const a = await Session.create({ title: "Alpha session" })
        const b = await Session.create({ title: "Beta session" })
        const app = Server.Default()
        const res = await app.request(`/dre-graph?directory=${encodeURIComponent(tmp.path)}`)

        expect(res.status).toBe(200)
        expect(res.headers.get("content-type")).toContain("text/html")

        const body = await res.text()
        expect(body).toContain("DRE Graph Sessions")
        expect(body).toContain("Alpha session")
        expect(body).toContain("Beta session")
        expect(body).toContain(`/dre-graph/session/${a.id}`)
        expect(body).toContain(`/dre-graph/session/${b.id}`)
      },
    })
  })

  test("renders a browser session page", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default()
        const res = await app.request(`/dre-graph/session/${session.id}?directory=${encodeURIComponent(tmp.path)}`)

        expect(res.status).toBe(200)
        expect(res.headers.get("content-type")).toContain("text/html")

        const body = await res.text()
        expect(body).toContain("DRE Graph")
        expect(body).toContain(session.id)
        expect(body).toContain(`/session/${session.id}/graph`)
        expect(body).toContain("Execution Graph")
        expect(body).toContain("Branch Ranking")
      },
    })
  })

  test("returns 404 for a missing session page", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default()
        const res = await app.request(`/dre-graph/session/ses_missing?directory=${encodeURIComponent(tmp.path)}`)
        expect(res.status).toBe(404)
      },
    })
  })
})
