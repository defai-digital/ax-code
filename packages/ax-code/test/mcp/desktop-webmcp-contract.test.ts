import { expect, test, vi } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdir, symlink } from "node:fs/promises"
import path from "node:path"
import { Hono } from "hono"
import { Ajv } from "@modelcontextprotocol/client/validators/ajv"
const { token } = vi.hoisted(() => {
  const token = (globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replaceAll("-", "").slice(0, 43)
  process.env.AX_CODE_DESKTOP_BROWSER_TOKEN = token
  return { token }
})
import { DesktopBrowser } from "@/mcp/desktop-browser"
import { DesktopBrowserRoutes } from "@/server/routes/desktop-browser"
import { DesktopWebMcpTool } from "@/tool/desktop_webmcp"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { Database, eq } from "@/storage/db"
import { SessionTable } from "@/session/session.sql"
import { Permission } from "@/permission"
import { Bus } from "@/bus"
import { MessageID } from "@/session/schema"
import type { Tool } from "@/tool/tool"
import { tmpdir } from "../fixture/fixture"

const REASONS = [
  "no-page",
  "page-changed",
  "tool-not-found",
  "definition-changed",
  "invalid-input",
  "provider-gone",
  "timeout",
  "session-rejected",
  "native-failure",
] as const

const shaped = (extra: Partial<DesktopBrowser.Snapshot> = {}): DesktopBrowser.Snapshot => ({
  generation: randomUUID(),
  origin: "https://example.com",
  frameId: "top",
  tools: [
    {
      name: "echo",
      description: "Return fixture data",
      frameId: "top",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" }, count: { type: "integer" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  ],
  ...extra,
})

async function withSession(fn: (session: Session.Info, state: DesktopBrowser.Snapshot) => Promise<void>) {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => fn(await Session.create({}), shaped()),
  })
  await Instance.disposeAll()
}

function ctxFor(sessionID: Session.Info["id"], metadata: Tool.Context["metadata"] = () => {}): Tool.Context {
  return {
    sessionID,
    messageID: MessageID.ascending(),
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata,
    ask: async () => {},
  }
}

function rejection(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error("expected a rejection")
    },
    (error: unknown) => error as InstanceType<typeof DesktopBrowser.Failure>,
  )
}

test("invoke permission metadata previews the detached input and keeps always empty", async () => {
  // Full-access Auto admits a bound invoke without a prompt. Turn it off so the
  // permission request, and only that request, is what carries the preview.
  vi.stubEnv("AX_CODE_AUTONOMOUS", "0")
  try {
    await withSession(async (session, state) => {
      // Extra keys are display-only secrets. A strict schema would reject them before permission.
      state.tools[0]!.inputSchema = { type: "object" }
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const tool = await DesktopWebMcpTool.init()
      const asked: Permission.Request[] = []
      const stop = Bus.subscribe(Permission.Event.Asked, (event) => {
        asked.push(event.properties)
        void Permission.reply({ requestID: event.properties.id, reply: "once" })
      })
      const secret = "super-secret-value"
      const nested = "nested-secret"
      const input = {
        query: "visible",
        sessionKey: secret,
        profile: { access_token: nested },
        keyboard: "visible-key",
        note: "n".repeat(4000),
      }
      const ctx = ctxFor(session.id)
      ctx.ask = (request) => Permission.ask({ ...request, sessionID: session.id, ruleset: [] })
      const execution = tool.execute(
        { action: "invoke", toolName: "echo", digest: DesktopBrowser.digest(state.tools[0]!), input },
        ctx,
      )
      try {
        await vi.waitFor(() => expect(asked).toHaveLength(1))
        expect(asked[0]!.always).toEqual([])
        const preview = asked[0]!.metadata.inputPreview
        expect(typeof preview).toBe("string")
        expect(Buffer.byteLength(preview, "utf8")).toBeLessThanOrEqual(2048)
        expect(preview).toContain("[redacted]")
        expect(preview).toContain("visible-key")
        expect(preview).not.toContain(secret)
        expect(preview).not.toContain(nested)
        const marker = preview.match(/… \((\d+) bytes, (\d+) not shown\)$/)
        expect(marker).toBeTruthy()
        const total = Number(marker![1])
        const dropped = Number(marker![2])
        const shown = Buffer.byteLength(preview, "utf8") - Buffer.byteLength(marker![0], "utf8")
        expect(total).toBeGreaterThan(2048)
        expect(dropped).toBe(total - shown)
        expect(dropped).toBeGreaterThan(0)
        const batch = await DesktopBrowser.poll(connection.providerID, ctx.abort)
        expect(batch.request?.operation).toBe("invoke")
        expect(batch.request && "input" in batch.request ? batch.request.input : undefined).toMatchObject({
          query: "visible",
          sessionKey: secret,
          profile: { access_token: nested },
        })
        DesktopBrowser.respond(connection.providerID, {
          requestID: batch.request!.requestID,
          generation: state.generation,
          status: "Completed",
          output: { ok: true },
        })
        await execution
      } finally {
        stop()
        void execution.catch(() => {})
        DesktopBrowser.disconnect(connection.providerID)
      }
    })
  } finally {
    vi.unstubAllEnvs()
  }
})

test("failures carry a closed reason, the human message, nextAction, and tool metadata", async () => {
  await withSession(async (session, state) => {
    const metadata = vi.fn()
    const tool = await DesktopWebMcpTool.init()
    const missing = await rejection(tool.execute({ action: "list" }, ctxFor(session.id, metadata)))
    expect(REASONS).toContain(missing.data.reason)
    expect(missing.data.reason).toBe("provider-gone")
    expect(missing.message).toContain("Ask the user to enable agent access")
    expect(missing.message).toBe(missing.data.message)
    expect(missing.data.nextAction).toMatch(/^[^\n]+$/)
    expect(metadata).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ reason: "provider-gone", nextAction: missing.data.nextAction }),
      }),
    )

    const connection = await DesktopBrowser.enroll({
      sessionID: session.id,
      snapshot: { ...state, origin: null, tools: [] },
    })
    const blank = (() => {
      try {
        DesktopBrowser.forSession(session.id)
      } catch (error) {
        return error as InstanceType<typeof DesktopBrowser.Failure>
      }
      throw new Error("expected no-page")
    })()
    expect(blank.data.reason).toBe("no-page")
    expect(blank.data.nextAction).toContain("action=navigate")
    DesktopBrowser.disconnect(connection.providerID)

    const enrolled = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
    const binding = DesktopBrowser.forSession(session.id)
    const unknownTool = await rejection(
      tool.execute(
        {
          action: "invoke",
          toolName: "missing",
          digest: DesktopBrowser.digest(state.tools[0]!),
          input: { query: "a" },
        },
        ctxFor(session.id),
      ),
    )
    expect(unknownTool.data.reason).toBe("tool-not-found")
    expect(unknownTool.data.nextAction.length).toBeGreaterThan(0)

    const changed = await rejection(
      DesktopBrowser.invoke(binding, "echo", "0".repeat(64), { query: "a" }, new AbortController().signal),
    )
    expect(changed.data.reason).toBe("definition-changed")
    expect(changed.data.message).toContain("Tool definition changed")

    const controller = new AbortController()
    const pending = DesktopBrowser.invoke(
      binding,
      "echo",
      DesktopBrowser.digest(state.tools[0]!),
      { query: "a" },
      controller.signal,
    )
    const queued = await DesktopBrowser.poll(enrolled.providerID, new AbortController().signal)
    controller.abort()
    const timed = await rejection(pending)
    expect(timed.data.reason).toBe("timeout")
    expect(timed.data.nextAction).not.toContain("\n")
    expect(queued.request?.requestID).toBeTruthy()
    await DesktopBrowser.poll(enrolled.providerID, new AbortController().signal)

    const native = DesktopBrowser.invoke(
      DesktopBrowser.forSession(session.id),
      "echo",
      DesktopBrowser.digest(state.tools[0]!),
      { query: "a" },
      new AbortController().signal,
    )
    const batch = await DesktopBrowser.poll(enrolled.providerID, new AbortController().signal)
    DesktopBrowser.respond(enrolled.providerID, {
      requestID: batch.request!.requestID,
      generation: state.generation,
      status: "Error",
    })
    const nativeError = await rejection(native)
    expect(nativeError.data.reason).toBe("native-failure")
    expect(nativeError.data.message).toContain("do not retry automatically")

    const leaked = "leaked-input-value"
    vi.spyOn(DesktopBrowser, "list").mockRejectedValueOnce(new Error(`boom ${leaked}`))
    const recorded = vi.fn()
    const asking = ctxFor(session.id, recorded)
    asking.ask = async () => {}
    const unknown = await rejection(tool.execute({ action: "list" }, asking))
    expect(unknown.data.reason).toBe("native-failure")
    expect(JSON.stringify(unknown.toObject())).not.toContain(leaked)
    expect(recorded.mock.calls[0]?.[0].metadata.reason).toBe("native-failure")
    DesktopBrowser.disconnect(enrolled.providerID)
  })
})

test("list templates an invoke and schema failures happen before permission", async () => {
  await withSession(async (session, state) => {
    const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
    const listed = DesktopBrowser.list(DesktopBrowser.forSession(session.id), new AbortController().signal)
    const batch = await DesktopBrowser.poll(connection.providerID, new AbortController().signal)
    DesktopBrowser.respond(connection.providerID, {
      requestID: batch.request!.requestID,
      generation: state.generation,
      status: "Completed",
      snapshot: state,
    })
    const catalog = await listed
    expect(catalog[0]?.invoke).toEqual({
      action: "invoke",
      toolName: "echo",
      digest: DesktopBrowser.digest(state.tools[0]!),
      input: { query: "" },
    })

    const tool = await DesktopWebMcpTool.init()
    const ask = vi.fn(async () => {})
    const metadata = vi.fn()
    const ctx = ctxFor(session.id, metadata)
    ctx.ask = ask
    const invalid = await rejection(
      tool.execute(
        { action: "invoke", toolName: "echo", digest: DesktopBrowser.digest(state.tools[0]!), input: { query: 1 } },
        ctx,
      ),
    )
    expect(invalid.data.reason).toBe("invalid-input")
    expect(invalid.data.path).toBe("/query")
    expect(invalid.data.message).toContain("/query")
    expect(invalid.data.nextAction).toMatch(/^[^\n]+\.$/)
    expect(ask).not.toHaveBeenCalled()
    expect(metadata).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ reason: "invalid-input", path: "/query" }),
      }),
    )
    DesktopBrowser.disconnect(connection.providerID)
  })
})

test("enrollment requires an existing session in the normalized enrolling directory", async () => {
  await using home = await tmpdir({ git: true })
  await using elsewhere = await tmpdir({ git: true })
  const link = path.join(elsewhere.path, "same-directory")
  await symlink(home.path, link)
  const state = shaped()
  await Instance.provide({
    directory: home.path,
    fn: async () => {
      const session = await Session.create({})
      await Session.setDirectory({ sessionID: session.id, directory: path.join(home.path, "missing", "..") })
      const dotted = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      DesktopBrowser.disconnect(dotted.providerID)

      await Session.setDirectory({ sessionID: session.id, directory: link })
      const linked = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      DesktopBrowser.disconnect(linked.providerID)

      const nested = path.join(home.path, "nested")
      await mkdir(nested)
      await Session.setDirectory({ sessionID: session.id, directory: nested })
      const moved = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      DesktopBrowser.disconnect(moved.providerID)

      const sandbox = path.join(elsewhere.path, "sandbox")
      await mkdir(sandbox)
      await Project.addSandbox(Instance.project.id, sandbox)
      await Session.setDirectory({ sessionID: session.id, directory: sandbox })
      const sandboxed = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      DesktopBrowser.disconnect(sandboxed.providerID)

      await Session.setDirectory({ sessionID: session.id, directory: path.dirname(home.path) })
      await expect(DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })).rejects.toMatchObject({
        data: { reason: "session-rejected", message: "Session belongs to another project" },
      })

      await Session.setDirectory({ sessionID: session.id, directory: elsewhere.path })
      const outside = await rejection(DesktopBrowser.enroll({ sessionID: session.id, snapshot: state }))
      expect(outside.data.reason).toBe("session-rejected")
      expect(outside.data.message).toBe("Session belongs to another project")
      expect(outside.data.nextAction).toContain(session.id)
      expect(outside.data.nextAction).not.toMatch(/stop and report/i)
      await expect(DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })).rejects.toThrow(/another project/)

      await Session.setDirectory({ sessionID: session.id, directory: home.path })
      const foreign = await Project.fromDirectory(elsewhere.path)
      expect(foreign.project.id).not.toBe(Instance.project.id)
      Database.use((db) => {
        db.update(SessionTable).set({ project_id: foreign.project.id }).where(eq(SessionTable.id, session.id)).run()
      })
      const otherProject = await rejection(DesktopBrowser.enroll({ sessionID: session.id, snapshot: state }))
      expect(otherProject.data.reason).toBe("session-rejected")
      expect(otherProject.data.nextAction).toContain(session.id)
      expect(otherProject.data.message).toBe("Session belongs to another project")

      const missingID = SessionID.ascending()
      const missing = await rejection(DesktopBrowser.enroll({ sessionID: missingID, snapshot: state }))
      expect(missing.data.reason).toBe("session-rejected")
      expect(missing.data.message).toBe("No coding session exists for this browser enrollment")
      expect(missing.data.nextAction).toContain(missingID)
      expect(missing.data.nextAction).not.toMatch(/stop and report/i)

      await Session.setDirectory({ sessionID: session.id, directory: `${home.path}-other` })
      const app = new Hono().route("/desktop/browser", DesktopBrowserRoutes())
      const response = await app.request("/desktop/browser/provider", {
        method: "POST",
        headers: { [DesktopBrowser.HEADER]: token, "content-type": "application/json" },
        body: JSON.stringify({ sessionID: session.id, snapshot: state }),
      })
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.ok).toBe(false)
    },
  })
  await Instance.disposeAll()
})

test("inputPreview marks truncation and redacts concatenated or diacritic secret keys", () => {
  const short = DesktopBrowser.inputPreview({ query: "hi", keyboard: "visible-key", note: "sk-live-secret" })
  expect(short).toBe('{"query":"hi","keyboard":"visible-key","note":"sk-live-secret"}')
  expect(short).not.toContain("…")

  const redacted = DesktopBrowser.inputPreview({
    accesstoken: "access-secret",
    clientsecret: "client-secret",
    bearertoken: "bearer-secret",
    pässword: "dia-secret",
    sessionKey: "session-secret",
    "X-Api-Key": "header-secret",
    api_key: "api-secret",
    keyboard: "visible-key",
    note: "sk-live-secret",
  })
  for (const secret of [
    "access-secret",
    "client-secret",
    "bearer-secret",
    "dia-secret",
    "session-secret",
    "header-secret",
    "api-secret",
  ]) {
    expect(redacted).not.toContain(secret)
  }
  expect(redacted).toContain("[redacted]")
  expect(redacted).toContain("visible-key")
  expect(redacted).toContain("sk-live-secret")

  const preview = DesktopBrowser.inputPreview({ note: "é".repeat(3000) })
  expect(Buffer.byteLength(preview, "utf8")).toBeLessThanOrEqual(2048)
  const marker = preview.match(/… \((\d+) bytes, (\d+) not shown\)$/)
  expect(marker).toBeTruthy()
  const total = Number(marker![1])
  const dropped = Number(marker![2])
  const shown = Buffer.byteLength(preview, "utf8") - Buffer.byteLength(marker![0], "utf8")
  expect(dropped).toBe(total - shown)
  expect(dropped).toBeGreaterThan(0)
  expect(preview).not.toContain("\uFFFD")
})

test("compiled validators are reused until the catalog updates", async () => {
  const compile = vi.spyOn(Ajv.prototype, "compile")
  try {
    await withSession(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const binding = DesktopBrowser.forSession(session.id)
      const digest = DesktopBrowser.digest(state.tools[0]!)
      DesktopBrowser.prepareInvocation(binding, "echo", digest, { query: "a" })
      const afterFirst = compile.mock.calls.length
      expect(afterFirst).toBeGreaterThan(0)
      DesktopBrowser.prepareInvocation(binding, "echo", digest, { query: "b" })
      expect(compile.mock.calls.length).toBe(afterFirst)
      expect(() => DesktopBrowser.prepareInvocation(binding, "echo", digest, { query: 1 })).toThrow(/\/query/)

      const next = { ...state, generation: randomUUID() }
      DesktopBrowser.update(connection.providerID, next)
      const rebound = DesktopBrowser.forSession(session.id)
      DesktopBrowser.prepareInvocation(rebound, "echo", digest, { query: "c" })
      expect(compile.mock.calls.length).toBeGreaterThan(afterFirst)

      const tools = Array.from({ length: DesktopBrowser.VALIDATOR_CACHE_LIMIT + 1 }, (_, index) => ({
        name: `echo${index}`,
        description: `Return fixture data ${index}`,
        frameId: "top",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      }))
      const crowded = { ...next, tools }
      DesktopBrowser.update(connection.providerID, crowded)
      const crowdedBinding = DesktopBrowser.forSession(session.id)
      for (const tool of tools) {
        DesktopBrowser.prepareInvocation(crowdedBinding, tool.name, DesktopBrowser.digest(tool), { query: "a" })
      }
      const afterFill = compile.mock.calls.length
      DesktopBrowser.prepareInvocation(crowdedBinding, tools[0]!.name, DesktopBrowser.digest(tools[0]!), { query: "a" })
      expect(compile.mock.calls.length).toBeGreaterThan(afterFill)
      const afterEvicted = compile.mock.calls.length
      const last = tools[tools.length - 1]!
      DesktopBrowser.prepareInvocation(crowdedBinding, last.name, DesktopBrowser.digest(last), { query: "a" })
      expect(compile.mock.calls.length).toBe(afterEvicted)
      DesktopBrowser.disconnect(connection.providerID)
    })
  } finally {
    compile.mockRestore()
  }
})

test("pattern and patternProperties fail closed before Ajv compiles them", async () => {
  const compile = vi.spyOn(Ajv.prototype, "compile")
  try {
    await withSession(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const cases = [
        {
          inputSchema: {
            type: "object",
            properties: { query: { type: "string", pattern: "^(a+)+$" } },
            required: ["query"],
          },
          input: { query: "ok" },
        },
        {
          inputSchema: {
            type: "object",
            patternProperties: { "^q$": { type: "string" } },
            additionalProperties: false,
          },
          input: { q: "ok" },
        },
        {
          inputSchema: {
            type: "object",
            properties: { query: { type: "string", not: { pattern: "^no$" } } },
            required: ["query"],
          },
          input: { query: "ok" },
        },
      ]
      for (const item of cases) {
        state.tools[0]!.inputSchema = item.inputSchema
        DesktopBrowser.update(connection.providerID, state)
        const binding = DesktopBrowser.forSession(session.id)
        const before = compile.mock.calls.length
        const error = await rejection(
          Promise.resolve().then(() =>
            DesktopBrowser.prepareInvocation(binding, "echo", DesktopBrowser.digest(state.tools[0]!), item.input),
          ),
        )
        expect(error.data.reason).toBe("native-failure")
        expect(error.data.message).toBe("The tool schema could not be checked")
        expect(compile.mock.calls.length).toBe(before)
      }

      state.tools[0]!.inputSchema = { $ref: "#/definitions/missing" }
      DesktopBrowser.update(connection.providerID, state)
      const uncheckable = await rejection(
        Promise.resolve().then(() =>
          DesktopBrowser.prepareInvocation(
            DesktopBrowser.forSession(session.id),
            "echo",
            DesktopBrowser.digest(state.tools[0]!),
            { query: "ok" },
          ),
        ),
      )
      expect(uncheckable.data.reason).toBe("native-failure")
      expect(uncheckable.data.message).toBe("The tool schema could not be checked")

      state.tools[0]!.inputSchema = {
        type: "object",
        properties: {
          pattern: { type: "string" },
          patternProperties: { type: "string" },
        },
        required: ["pattern"],
        default: { pattern: "floral" },
      }
      DesktopBrowser.update(connection.providerID, state)
      const binding = DesktopBrowser.forSession(session.id)
      const checked = DesktopBrowser.prepareInvocation(binding, "echo", DesktopBrowser.digest(state.tools[0]!), {
        pattern: "floral",
        patternProperties: "kept",
      })
      expect(checked.input).toMatchObject({ pattern: "floral", patternProperties: "kept" })
      DesktopBrowser.disconnect(connection.providerID)
    })
  } finally {
    compile.mockRestore()
  }
})
