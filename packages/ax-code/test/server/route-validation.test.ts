import path from "path"
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID } from "../../src/session/schema"
import { Log } from "../../src/util/log"

const root = path.join(__dirname, "../..")
Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

describe("server route validation", () => {
  test("session prompt stream returns a JSON error body when prompt fails", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const promptSpy = spyOn(SessionPrompt, "prompt").mockRejectedValue(new Error("prompt failed"))

        try {
          const res = await Server.Default().request(`/session/${session.id}/message`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              parts: [{ type: "text", text: "hello" }],
            }),
          })

          expect(res.status).toBe(200)
          expect(await res.json()).toEqual({ error: "prompt failed" })
        } finally {
          promptSpy.mockRestore()
          await Session.remove(session.id)
        }
      },
    })
  })

  test("part update mismatch returns a generic 400 without leaking identifiers", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const messageID = MessageID.ascending()
        const partID = PartID.ascending()
        const otherPartID = PartID.ascending()
        await Session.updateMessage({
          id: messageID,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "test",
          model: { providerID: "test", modelID: "test" },
          tools: {},
          mode: "",
        } as unknown as MessageV2.Info)
        const part = await Session.updatePart({
          id: partID,
          sessionID: session.id,
          messageID,
          type: "text",
          text: "hello",
        })

        try {
          const res = await Server.Default().request(`/session/${session.id}/message/${messageID}/part/${otherPartID}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(part),
          })

          const text = await res.text()
          expect(res.status).toBe(400)
          expect(text).toContain("Part identifiers do not match the request path")
          expect(text).not.toContain(String(partID))
          expect(text).not.toContain(String(messageID))
          expect(text).not.toContain(String(session.id))
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })

  test("revert and unrevert routes assert that the session is not busy", async () => {
    const src = await Bun.file(path.join(import.meta.dir, "../../src/server/routes/session.ts")).text()
    const revertStart = src.indexOf('"/:sessionID/revert"')
    const unrevertStart = src.indexOf('"/:sessionID/unrevert"', revertStart)
    const permissionStart = src.indexOf('"/:sessionID/permissions/:permissionID"', unrevertStart)

    expect(src.slice(revertStart, unrevertStart)).toContain("SessionPrompt.assertNotBusy(sessionID)")
    expect(src.slice(unrevertStart, permissionStart)).toContain("SessionPrompt.assertNotBusy(sessionID)")
  })

  test("experimental session list rejects limits above 1000", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const res = await Server.Default().request("/experimental/session?limit=1001")
        expect(res.status).toBe(400)
      },
    })
  })

  test("log endpoint rejects oversized messages", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const res = await Server.Default().request("/log", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            service: "test",
            level: "info",
            message: "x".repeat(10001),
          }),
        })
        expect(res.status).toBe(400)
      },
    })
  })

  test("find route rejects oversized search patterns", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const res = await Server.Default().request(`/find?pattern=${"a".repeat(1025)}`)
        expect(res.status).toBe(400)
      },
    })
  })
})
