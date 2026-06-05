import path from "path"
import fs from "fs/promises"
import os from "os"
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import { ServerRuntimeAuth } from "../../src/server/runtime-auth"
import { PermissionID } from "../../src/permission/schema"
import { QuestionID } from "../../src/question/schema"
import { appErrorEnvelope } from "../../src/server/error"

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
        const promptSpy = spyOn(SessionPrompt, "prompt").mockRejectedValue(
          new Error("prompt failed with sk-test-token"),
        )

        try {
          const res = await Server.Default().request(`/session/${session.id}/message`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              parts: [{ type: "text", text: "hello" }],
            }),
          })

          expect(res.status).toBe(500)
          const body = (await res.json()) as {
            name: string
            message: string
            status: number
            logRef?: string
          }
          expect(body.name).toBe("UnknownError")
          expect(body.message).toBe("Internal server error")
          expect(body.status).toBe(500)
          expect(body.logRef).toMatch(/^err_/)
          expect(JSON.stringify(body)).not.toContain("prompt failed")
          expect(JSON.stringify(body)).not.toContain("sk-test-token")
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

          const body = (await res.json()) as {
            name: string
            message: string
            status: number
          }
          expect(res.status).toBe(400)
          expect(body).toMatchObject({
            name: "InvalidRequestError",
            message: "Part identifiers do not match the request path",
            status: 400,
          })
          const text = JSON.stringify(body)
          expect(text).not.toContain(String(partID))
          expect(text).not.toContain(String(messageID))
          expect(text).not.toContain(String(session.id))
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })

  test("missing session route returns a session not found envelope", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const missingID = SessionID.descending()
        const res = await Server.Default().request(`/session/${missingID}`)

        expect(res.status).toBe(404)
        expect(await res.json()).toMatchObject({
          name: "SessionNotFoundError",
          message: "Session not found",
          status: 404,
          details: { resource: "session" },
        })
      },
    })
  })

  test("session update route round-trips valid product metadata and rejects invalid reserved metadata", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        try {
          const valid = await Server.Default().request(`/session/${session.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              metadata: {
                app: { pinned: true, label: "Pinned run" },
                queue: { queueItemId: "task_1", source: "manual" },
                custom: { keep: true },
              },
            }),
          })

          expect(valid.status).toBe(200)
          const body = (await valid.json()) as Session.Info
          expect(body.metadata).toEqual({
            app: { pinned: true, label: "Pinned run" },
            queue: { queueItemId: "task_1", source: "manual" },
            custom: { keep: true },
          })

          const invalid = await Server.Default().request(`/session/${session.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              metadata: {
                queue: { source: "daemon" },
              },
            }),
          })

          expect(invalid.status).toBe(400)
          expect(await invalid.json()).toMatchObject({
            name: "InvalidRequestError",
            status: 400,
          })
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })

  test("busy session route returns a retryable busy envelope", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const sessionID = SessionID.descending()
        const busySpy = spyOn(SessionPrompt, "assertNotBusy").mockImplementation(() => {
          throw new Session.BusyError(sessionID)
        })

        try {
          const res = await Server.Default().request(`/session/${sessionID}/summarize`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              providerID: "test",
              modelID: "test",
            }),
          })

          expect(res.status).toBe(409)
          expect(await res.json()).toMatchObject({
            name: "SessionBusyError",
            message: "Session is busy",
            status: 409,
            retryable: true,
            details: { resource: "session" },
          })
        } finally {
          busySpy.mockRestore()
        }
      },
    })
  })

  test("direct route failures use structured envelopes", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const auth = await Server.Default().request("/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "test", config: { type: "local", command: ["echo"] } }),
        })
        expect(auth.status).toBe(403)
        expect(await auth.json()).toMatchObject({
          name: "InvalidRequestError",
          message: "Runtime authorization required",
          status: 403,
        })

        const previousAutonomous = process.env.AX_CODE_AUTONOMOUS
        process.env.AX_CODE_AUTONOMOUS = "false"
        try {
          const superLong = await Server.Default().request("/super-long", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled: true }),
          })
          expect(superLong.status).toBe(409)
          expect(await superLong.json()).toMatchObject({
            name: "ServiceUnavailableError",
            status: 409,
            details: { resource: "superLong" },
          })
        } finally {
          if (previousAutonomous === undefined) delete process.env.AX_CODE_AUTONOMOUS
          else process.env.AX_CODE_AUTONOMOUS = previousAutonomous
        }
      },
    })
  })

  test("permission and question routes expose unavailable envelopes for stale requests", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const permission = await Server.Default().request(`/permission/${PermissionID.ascending()}/reply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reply: "once" }),
        })
        expect(permission.status).toBe(404)
        expect(await permission.json()).toMatchObject({
          name: "PermissionUnavailableError",
          message: "Permission request is unavailable",
          status: 404,
          details: { resource: "permission" },
        })

        const question = await Server.Default().request(`/question/${QuestionID.ascending()}/reply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answers: [] }),
        })
        expect(question.status).toBe(404)
        expect(await question.json()).toMatchObject({
          name: "QuestionUnavailableError",
          message: "Question request is unavailable",
          status: 404,
          details: { resource: "question" },
        })
      },
    })
  })

  test("plain server errors map explicit unavailable families without leaking details", () => {
    expect(appErrorEnvelope({ error: new Error("Tool custom_tool is unavailable: sk-test-token") })).toMatchObject({
      name: "ToolUnavailableError",
      message: "Tool is unavailable",
      status: 409,
      details: { resource: "tool" },
    })
    expect(appErrorEnvelope({ error: new Error("No LSP server available for this file type.") })).toMatchObject({
      name: "LspUnavailableError",
      message: "No LSP server available",
      status: 409,
      details: { resource: "lsp" },
    })
    expect(appErrorEnvelope({ error: new Error("MCP server not found: private-mcp") })).toMatchObject({
      name: "McpServerNotFoundError",
      message: "McpServer not found",
      status: 404,
      details: { resource: "mcpServer" },
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
      expect(await res.json()).toMatchObject({
        name: "InvalidRequestError",
        message: "Directory is not allowed",
        status: 400,
        details: { resource: "directory" },
      })
    } finally {
      homedir.mockRestore()
      await fs.rm(home, { recursive: true, force: true })
    }
  })
})
