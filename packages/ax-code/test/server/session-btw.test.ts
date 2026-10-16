import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionExecution } from "../../src/session/execution"
import { SessionBtw } from "../../src/session/btw"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

afterEach(() => vi.restoreAllMocks())

describe("session btw endpoint", () => {
  test("answers without touching the transcript, lastRecap, or the running turn", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        try {
          const generate = vi.spyOn(SessionBtw, "generate").mockResolvedValue({ answer: "The auth fix landed." })
          const persist = vi.spyOn(Session, "setLastRecap")
          const app = Server.Default()
          const request = (body: unknown) =>
            app.request(`/session/${session.id}/btw`, {
              method: "POST",
              headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
              body: JSON.stringify(body),
            })

          // A marked-running session must not block the side question: the
          // route never asserts busy (ADR-213).
          let response!: Response
          await SessionExecution.withRun(session.id, async () => {
            response = await request({ question: "What is the state of the auth fix?" })
          })
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ answer: "The auth fix landed." })
          expect(generate).toHaveBeenCalledWith({
            sessionID: session.id,
            question: "What is the state of the auth fix?",
            model: undefined,
          })

          // Explicit request model is forwarded as the override pair.
          await request({ question: "Summarize", providerID: "anthropic", modelID: "claude-sonnet-5" })
          expect(generate).toHaveBeenLastCalledWith({
            sessionID: session.id,
            question: "Summarize",
            model: { providerID: expect.anything(), modelID: expect.anything() },
          })

          // Nothing landed in the transcript or the recap slot.
          expect(await Session.messages({ sessionID: session.id })).toHaveLength(0)
          expect((await Session.get(session.id)).lastRecap).toBeUndefined()
          expect(persist).not.toHaveBeenCalled()
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })

  test("rejects invalid bodies without calling the generator", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        try {
          const generate = vi.spyOn(SessionBtw, "generate").mockResolvedValue({ answer: "unused" })
          const app = Server.Default()
          const request = (body: unknown) =>
            app.request(`/session/${session.id}/btw`, {
              method: "POST",
              headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
              body: JSON.stringify(body),
            })
          expect((await request({ question: "" })).status).toBe(400)
          expect((await request({ question: "  " })).status).toBe(400)
          expect((await request({ question: "x".repeat(2001) })).status).toBe(400)
          expect((await request({})).status).toBe(400)
          expect((await request({ question: "ok", providerID: "anthropic" })).status).toBe(400)
          expect(generate).not.toHaveBeenCalled()
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })

  test("surfaces unavailable answers as 400 with the reason", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        try {
          vi.spyOn(SessionBtw, "generate").mockRejectedValue(
            new SessionBtw.UnavailableError({ message: "There is no conversation history to answer from yet." }),
          )
          const response = await Server.Default().request(`/session/${session.id}/btw`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
            body: JSON.stringify({ question: "status?" }),
          })
          expect(response.status).toBe(400)
          const payload = (await response.json()) as { message?: string }
          expect(payload.message).toBe("There is no conversation history to answer from yet.")
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })

  test("rejects unknown sessions with 404", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generate = vi.spyOn(SessionBtw, "generate").mockResolvedValue({ answer: "unused" })
        const response = await Server.Default().request(`/session/${SessionID.make("ses_btw_missing")}/btw`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
          body: JSON.stringify({ question: "status?" }),
        })
        expect(response.status).toBe(404)
        expect(generate).not.toHaveBeenCalled()
      },
    })
  })
})
