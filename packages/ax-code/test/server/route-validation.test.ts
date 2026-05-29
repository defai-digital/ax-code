import path from "path"
import fs from "fs/promises"
import os from "os"
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import { ServerRuntimeAuth } from "../../src/server/runtime-auth"

const root = path.join(__dirname, "../..")
Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

describe("server route validation", () => {
  test("session prompt returns a non-2xx JSON error when prompt fails", async () => {
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

          expect(res.status).toBe(500)
          const text = await res.text()
          expect(text).toContain("Internal server error")
          expect(text).not.toContain("prompt failed")
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
          const res = await Server.Default().request(
            `/session/${session.id}/message/${messageID}/part/${otherPartID}`,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(part),
            },
          )

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

  test("session list query booleans parse explicit false values", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        let sessionListInput: Parameters<typeof Session.list>[0]
        let globalListInput: Parameters<typeof Session.listGlobal>[0]
        const sessionListSpy = spyOn(Session, "list").mockImplementation(function* (input) {
          sessionListInput = input
        } as typeof Session.list)
        const globalListSpy = spyOn(Session, "listGlobal").mockImplementation(function* (input) {
          globalListInput = input
        } as typeof Session.listGlobal)

        try {
          const sessionRes = await Server.Default().request("/session?roots=false")
          const globalRes = await Server.Default().request("/experimental/session?roots=false&archived=false")

          expect(sessionRes.status).toBe(200)
          expect(globalRes.status).toBe(200)
          expect(sessionListInput?.roots).toBe(false)
          expect(globalListInput?.roots).toBe(false)
          expect(globalListInput?.archived).toBe(false)
        } finally {
          sessionListSpy.mockRestore()
          globalListSpy.mockRestore()
        }
      },
    })
  })

  test("mcp add rejects unsafe server names", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const res = await Server.Default().request("/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", ...ServerRuntimeAuth.headers() },
          body: JSON.stringify({
            name: "../bad/name",
            config: {
              type: "local",
              command: ["node", "server.js"],
              enabled: true,
            },
          }),
        })
        expect(res.status).toBe(400)
      },
    })
  })

  test("mutating mcp routes require runtime authorization", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const missing = await Server.Default().request("/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "local",
            config: {
              type: "local",
              command: ["node", "server.js"],
              enabled: true,
            },
          }),
        })
        expect(missing.status).toBe(403)

        const invalid = await Server.Default().request("/mcp/local/connect", {
          method: "POST",
          headers: { [ServerRuntimeAuth.HEADER]: "wrong" },
        })
        expect(invalid.status).toBe(403)

        const readOnly = await Server.Default().request("/mcp")
        expect(readOnly.status).toBe(200)
      },
    })
  })

  test("pty websocket route closes failed connects instead of leaving an unhandled async open", async () => {
    const src = await Bun.file(path.join(import.meta.dir, "../../src/server/routes/pty.ts")).text()
    expect(src).toContain("try {")
    expect(src).toContain("handler = await Pty.connect(id, socket, cursor)")
    expect(src).toContain("ws.close()")
  })

  test("pty websocket route reports missing sessions as not found", async () => {
    const src = await Bun.file(path.join(import.meta.dir, "../../src/server/routes/pty.ts")).text()
    expect(src).toContain('throw new NotFoundError({ message: "Session not found" })')
    expect(src).not.toContain('throw new Error("Session not found")')
  })

  test("sse stop handlers always close their queues even if unsubscribe throws", async () => {
    const eventSrc = await Bun.file(path.join(import.meta.dir, "../../src/server/routes/event.ts")).text()
    const globalSrc = await Bun.file(path.join(import.meta.dir, "../../src/server/routes/global.ts")).text()
    expect(eventSrc).toContain("} finally {")
    expect(eventSrc).toContain("q.push(null)")
    expect(globalSrc).toContain("} finally {")
    expect(globalSrc).toContain("q.push(null)")
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

  test("directory selection rejects sensitive home directories", async () => {
    const home = path.join(root, ".test-home")
    await fs.mkdir(path.join(home, ".ssh"), { recursive: true })
    const homedir = spyOn(os, "homedir").mockReturnValue(home)

    try {
      const res = await Server.Default().request(
        `/experimental/session?directory=${encodeURIComponent(path.join(home, ".ssh"))}`,
      )
      expect(res.status).toBe(400)
      expect(await res.text()).toContain("directory is not allowed")
    } finally {
      homedir.mockRestore()
      await fs.rm(home, { recursive: true, force: true })
    }
  })
})
