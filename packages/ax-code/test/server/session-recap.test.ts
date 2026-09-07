import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionRecap } from "../../src/session/recap"
import { tmpdir } from "../fixture/fixture"

afterEach(() => vi.restoreAllMocks())

describe("session recap endpoint", () => {
  test("preserves the default response and accepts bounded conversation scope", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const generate = vi.spyOn(SessionRecap, "generate").mockResolvedValue({ text: "Tests passed." })
        const app = Server.Default()
        const request = (query = "") =>
          app.request(`/session/${session.id}/recap${query}`, {
            method: "POST",
            headers: { "x-opencode-directory": tmp.path },
          })
        const original = await request()
        expect(original.status).toBe(200)
        expect(await original.json()).toEqual({ text: "Tests passed." })
        expect(generate).toHaveBeenLastCalledWith({ sessionID: session.id, scope: undefined })
        const conversation = await request("?scope=conversation")
        expect(conversation.status).toBe(200)
        expect(generate).toHaveBeenLastCalledWith({ sessionID: session.id, scope: "conversation" })
        generate.mockResolvedValue(undefined)
        expect(await (await request("?scope=turn")).json()).toEqual({ text: null })
        generate.mockClear()
        expect((await request("?scope=everything")).status).toBe(400)
        expect(generate).not.toHaveBeenCalled()
        await Session.remove(session.id)
      },
    })
  })
})
