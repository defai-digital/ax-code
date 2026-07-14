import path from "path"
import fs from "fs/promises"
import os from "os"
import { afterEach, describe, expect, test, vi } from "vitest"
import z from "zod"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRollback } from "../../src/session/rollback"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import { ServerRuntimeAuth } from "../../src/server/runtime-auth"
import { PermissionID } from "../../src/permission/schema"
import { Question } from "../../src/question"
import { QuestionID } from "../../src/question/schema"
import { appErrorEnvelope } from "../../src/server/error"
import { DefaultQueryNumber, OptionalQueryNumber } from "../../src/server/routes/query"
import { parsePtyReconnectCursor } from "../../src/server/routes/pty"
import { File } from "../../src/file"
import { MCP } from "../../src/mcp"

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
        const promptSpy = vi
          .spyOn(SessionPrompt, "prompt")
          .mockRejectedValue(new Error("prompt failed with sk-test-token"))

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

  test("session move validation accepts an existing target inside the current project", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        try {
          const res = await Server.Default().request(`/session/${session.id}/move/validate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              targetDirectory: "src",
            }),
          })

          expect(res.status).toBe(200)
          const body = (await res.json()) as {
            valid: boolean
            reason: string
            current: { directory: string; projectID: string; worktree: string }
            target: {
              directory: string
              exists: boolean
              isDirectory: boolean
              sameDirectory: boolean
              withinCurrentProject: boolean
              git: { worktree: string | null; branch: string | null; dirty: boolean | null }
            }
          }
          expect(body.valid).toBe(true)
          expect(body.reason).toBe("ok")
          expect(body.current.directory).toBe(root)
          expect(body.target).toMatchObject({
            directory: path.join(root, "src"),
            exists: true,
            isDirectory: true,
            sameDirectory: false,
            withinCurrentProject: true,
          })
          expect(body.target.git.worktree).toBe(path.resolve(root, "../.."))
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })

  test("session move validation returns a typed result for a missing target", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const targetDirectory = path.join(os.tmpdir(), `ax-code-missing-move-target-${process.pid}-${Date.now()}`)
        try {
          const res = await Server.Default().request(`/session/${session.id}/move/validate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ targetDirectory }),
          })

          expect(res.status).toBe(200)
          expect(await res.json()).toMatchObject({
            valid: false,
            reason: "target_missing",
            target: {
              directory: targetDirectory,
              exists: false,
              isDirectory: false,
              sameDirectory: false,
              withinCurrentProject: false,
              git: { worktree: null, branch: null, dirty: null },
            },
          })
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })

  test("session move route updates the session directory after validation", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const targetDirectory = path.join(root, "src")
        try {
          const res = await Server.Default().request(`/session/${session.id}/move`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ targetDirectory }),
          })

          expect(res.status).toBe(200)
          expect(await res.json()).toMatchObject({
            id: session.id,
            directory: targetDirectory,
          })
          expect((await Session.get(session.id)).directory).toBe(targetDirectory)
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })

  test("session move route rejects an invalid target without changing the session", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const targetDirectory = path.join(os.tmpdir(), `ax-code-invalid-move-target-${process.pid}-${Date.now()}`)
        try {
          const res = await Server.Default().request(`/session/${session.id}/move`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ targetDirectory }),
          })

          expect(res.status).toBe(400)
          expect(await res.json()).toMatchObject({
            name: "InvalidRequestError",
            message: "Invalid session move target",
            status: 400,
            details: {
              resource: "sessionMoveTarget",
              reason: "target_missing",
              validation: {
                valid: false,
                reason: "target_missing",
              },
            },
          })
          expect((await Session.get(session.id)).directory).toBe(root)
        } finally {
          await Session.remove(session.id)
        }
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
        const session = await Session.create({})
        const busySpy = vi.spyOn(SessionPrompt, "assertNotBusy").mockImplementation(() => {
          throw new Session.BusyError(session.id)
        })

        try {
          const res = await Server.Default().request(`/session/${session.id}/summarize`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              providerID: "test",
              modelID: "test",
              auto: "false",
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
          await Session.remove(session.id)
        }
      },
    })
  })

  test("session rollback route applies a selected rollback point", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const point = {
          step: 2,
          messageID: MessageID.ascending(),
          partID: PartID.ascending(),
          tools: ["edit: src/app.ts"],
          kinds: ["edit"],
        } satisfies SessionRollback.Point
        const pointsSpy = vi.spyOn(SessionRollback, "points").mockResolvedValue([point])
        const applySpy = vi.spyOn(SessionRollback, "apply").mockResolvedValue(session)

        try {
          const res = await Server.Default().request(`/session/${session.id}/rollback`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ step: 2 }),
          })

          expect(res.status).toBe(200)
          expect(applySpy).toHaveBeenCalledWith({
            sessionID: session.id,
            messageID: point.messageID,
            partID: point.partID,
          })
          expect(await res.json()).toMatchObject({ id: session.id })
        } finally {
          pointsSpy.mockRestore()
          applySpy.mockRestore()
          await Session.remove(session.id)
        }
      },
    })
  })

  test("session rollback preview route returns selected point and diff summary without applying", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const preview = {
          point: {
            step: 3,
            messageID: MessageID.ascending(),
            partID: PartID.ascending(),
            tools: ["write: src/app.ts"],
            kinds: ["write"],
          },
          diffs: [
            {
              file: "src/app.ts",
              before: "old",
              after: "new",
              additions: 1,
              deletions: 1,
              status: "modified" as const,
            },
          ],
          summary: { files: 1, additions: 1, deletions: 1 },
        } satisfies SessionRollback.PreviewResult
        const previewSpy = vi.spyOn(SessionRollback, "preview").mockResolvedValue(preview)
        const applySpy = vi.spyOn(SessionRollback, "apply")

        try {
          const res = await Server.Default().request(`/session/${session.id}/rollback/preview`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ step: 3 }),
          })

          expect(res.status).toBe(200)
          expect(previewSpy).toHaveBeenCalledWith({ sessionID: session.id, step: 3 })
          expect(applySpy).not.toHaveBeenCalled()
          expect(await res.json()).toMatchObject({
            point: { step: 3 },
            diffs: [{ file: "src/app.ts", additions: 1, deletions: 1 }],
            summary: { files: 1, additions: 1, deletions: 1 },
          })
        } finally {
          previewSpy.mockRestore()
          applySpy.mockRestore()
          await Session.remove(session.id)
        }
      },
    })
  })

  test("session rollback route returns a typed 404 when the point is missing", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const pointsSpy = vi.spyOn(SessionRollback, "points").mockResolvedValue([])
        const applySpy = vi.spyOn(SessionRollback, "apply")

        try {
          const res = await Server.Default().request(`/session/${session.id}/rollback`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ step: 99 }),
          })

          expect(res.status).toBe(404)
          expect(await res.json()).toMatchObject({
            name: "SessionRollbackPointNotFoundError",
            message: "Rollback point not found",
            status: 404,
            details: { resource: "rollbackPoint" },
          })
          expect(applySpy).not.toHaveBeenCalled()
        } finally {
          pointsSpy.mockRestore()
          applySpy.mockRestore()
          await Session.remove(session.id)
        }
      },
    })
  })

  test("session rollback preview route returns a typed 404 when the point is missing", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const previewSpy = vi.spyOn(SessionRollback, "preview").mockResolvedValue(undefined)
        const applySpy = vi.spyOn(SessionRollback, "apply")

        try {
          const res = await Server.Default().request(`/session/${session.id}/rollback/preview`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ step: 99 }),
          })

          expect(res.status).toBe(404)
          expect(await res.json()).toMatchObject({
            name: "SessionRollbackPointNotFoundError",
            message: "Rollback point not found",
            status: 404,
            details: { resource: "rollbackPoint" },
          })
          expect(applySpy).not.toHaveBeenCalled()
        } finally {
          previewSpy.mockRestore()
          applySpy.mockRestore()
          await Session.remove(session.id)
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

  test("question reply route normalizes accepted answers before resolving", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const askPromise = Question.ask({
          sessionID: SessionID.ascending(),
          questions: [
            {
              question: "Which option should be used?",
              header: "Choice",
              options: [
                { label: "Option 1", description: "First option" },
                { label: "Option 2", description: "Second option" },
              ],
              custom: false,
            },
          ],
        })

        try {
          let pending = await Question.list()
          for (let attempt = 0; pending.length === 0 && attempt < 10; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 1))
            pending = await Question.list()
          }
          expect(pending.length).toBe(1)

          const response = await Server.Default().request(`/question/${pending[0].id}/reply`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ answers: [["  Option 1  "]] }),
          })

          expect(response.status).toBe(200)
          expect(await response.json()).toBe(true)
          await expect(askPromise).resolves.toEqual([["Option 1"]])
        } catch (error) {
          const remaining = (await Question.list())[0]
          if (remaining) {
            await Question.reject(remaining.id).catch(() => {})
          }
          await askPromise.catch(() => {})
          throw error
        }
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

  test("command not found NamedError maps to 400 with the real message", async () => {
    const { NamedError } = await import("@ax-code/util/error")
    const err = new NamedError.Unknown({
      message: 'Command not found: "arena". Available commands: init, review, council',
    })
    expect(appErrorEnvelope({ error: err })).toMatchObject({
      name: "InvalidRequestError",
      message: 'Command not found: "arena". Available commands: init, review, council',
      status: 400,
      details: { resource: "command" },
      retryable: false,
    })
  })

  test("command requires argument NamedError maps to 400", async () => {
    const { NamedError } = await import("@ax-code/util/error")
    const err = new NamedError.Unknown({
      message: 'Command "goal" requires an argument. Usage: /goal <argument>',
    })
    expect(appErrorEnvelope({ error: err })).toMatchObject({
      name: "InvalidRequestError",
      status: 400,
      details: { resource: "command" },
    })
  })

  test("revert and unrevert routes assert that the session is not busy", async () => {
    const src = await fs.readFile(path.join(import.meta.dirname, "../../src/server/routes/session-impl.ts"), "utf-8")
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

  test("session list rejects invalid timestamp cursors", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const sessionNegative = await Server.Default().request("/session?start=-1")
        const sessionFractional = await Server.Default().request("/session?start=1.5")
        const globalNegative = await Server.Default().request("/experimental/session?start=-1")
        const globalFractional = await Server.Default().request("/experimental/session?cursor=1.5")

        expect(sessionNegative.status).toBe(400)
        expect(sessionFractional.status).toBe(400)
        expect(globalNegative.status).toBe(400)
        expect(globalFractional.status).toBe(400)
      },
    })
  })

  test("experimental session list treats bare numeric query keys as omitted", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        let globalListInput: Parameters<typeof Session.listGlobal>[0]
        const globalListSpy = vi.spyOn(Session, "listGlobal").mockImplementation(function* (input) {
          globalListInput = input
        } as typeof Session.listGlobal)

        try {
          const res = await Server.Default().request("/experimental/session?start&cursor&limit")

          expect(res.status).toBe(200)
          expect(globalListInput?.start).toBeUndefined()
          expect(globalListInput?.cursor).toBeUndefined()
          expect(globalListInput?.limit).toBe(101)
        } finally {
          globalListSpy.mockRestore()
        }
      },
    })
  })

  test("session list treats bare numeric query keys as omitted", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        let sessionListInput: Parameters<typeof Session.list>[0]
        const sessionListSpy = vi.spyOn(Session, "list").mockImplementation(function* (input) {
          sessionListInput = input
        } as typeof Session.list)

        try {
          const res = await Server.Default().request("/session?start&limit")

          expect(res.status).toBe(200)
          expect(sessionListInput?.start).toBeUndefined()
          expect(sessionListInput?.limit).toBeUndefined()
        } finally {
          sessionListSpy.mockRestore()
        }
      },
    })
  })

  test("session list query booleans parse explicit false values", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        let sessionListInput: Parameters<typeof Session.list>[0]
        let globalListInput: Parameters<typeof Session.listGlobal>[0]
        const sessionListSpy = vi.spyOn(Session, "list").mockImplementation(function* (input) {
          sessionListInput = input
        } as typeof Session.list)
        const globalListSpy = vi.spyOn(Session, "listGlobal").mockImplementation(function* (input) {
          globalListInput = input
        } as typeof Session.listGlobal)

        try {
          const sessionRes = await Server.Default().request("/session?roots=false")
          const globalRes = await Server.Default().request("/experimental/session?roots=false&archived=false")

          expect(sessionRes.status).toBe(200)
          expect(globalRes.status).toBe(200)
          expect(sessionListInput?.directory).toBe(root)
          expect(sessionListInput?.roots).toBe(false)
          expect(globalListInput?.directory).toBeUndefined()
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

  test("mcp add rejects local configs without an executable", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const emptyCommand = await Server.Default().request("/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", ...ServerRuntimeAuth.headers() },
          body: JSON.stringify({
            name: "local",
            config: {
              type: "local",
              command: [],
            },
          }),
        })
        expect(emptyCommand.status).toBe(400)

        const blankExecutable = await Server.Default().request("/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", ...ServerRuntimeAuth.headers() },
          body: JSON.stringify({
            name: "local",
            config: {
              type: "local",
              command: ["   "],
            },
          }),
        })
        expect(blankExecutable.status).toBe(400)
      },
    })
  })

  test("mcp add rejects remote configs with invalid URLs", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const invalidUrl = await Server.Default().request("/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", ...ServerRuntimeAuth.headers() },
          body: JSON.stringify({
            name: "remote",
            config: {
              type: "remote",
              url: "not a url",
            },
          }),
        })
        expect(invalidUrl.status).toBe(400)

        const nonHttpUrl = await Server.Default().request("/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", ...ServerRuntimeAuth.headers() },
          body: JSON.stringify({
            name: "remote",
            config: {
              type: "remote",
              url: "file:///tmp/mcp.sock",
            },
          }),
        })
        expect(nonHttpUrl.status).toBe(400)
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

  test("mcp resource routes list and read connected resources", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const resourcesSpy = vi.spyOn(MCP, "resources").mockResolvedValue({
          "docs:readme": {
            client: "docs",
            name: "readme",
            uri: "mcp://docs/readme.md",
            mimeType: "text/markdown",
          },
        })
        const readSpy = vi.spyOn(MCP, "readResource").mockResolvedValue({
          contents: [
            {
              uri: "mcp://docs/readme.md",
              mimeType: "text/markdown",
              text: "# README",
            },
          ],
        } as Awaited<ReturnType<typeof MCP.readResource>>)

        try {
          const list = await Server.Default().request("/mcp/resources")
          expect(list.status).toBe(200)
          expect(await list.json()).toMatchObject({
            "docs:readme": {
              client: "docs",
              name: "readme",
              uri: "mcp://docs/readme.md",
            },
          })

          const read = await Server.Default().request(
            `/mcp/docs/resource?uri=${encodeURIComponent("mcp://docs/readme.md")}`,
          )
          expect(read.status).toBe(200)
          expect(readSpy).toHaveBeenCalledWith("docs", "mcp://docs/readme.md")
          expect(await read.json()).toMatchObject({
            contents: [{ text: "# README" }],
          })
        } finally {
          resourcesSpy.mockRestore()
          readSpy.mockRestore()
        }
      },
    })
  })

  test("mcp resource read returns not found when the runtime has no resource contents", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const readSpy = vi.spyOn(MCP, "readResource").mockResolvedValue(undefined)

        try {
          const res = await Server.Default().request(
            `/mcp/docs/resource?uri=${encodeURIComponent("mcp://docs/missing.md")}`,
          )
          expect(res.status).toBe(404)
          expect(await res.json()).toMatchObject({
            name: "NotFoundError",
            message: "MCP resource not found",
            details: { resource: "mcpResource" },
          })
        } finally {
          readSpy.mockRestore()
        }
      },
    })
  })

  test("audit replay rejects non-integer fromStep values", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        try {
          const fractional = await Server.Default().request(`/audit/replay/${session.id}?fromStep=0.5`)
          expect(fractional.status).toBe(400)

          const negative = await Server.Default().request(`/audit/replay/${session.id}?fromStep=-1`)
          expect(negative.status).toBe(400)
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })

  test("pty websocket route closes failed connects instead of leaving an unhandled async open", async () => {
    const src = await fs.readFile(path.join(import.meta.dirname, "../../src/server/routes/pty.ts"), "utf-8")
    expect(src).toContain("try {")
    expect(src).toContain("handler = await Pty.connect(id, socket, cursor)")
    expect(src).toContain("ws.close()")
  })

  test("pty websocket route reports missing sessions as not found", async () => {
    const src = await fs.readFile(path.join(import.meta.dirname, "../../src/server/routes/pty.ts"), "utf-8")
    expect(src).toContain('throw new NotFoundError({ message: "Session not found" })')
    expect(src).not.toContain('throw new Error("Session not found")')
  })

  test("pty reconnect cursor accepts only decimal integers", () => {
    expect(parsePtyReconnectCursor(undefined)).toBeUndefined()
    expect(parsePtyReconnectCursor("")).toBeUndefined()
    expect(parsePtyReconnectCursor("  ")).toBeUndefined()
    expect(parsePtyReconnectCursor("-1")).toBe(-1)
    expect(parsePtyReconnectCursor("0")).toBe(0)
    expect(parsePtyReconnectCursor(" 42 ")).toBe(42)
    expect(parsePtyReconnectCursor("42")).toBe(42)
    expect(parsePtyReconnectCursor("-2")).toBeUndefined()
    expect(parsePtyReconnectCursor("1.5")).toBeUndefined()
    expect(parsePtyReconnectCursor("1e3")).toBeUndefined()
    expect(parsePtyReconnectCursor("0x10")).toBeUndefined()
  })

  test("sse stop handlers always close their queues even if unsubscribe throws", async () => {
    const eventSrc = await fs.readFile(path.join(import.meta.dirname, "../../src/server/routes/event.ts"), "utf-8")
    const globalSrc = await fs.readFile(path.join(import.meta.dirname, "../../src/server/routes/global.ts"), "utf-8")
    expect(eventSrc).toContain("} finally {")
    expect(eventSrc).toContain("q.push(null)")
    expect(globalSrc).toContain("} finally {")
    expect(globalSrc).toContain("q.push(null)")
  })

  test("event stream only forwards bus events from the current project", async () => {
    const eventSrc = await fs.readFile(path.join(import.meta.dirname, "../../src/server/routes/event.ts"), "utf-8")
    expect(eventSrc).toContain("const shouldForward")
    expect(eventSrc).toContain("directory === undefined || directory === Instance.directory")
    expect(eventSrc).toMatch(/Bus\.subscribeAll\(\(event\) => \{\s*if \(!shouldForward\(event\)\) return/)
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
    const homedir = vi.spyOn(os, "homedir").mockReturnValue(home)

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

  test("session list query booleans parse bare flags as true", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        let sessionListInput: Parameters<typeof Session.list>[0]
        let globalListInput: Parameters<typeof Session.listGlobal>[0]
        const sessionListSpy = vi.spyOn(Session, "list").mockImplementation(function* (input) {
          sessionListInput = input
        } as typeof Session.list)
        const globalListSpy = vi.spyOn(Session, "listGlobal").mockImplementation(function* (input) {
          globalListInput = input
        } as typeof Session.listGlobal)

        try {
          const sessionRes = await Server.Default().request("/session?roots")
          const globalRes = await Server.Default().request("/experimental/session?roots&archived")

          expect(sessionRes.status).toBe(200)
          expect(globalRes.status).toBe(200)
          expect(sessionListInput?.directory).toBe(root)
          expect(sessionListInput?.roots).toBe(true)
          expect(globalListInput?.directory).toBeUndefined()
          expect(globalListInput?.roots).toBe(true)
          expect(globalListInput?.archived).toBe(true)

          const emptyDirectoryRes = await Server.Default().request("/experimental/session?directory=")

          expect(emptyDirectoryRes.status).toBe(200)
          expect(globalListInput?.directory).toBeUndefined()
        } finally {
          sessionListSpy.mockRestore()
          globalListSpy.mockRestore()
        }
      },
    })
  })

  test("optional query numbers treat bare keys as omitted", async () => {
    const optional = OptionalQueryNumber(z.number().int().positive())
    const defaulted = DefaultQueryNumber(z.number().int().positive(), 25)

    expect(optional.isOptional()).toBe(true)
    expect(optional.parse("")).toBeUndefined()
    expect(optional.parse(undefined)).toBeUndefined()
    expect(optional.parse("10")).toBe(10)
    expect(defaulted.isOptional()).toBe(true)
    expect(defaulted.parse("")).toBe(25)
    expect(defaulted.parse(undefined)).toBe(25)
    expect(defaulted.parse("10")).toBe(10)
    expect(optional.safeParse("abc").success).toBe(false)
    expect(optional.safeParse("0x10").success).toBe(false)
    expect(optional.safeParse("1e3").success).toBe(false)

    const searchSpy = vi.spyOn(File, "search").mockResolvedValue(["package.json"])

    try {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const bare = await Server.Default().request("/find/file?query=package&limit")
          expect(bare.status).toBe(200)

          const numeric = await Server.Default().request("/find/file?query=package&limit=1")
          expect(numeric.status).toBe(200)

          const invalid = await Server.Default().request("/find/file?query=package&limit=abc")
          expect(invalid.status).toBe(400)

          expect(searchSpy).toHaveBeenCalledTimes(2)
          expect(searchSpy).toHaveBeenNthCalledWith(1, {
            query: "package",
            limit: 10,
            dirs: true,
            type: undefined,
          })
          expect(searchSpy).toHaveBeenNthCalledWith(2, {
            query: "package",
            limit: 1,
            dirs: true,
            type: undefined,
          })
        },
      })
    } finally {
      searchSpy.mockRestore()
    }
  })
})
