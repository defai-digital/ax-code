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
        expect(body).toContain("AX Code DRE")
        expect(body).toContain("Alpha session")
        expect(body).toContain("Beta session")
        expect(body).toContain(`/dre-graph/session/${a.id}`)
        expect(body).toContain(`/dre-graph/session/${b.id}`)
        expect(body).toContain(`new EventSource("/global/event")`)
        expect(body).toContain(`/dre-graph/fingerprint?directory=${encodeURIComponent(tmp.path)}`)
        expect(body).toContain("live-status")
        const script = body.match(/<script>([\s\S]+)<\/script>/)?.[1]
        expect(script).toBeTruthy()
        expect(() => new Function(script!)).not.toThrow()
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
        expect(body).toContain("AX Code DRE")
        expect(body).toContain(session.id)
        expect(body).toContain(`/session/${session.id}/graph`)
        expect(body).toContain("Execution")
        expect(body).toContain("Branches")
        expect(body).toContain(`new EventSource("/global/event")`)
        expect(body).toContain(`"sessionID":"${session.id}"`)
        expect(body).toContain(`"message.part.updated"`)
        expect(body).toContain(`/dre-graph/session/${session.id}/fingerprint?directory=${encodeURIComponent(tmp.path)}`)
        expect(body).toContain("sessionStorage")
        expect(body).toContain("location.reload()")
        const script = body.match(/<script>([\s\S]+)<\/script>/)?.[1]
        expect(script).toBeTruthy()
        expect(() => new Function(script!)).not.toThrow()
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

  test("returns a session fingerprint for polling", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default()
        const res = await app.request(`/dre-graph/session/${session.id}/fingerprint?directory=${encodeURIComponent(tmp.path)}`)

        expect(res.status).toBe(200)
        expect(res.headers.get("cache-control")).toContain("no-store")

        const body = await res.json()
        expect(body.session.id).toBe(session.id)
        expect(body.graph.nodes).toBe(0)
        expect(body.dre.confidence).toBeNull()
        expect(body.rollback).toBe(0)
        expect(body.risk.confidence).toBe(0.45)
        expect(body.risk.readiness).toBe("ready")
        expect(body.risk.validation).toBe("not_run")
      },
    })
  })
})
