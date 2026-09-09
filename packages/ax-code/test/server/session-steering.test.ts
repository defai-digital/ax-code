import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionSteering } from "../../src/session/steering"
import { LifecycleHooks } from "../../src/hooks/lifecycle"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

afterEach(() => vi.restoreAllMocks())
test("steering HTTP receipts enforce lifecycle vetoes, identity conflicts and stale generations", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      SessionSteering.begin(session.id, new AbortController().signal)
      const app = Server.Default()
      const stateResponse = await app.request(
        `/session/${session.id}/steering?directory=${encodeURIComponent(tmp.path)}`,
      )
      expect(stateResponse.status).toBe(200)
      const state = SessionSteering.View.parse(await stateResponse.json())
      const hook = vi
        .spyOn(LifecycleHooks, "runForWorkspace")
        .mockResolvedValue({ ok: false, blocked: true, blockReason: "operator veto", outputs: [] })
      const body = { expectedGeneration: state.generation!, clientID: "request_1", text: "Keep this change focused" }
      const post = (input: unknown) =>
        app.request(`/session/${session.id}/steering?directory=${encodeURIComponent(tmp.path)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        })
      const veto = await post(body)
      expect(veto.status).toBe(200)
      expect(SessionSteering.Receipt.parse(await veto.json()).status).toBe("rejected")
      expect(await Session.messages({ sessionID: session.id })).toEqual([])
      hook.mockResolvedValue({ ok: true, blocked: false, outputs: [] })
      const accepted = await post({ ...body, clientID: "request_2" })
      expect(SessionSteering.Receipt.parse(await accepted.json()).status).toBe("accepted")
      expect((await post({ ...body, clientID: "request_2", text: "Different request" })).status).toBe(409)
      SessionSteering.finish(session.id)
      const stale = await post({ ...body, clientID: "request_3" })
      expect(SessionSteering.Receipt.parse(await stale.json()).status).toBe("rejected")
      expect(hook).toHaveBeenCalledTimes(2)
      expect((await post({ ...body, expectedGeneration: "invalid" })).status).toBe(400)
    },
  })
})
