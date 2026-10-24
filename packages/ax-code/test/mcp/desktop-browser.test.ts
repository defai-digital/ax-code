import { afterEach, describe, expect, test, vi } from "vitest"
import { randomUUID } from "node:crypto"
import { Hono } from "hono"
const { token } = vi.hoisted(() => {
  const token = (globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replaceAll("-", "").slice(0, 43)
  process.env.AX_CODE_DESKTOP_BROWSER_TOKEN = token
  return { token }
})
import { DesktopBrowser } from "@/mcp/desktop-browser"
import { DesktopBrowserRoutes } from "@/server/routes/desktop-browser"
import { DesktopWebMcpTool } from "@/tool/desktop_webmcp"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Permission } from "@/permission"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { MessageID } from "@/session/schema"
import type { Tool } from "@/tool/tool"
import { tmpdir } from "../fixture/fixture"
import { NamedError } from "@ax-code/util/error"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
const snapshot = (): DesktopBrowser.Snapshot => ({
  generation: randomUUID(),
  origin: "https://example.com",
  frameId: "top",
  tools: [{ name: "echo", description: "Return fixture data", frameId: "top", inputSchema: { type: "object" } }],
})
async function fixture(
  fn: (info: Awaited<ReturnType<typeof Session.create>>, state: DesktopBrowser.Snapshot) => Promise<void>,
) {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await fn(await Session.create({}), snapshot())
    },
  })
  await Instance.disposeAll()
}

describe("private desktop WebMCP provider", () => {
  test("sandboxed Auto lists a live native catalog without asking, but page invocation still asks", async () => {
    vi.stubEnv("AX_CODE_AUTONOMOUS", "1")
    vi.stubEnv("AX_CODE_ISOLATION_MODE", "workspace-write")
    await fixture(async (session, state) => {
      state.tools[0]!.annotations = { readOnly: true }
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const tool = await DesktopWebMcpTool.init()
      const asked: Permission.Request[] = []
      const stop = Bus.subscribe(Permission.Event.Asked, (event) => {
        asked.push(event.properties)
        void Permission.reply({ requestID: event.properties.id, reply: "reject" })
      })
      const ctx: Tool.Context = {
        sessionID: session.id,
        messageID: MessageID.ascending(),
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => {},
        ask: (input) => Permission.ask({ ...input, sessionID: session.id, ruleset: [] }),
      }
      try {
        const listing = tool.execute({ action: "list" }, ctx)
        const batch = await DesktopBrowser.poll(connection.providerID, ctx.abort)
        expect(batch.request?.operation).toBe("list")
        DesktopBrowser.respond(connection.providerID, {
          requestID: batch.request!.requestID,
          generation: state.generation,
          status: "Completed",
          snapshot: state,
        })
        const listed = JSON.parse((await listing).output)
        expect(listed.result.map((tool: { name: string }) => tool.name)).toContain("echo")
        expect(listed.note).toBeUndefined()
        expect(asked).toEqual([])
        await expect(
          tool.execute(
            { action: "invoke", toolName: "echo", digest: DesktopBrowser.digest(state.tools[0]!), input: {} },
            ctx,
          ),
        ).rejects.toThrow("rejected")
        expect(asked).toHaveLength(1)
        expect(asked[0]!.metadata.requireInteractive).toBe(false)
        expect(asked[0]!.autoOnceAt).toBeUndefined()
      } finally {
        stop()
        DesktopBrowser.disconnect(connection.providerID)
      }
    })
  })

  test("an empty catalog names action=read as the next step instead of another listing", async () => {
    vi.stubEnv("AX_CODE_AUTONOMOUS", "1")
    vi.stubEnv("AX_CODE_ISOLATION_MODE", "workspace-write")
    await fixture(async (session, state) => {
      const ordinary = { ...state, tools: [] }
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: ordinary })
      const tool = await DesktopWebMcpTool.init()
      const ctx: Tool.Context = {
        sessionID: session.id,
        messageID: MessageID.ascending(),
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => {},
        ask: (input) => Permission.ask({ ...input, sessionID: session.id, ruleset: [] }),
      }
      try {
        const listing = tool.execute({ action: "list" }, ctx)
        const batch = await DesktopBrowser.poll(connection.providerID, ctx.abort)
        DesktopBrowser.respond(connection.providerID, {
          requestID: batch.request!.requestID,
          generation: ordinary.generation,
          status: "Completed",
          snapshot: ordinary,
        })
        const empty = JSON.parse((await listing).output)
        expect(empty).toMatchObject({ untrusted: true, result: [] })
        expect(empty.note).toContain("action=read")
      } finally {
        DesktopBrowser.disconnect(connection.providerID)
      }
    })
  })

  test("opens a page for the agent when the pane is blank and lists what it registered", async () => {
    // Workspace-write (sandboxed) Auto: listing and navigation are admitted live,
    // invocation still asks. Navigation itself must ask on the first use.
    vi.stubEnv("AX_CODE_AUTONOMOUS", "1")
    vi.stubEnv("AX_CODE_ISOLATION_MODE", "workspace-write")
    await fixture(async (session) => {
      // A blank enrolled pane: no origin and no frame, which is exactly the state
      // the agent used to be stuck in.
      const blank = { generation: randomUUID(), origin: null, frameId: "", tools: [] }
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: blank })
      const tool = await DesktopWebMcpTool.init()
      const asked: Permission.Request[] = []
      const stop = Bus.subscribe(Permission.Event.Asked, (event) => {
        asked.push(event.properties)
        void Permission.reply({ requestID: event.properties.id, reply: "once" })
      })
      const ctx: Tool.Context = {
        sessionID: session.id,
        messageID: MessageID.ascending(),
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => {},
        ask: (input) => Permission.ask({ ...input, sessionID: session.id, ruleset: [] }),
      }
      try {
        const execution = tool.execute({ action: "navigate", url: "https://flights.example.com/search" }, ctx)

        const navigation = await DesktopBrowser.poll(connection.providerID, ctx.abort)
        expect(navigation.request?.operation).toBe("navigate")
        expect(navigation.request).toMatchObject({ url: "https://flights.example.com/search" })

        // The pane grants the page: it pushes the new snapshot, then replies with
        // the generation of the document it actually ended up on.
        const opened = { ...snapshot(), origin: "https://flights.example.com" }
        DesktopBrowser.update(connection.providerID, opened)
        DesktopBrowser.respond(connection.providerID, {
          requestID: navigation.request!.requestID,
          generation: opened.generation,
          status: "Completed",
          snapshot: opened,
        })

        // The same call then lists the freshly opened page.
        const listing = await DesktopBrowser.poll(connection.providerID, ctx.abort)
        expect(listing.request?.operation).toBe("list")
        DesktopBrowser.respond(connection.providerID, {
          requestID: listing.request!.requestID,
          generation: opened.generation,
          status: "Completed",
          snapshot: opened,
        })

        const result = await execution
        expect(result.output).toContain("echo")
        expect(result.output).toContain("https://flights.example.com")

        // The user sees the URL they are being asked to open.
        expect(asked).toHaveLength(1)
        expect(asked[0]!.patterns).toEqual(["https://flights.example.com"])
      } finally {
        stop()
        DesktopBrowser.disconnect(connection.providerID)
      }
    })
  })

  test("refuses a navigation that lands on a different origin than the one approved", async () => {
    // A redirect can land the pane on an origin the user never approved. The
    // tool must fail closed rather than report the approved origin and list the
    // landed page's tools.
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const controller = new AbortController()
      const navigation = DesktopBrowser.navigate(session.id, "https://flights.example.com/search", controller.signal)
      const request = await DesktopBrowser.poll(connection.providerID, controller.signal)
      expect(request.request?.operation).toBe("navigate")

      // The pane follows a redirect and grants https://evil.example.com.
      const landed = { generation: randomUUID(), origin: "https://evil.example.com", frameId: "top", tools: [] }
      DesktopBrowser.update(connection.providerID, landed)
      DesktopBrowser.respond(connection.providerID, {
        requestID: request.request!.requestID,
        generation: landed.generation,
        status: "Completed",
        snapshot: landed,
      })

      await expect(navigation).rejects.toThrow(/different origin/)
      DesktopBrowser.disconnect(connection.providerID)
    })
  })

  test("refuses a URL the pane cannot open before any request reaches it", async () => {
    await fixture(async (session) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: snapshot() })
      const tool = await DesktopWebMcpTool.init()
      const ctx: Tool.Context = {
        sessionID: session.id,
        messageID: MessageID.ascending(),
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => {},
        ask: (input) => Permission.ask({ ...input, sessionID: session.id, ruleset: [] }),
      }
      try {
        await expect(tool.execute({ action: "navigate", url: "file:///etc/passwd" }, ctx)).rejects.toThrow(
          /Only https:\/\/ URLs, or http:\/\/ on loopback/,
        )
        await expect(tool.execute({ action: "navigate", url: "http://example.com" }, ctx)).rejects.toThrow(
          /Only https:\/\/ URLs, or http:\/\/ on loopback/,
        )

        // Nothing was queued for the pane.
        const pending = await DesktopBrowser.poll(connection.providerID, AbortSignal.timeout(1500)).catch(() => null)
        expect(pending?.request ?? null).toBeNull()
      } finally {
        DesktopBrowser.disconnect(connection.providerID)
      }
    })
  })

  test("navigation needs an enrolled browser and reports that instead of guessing", async () => {
    await fixture(async (session) => {
      const tool = await DesktopWebMcpTool.init()
      const ctx: Tool.Context = {
        sessionID: session.id,
        messageID: MessageID.ascending(),
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => {},
        ask: (input) => Permission.ask({ ...input, sessionID: session.id, ruleset: [] }),
      }

      await expect(tool.execute({ action: "navigate", url: "https://example.com" }, ctx)).rejects.toThrow(
        /No project browser is enrolled/,
      )
    })
  })

  test("full-access Auto lists and invokes a bound native tool repeatedly without prompting", async () => {
    vi.stubEnv("AX_CODE_AUTONOMOUS", "1")
    vi.stubEnv("AX_CODE_ISOLATION_MODE", "full-access")
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const tool = await DesktopWebMcpTool.init()
      const asked = vi.fn((event: { properties: Permission.Request }) => {
        void Permission.reply({ requestID: event.properties.id, reply: "reject" })
      })
      const stop = Bus.subscribe(Permission.Event.Asked, asked)
      const ctx: Tool.Context = {
        sessionID: session.id,
        messageID: MessageID.ascending(),
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => {},
        ask: (input) => Permission.ask({ ...input, sessionID: session.id, ruleset: [] }),
      }
      try {
        for (const action of ["list", "invoke", "invoke"] as const) {
          const execution = tool.execute(
            action === "list"
              ? { action }
              : {
                  action,
                  toolName: "echo",
                  digest: DesktopBrowser.digest(state.tools[0]!),
                  input: { text: "fixture" },
                },
            ctx,
          )
          const batch = await DesktopBrowser.poll(connection.providerID, ctx.abort)
          expect(batch.request?.operation).toBe(action)
          DesktopBrowser.respond(connection.providerID, {
            requestID: batch.request!.requestID,
            generation: state.generation,
            status: "Completed",
            ...(action === "list" ? { snapshot: state } : { output: "fixture" }),
          })
          expect((await execution).output).toContain(action === "list" ? "echo" : "fixture")
        }
        expect(asked).not.toHaveBeenCalled()
        expect(await Permission.list()).toEqual([])
        await expect(
          tool.execute({ action: "invoke", toolName: "echo", digest: "0".repeat(64), input: {} }, ctx),
        ).rejects.toThrow()
        await expect(
          tool.execute(
            {
              action: "invoke",
              toolName: "echo",
              digest: DesktopBrowser.digest(state.tools[0]!),
              input: { password: "fixture" },
            },
            ctx,
          ),
        ).rejects.toThrow()
        expect(asked).not.toHaveBeenCalled()
      } finally {
        stop()
        DesktopBrowser.disconnect(connection.providerID)
      }
    })
  })

  test("requires the launcher secret even for capability reads and rejects browser-origin requests", async () => {
    await fixture(async () => {
      const app = new Hono().route("/desktop/browser", DesktopBrowserRoutes())
      for (const headers of [
        {},
        { [DesktopBrowser.HEADER]: "wrong" },
        { [DesktopBrowser.HEADER]: token, Origin: "http://127.0.0.1" },
      ]) {
        expect(
          (
            await app.request("/desktop/browser/capability", {
              headers: new Headers(headers as Record<string, string>),
            })
          ).status,
        ).toBe(403)
      }
      const response = await app.request("/desktop/browser/capability", { headers: { [DesktopBrowser.HEADER]: token } })
      expect(await response.json()).toEqual({ capability: "desktop.webmcp.v1", browserMode: "embedded" })
    })
  })
  test("routes native inventory privately and returns definition digests", async () => {
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const binding = DesktopBrowser.forSession(session.id)
      const result = DesktopBrowser.list(binding, new AbortController().signal)
      const batch = await DesktopBrowser.poll(connection.providerID, new AbortController().signal)
      expect(batch.request?.operation).toBe("list")
      DesktopBrowser.respond(connection.providerID, {
        requestID: batch.request!.requestID,
        generation: state.generation,
        status: "Completed",
        snapshot: state,
      })
      const definitionDigest = DesktopBrowser.digest(state.tools[0]!)
      expect(await result).toEqual([
        {
          ...state.tools[0],
          digest: definitionDigest,
          invoke: { action: "invoke", toolName: "echo", digest: definitionDigest, input: {} },
        },
      ])
    })
  })
  test("denial uses the existing permission engine and never dispatches", async () => {
    vi.stubEnv("AX_CODE_AUTONOMOUS", "0")
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const tool = await DesktopWebMcpTool.init()
      const poll = vi.spyOn(DesktopBrowser, "list")
      const unsubscribe = Bus.subscribe(Permission.Event.Asked, (event) => {
        expect(event.properties.metadata.requireInteractive).toBe(false)
        void Permission.reply({ requestID: event.properties.id, reply: "reject" })
      })
      const ctx: Tool.Context = {
        sessionID: session.id,
        messageID: MessageID.ascending(),
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => {},
        ask: (request) => Permission.ask({ ...request, sessionID: session.id, ruleset: [] }),
      }
      await expect(tool.execute({ action: "list" }, ctx)).rejects.toThrow()
      expect(poll).not.toHaveBeenCalled()
      unsubscribe()
      DesktopBrowser.disconnect(connection.providerID)
    })
  })
  test("same-URL reload invalidates a pending approval binding and invocation", async () => {
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const binding = DesktopBrowser.forSession(session.id)
      DesktopBrowser.update(connection.providerID, { ...state, generation: randomUUID() })
      await expect(DesktopBrowser.list(binding, new AbortController().signal)).rejects.toThrow()
    })
  })
  test("tool replacement cancels an approved request before accepting its response", async () => {
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const pending = DesktopBrowser.invoke(
        DesktopBrowser.forSession(session.id),
        "echo",
        DesktopBrowser.digest(state.tools[0]!),
        {},
        new AbortController().signal,
      )
      const rejected = expect(pending).rejects.toThrow()
      const batch = await DesktopBrowser.poll(connection.providerID, new AbortController().signal)
      DesktopBrowser.update(connection.providerID, {
        ...state,
        tools: [{ ...state.tools[0]!, description: "Changed" }],
      })
      await rejected
      expect(() =>
        DesktopBrowser.respond(connection.providerID, {
          requestID: batch.request!.requestID,
          generation: state.generation,
          status: "Completed",
          output: "stale",
        }),
      ).toThrow()
      expect((await DesktopBrowser.poll(connection.providerID, new AbortController().signal)).canceled).toContain(
        batch.request!.requestID,
      )
    })
  })
  test("a catalog change while the policy check is awaited rejects the stale invocation", async () => {
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const binding = DesktopBrowser.forSession(session.id)
      const original = Config.get
      vi.spyOn(Config, "get").mockImplementation(async (...args) => {
        DesktopBrowser.update(connection.providerID, {
          ...state,
          tools: [{ ...state.tools[0]!, description: "Changed" }],
        })
        return original(...args)
      })
      await expect(
        DesktopBrowser.invoke(
          binding,
          "echo",
          DesktopBrowser.digest(state.tools[0]!),
          {},
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        data: { reason: "definition-changed", message: expect.stringContaining("Tool definition changed") },
      })
      DesktopBrowser.disconnect(connection.providerID)
    })
  })
  test("enrollment evicts providers that stopped polling instead of hitting the provider limit", async () => {
    await fixture(async (session, state) => {
      for (let i = 0; i < 8; i++) {
        const other = await Session.create({})
        await DesktopBrowser.enroll({ sessionID: other.id, snapshot: state })
      }
      await expect(DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })).rejects.toThrow()
      const now = Date.now()
      vi.spyOn(Date, "now").mockReturnValue(now + 46000)
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      expect(connection.providerID).toBeTruthy()
      DesktopBrowser.disconnect(connection.providerID)
    })
  })
  test("enrollment rejects a catalog nested beyond the transport depth limit", async () => {
    await fixture(async (session, state) => {
      const nested = (depth: number) => {
        let value: unknown = "x"
        for (let i = 0; i < depth; i++) value = { a: value }
        return value as Record<string, unknown>
      }
      const catalog = (depth: number): DesktopBrowser.Snapshot => ({
        ...state,
        tools: [{ ...state.tools[0]!, inputSchema: nested(depth) }],
      })
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: catalog(29) })
      DesktopBrowser.disconnect(connection.providerID)
      await expect(DesktopBrowser.enroll({ sessionID: session.id, snapshot: catalog(30) })).rejects.toThrow(
        "JSON nesting exceeds the transport limit",
      )
    })
  })
  test("abort reaches the private native cancellation lane and rejects late results", async () => {
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const controller = new AbortController()
      const pending = DesktopBrowser.invoke(
        DesktopBrowser.forSession(session.id),
        "echo",
        DesktopBrowser.digest(state.tools[0]!),
        {},
        controller.signal,
      )
      const rejected = expect(pending).rejects.toThrow()
      const batch = await DesktopBrowser.poll(connection.providerID, new AbortController().signal)
      controller.abort()
      await rejected
      expect((await DesktopBrowser.poll(connection.providerID, new AbortController().signal)).canceled).toEqual([
        batch.request!.requestID,
      ])
      const app = new Hono().route("/desktop/browser", DesktopBrowserRoutes())
      const response = await app.request(`/desktop/browser/provider/${connection.providerID}/reply`, {
        method: "POST",
        headers: { [DesktopBrowser.HEADER]: token, "Content-Type": "application/json" },
        body: JSON.stringify({
          requestID: batch.request!.requestID,
          generation: state.generation,
          status: "Completed",
          output: "late",
        }),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toBe(false)
      expect(DesktopBrowser.forSession(session.id).providerID).toBe(connection.providerID)
    })
  })
  test("rejects wrong tool digests, credential fields, oversized input and subframe catalogs", async () => {
    await fixture(async (session, state) => {
      await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const binding = DesktopBrowser.forSession(session.id)
      for (const [digest, input] of [
        ["0".repeat(64), {}],
        [DesktopBrowser.digest(state.tools[0]!), { password: "fixture" }],
        [DesktopBrowser.digest(state.tools[0]!), { text: "x".repeat(65537) }],
      ] as const) {
        await expect(
          DesktopBrowser.invoke(binding, "echo", digest, input, new AbortController().signal),
        ).rejects.toThrow()
      }
      expect(
        DesktopBrowser.Snapshot.safeParse({ ...state, tools: [{ ...state.tools[0], frameId: "subframe" }] }).success,
      ).toBe(false)
      expect(DesktopBrowser.Snapshot.safeParse({ ...state, tools: [state.tools[0], state.tools[0]] }).success).toBe(
        false,
      )
    })
  })
  test("rejects credential-like native results before returning session output", async () => {
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      for (const output of [{ token: "fixture-private-value" }, '{"password":"fixture-private-value"}']) {
        const pending = DesktopBrowser.invoke(
          DesktopBrowser.forSession(session.id),
          "echo",
          DesktopBrowser.digest(state.tools[0]!),
          {},
          new AbortController().signal,
        )
        const rejected = expect(pending).rejects.toThrow()
        const batch = await DesktopBrowser.poll(connection.providerID, new AbortController().signal)
        DesktopBrowser.respond(connection.providerID, {
          requestID: batch.request!.requestID,
          generation: state.generation,
          status: "Completed",
          output,
        })
        await rejected
      }
    })
  })
  test("keeps other coding sessions and replayed provider epochs out of the browser", async () => {
    await fixture(async (session, state) => {
      const old = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const binding = DesktopBrowser.forSession(session.id)
      const other = await Session.create({})
      expect(() => DesktopBrowser.forSession(other.id)).toThrow()
      await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      await expect(DesktopBrowser.list(binding, new AbortController().signal)).rejects.toThrow()
      await expect(DesktopBrowser.poll(old.providerID, new AbortController().signal)).rejects.toThrow()
    })
  })
})

describe("desktop WebMCP failure messages", () => {
  const ctxFor = (session: Awaited<ReturnType<typeof Session.create>>, ask: Tool.Context["ask"]): Tool.Context => ({
    sessionID: session.id,
    messageID: MessageID.ascending(),
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => {},
    ask,
  })
  type Failure = InstanceType<typeof DesktopBrowser.Failure>
  const caught = (fn: () => unknown) => {
    try {
      fn()
    } catch (error) {
      return error as Failure
    }
    throw new Error("expected a DesktopBrowserUnavailable failure")
  }
  // Error.message is not enumerable, so matchers that walk own properties would skip it.
  const rejection = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error("expected a DesktopBrowserUnavailable rejection")
      },
      (error: unknown) => error as Failure,
    )

  test("tells the model that only the user can enable the project browser, before any approval", async () => {
    await fixture(async (session) => {
      const tool = await DesktopWebMcpTool.init()
      expect(tool.description).toContain("action=navigate")
      expect(tool.description).toContain("never invent a URL")
      expect(tool.description).toContain("an empty catalog is a normal result")
      const ask = vi.fn(async () => {})
      const error = await rejection(tool.execute({ action: "list" }, ctxFor(session, ask)))
      expect(DesktopBrowser.Failure.isInstance(error)).toBe(true)
      expect(error.message).toContain("Ask the user to enable agent access")
      expect(error.message).toContain("this tool cannot enable it")
      expect(ask).not.toHaveBeenCalled()
    })
  })

  test("a blank enrolled page asks the user for a URL and keeps the reason in the payload", async () => {
    await fixture(async (session) => {
      const connection = await DesktopBrowser.enroll({
        sessionID: session.id,
        snapshot: { generation: randomUUID(), origin: null, frameId: "top", tools: [] },
      })
      const error = caught(() => DesktopBrowser.forSession(session.id))
      expect(DesktopBrowser.Failure.isInstance(error)).toBe(true)
      expect(error.data.reason).toBe("no-page")
      expect(error.message).toBe(error.data.message)
      expect(error.data.nextAction).toContain("action=navigate")
      expect(error.message).toContain("open the exact https:// or loopback http:// URL")
      expect(error.message).toContain("action=navigate")
      // The recorded body round-trips the sentence, so event readers never see the bare name.
      expect(NamedError.message(error.toObject())).toBe(error.message)
      expect(DesktopBrowser.Failure.Schema.parse(error.toObject()).data.message).toBe(error.message)
      DesktopBrowser.disconnect(connection.providerID)
    })
  })

  test("an enrolled page without registered tools lists an empty catalog", async () => {
    await fixture(async (session, state) => {
      const empty = { ...state, tools: [] }
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: empty })
      const abort = new AbortController().signal
      const listing = DesktopBrowser.list(DesktopBrowser.forSession(session.id), abort)
      const batch = await DesktopBrowser.poll(connection.providerID, abort)
      DesktopBrowser.respond(connection.providerID, {
        requestID: batch.request!.requestID,
        generation: empty.generation,
        status: "Completed",
        snapshot: empty,
      })
      await expect(listing).resolves.toEqual([])
      DesktopBrowser.disconnect(connection.providerID)
    })
  })

  test("unconfirmed completions, disconnects and credential rejections carry their reason as the message", async () => {
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const binding = DesktopBrowser.forSession(session.id)
      const credential = caught(() =>
        DesktopBrowser.prepareInvocation(binding, "echo", DesktopBrowser.digest(state.tools[0]!), {
          password: "hunter2",
        }),
      )
      expect(credential.message).toBe("Credential fields are not accepted in agent input")
      expect(credential.message).not.toContain("hunter2")
      const abort = new AbortController().signal
      const pending = rejection(DesktopBrowser.list(binding, abort))
      // Wait until the request is queued so the disconnect retires an in-flight call.
      const batch = await DesktopBrowser.poll(connection.providerID, abort)
      expect(batch.request?.operation).toBe("list")
      DesktopBrowser.disconnect(connection.providerID)
      const unconfirmed = await pending
      expect(DesktopBrowser.Failure.isInstance(unconfirmed)).toBe(true)
      expect(unconfirmed.data.reason).toBe("provider-gone")
      expect(unconfirmed.message).toBe(unconfirmed.data.message)
      expect(unconfirmed.data.nextAction.length).toBeGreaterThan(0)
      expect(unconfirmed.message).toContain("completion is unconfirmed")
      const gone = caught(() => DesktopBrowser.forSession(session.id))
      expect(gone.message).toContain("Ask the user to enable agent access")
    })
  })
})

describe("desktop WebMCP page interaction", () => {
  const ctxFor = (sessionID: Session.Info["id"], asked: Permission.Request[], reply: "once" | "reject" = "once") => {
    const stop = Bus.subscribe(Permission.Event.Asked, (event) => {
      asked.push(event.properties)
      void Permission.reply({ requestID: event.properties.id, reply })
    })
    const ctx: Tool.Context = {
      sessionID,
      messageID: MessageID.ascending(),
      agent: "build",
      abort: new AbortController().signal,
      messages: [],
      metadata: () => {},
      ask: (input) => Permission.ask({ ...input, sessionID, ruleset: [] }),
    }
    return { ctx, stop }
  }
  const outline = [
    { ref: "e1", kind: "link", name: "Flights", href: "https://example.com/flights" },
    { ref: "e2", kind: "text", name: "From" },
    { ref: "e3", kind: "password", name: "Pass" },
    { ref: "e4", kind: "button", name: "Search", submit: true },
    { ref: "e5", kind: "select", name: "Cabin", options: ["Economy", "Business"] },
  ]
  const answerRead = async (connection: { providerID: string }, state: DesktopBrowser.Snapshot, ctx: Tool.Context) => {
    const batch = await DesktopBrowser.poll(connection.providerID, ctx.abort)
    expect(batch.request?.operation).toBe("read")
    const readId = randomUUID()
    DesktopBrowser.respond(connection.providerID, {
      requestID: batch.request!.requestID,
      generation: state.generation,
      status: "Completed",
      output: { readId, title: "Fares", text: "Toronto to Tokyo", outline },
    })
    return readId
  }

  test("reads a page, then acts on its references; every act asks even in full-access Auto", async () => {
    vi.stubEnv("AX_CODE_AUTONOMOUS", "1")
    vi.stubEnv("AX_CODE_ISOLATION_MODE", "full-access")
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const tool = await DesktopWebMcpTool.init()
      const asked: Permission.Request[] = []
      const { ctx, stop } = ctxFor(session.id, asked)
      try {
        const reading = tool.execute({ action: "read" }, ctx)
        const readId = await answerRead(connection, state, ctx)
        const read = JSON.parse((await reading).output)
        expect(read).toMatchObject({ untrusted: true, result: { readId, text: "Toronto to Tokyo" } })

        const typing = tool.execute({ action: "act", readId, ref: "e2", how: "type", text: "Toronto" }, ctx)
        const typed = await DesktopBrowser.poll(connection.providerID, ctx.abort)
        expect(typed.request).toMatchObject({ operation: "act", readId, ref: "e2", how: "type", text: "Toronto" })
        DesktopBrowser.respond(connection.providerID, {
          requestID: typed.request!.requestID,
          generation: state.generation,
          status: "Completed",
          output: { done: true, how: "type", navigated: false },
        })
        expect(JSON.parse((await typing).output).result).toMatchObject({
          done: true,
          navigated: false,
          originChanged: false,
        })

        // Reading was admitted live; the action was the only prompt, and it names the element.
        expect(asked).toHaveLength(1)
        expect(asked[0]!.metadata).toMatchObject({
          operation: "act",
          how: "type",
          text: "Toronto",
          element: { ref: "e2", name: "From" },
        })
      } finally {
        stop()
        DesktopBrowser.disconnect(connection.providerID)
      }
    })
  })

  test("a click that navigates keeps the pending action and reports an origin change without content", async () => {
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const tool = await DesktopWebMcpTool.init()
      const { ctx, stop } = ctxFor(session.id, [])
      try {
        const reading = tool.execute({ action: "read" }, ctx)
        const readId = await answerRead(connection, state, ctx)
        await reading
        const clicking = tool.execute({ action: "act", readId, ref: "e4", how: "click" }, ctx)
        const click = await DesktopBrowser.poll(connection.providerID, ctx.abort)
        const landed = { ...snapshot(), origin: "https://pay.example.net", tools: [] }
        DesktopBrowser.update(connection.providerID, landed)
        DesktopBrowser.respond(connection.providerID, {
          requestID: click.request!.requestID,
          generation: landed.generation,
          status: "Completed",
          snapshot: landed,
          output: { done: true, how: "click", navigated: true },
        })
        const result = JSON.parse((await clicking).output).result
        expect(result).toEqual({ done: true, how: "click", navigated: true, originChanged: true })
        // The new document retired every reference from the old read.
        const binding = DesktopBrowser.forSession(session.id)
        expect(() => DesktopBrowser.describeRef(binding, readId, "e4")).toThrow()
      } finally {
        stop()
        DesktopBrowser.disconnect(connection.providerID)
      }
    })
  })

  test("refuses stale references, passwords, credential text and unknown elements before asking", async () => {
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const tool = await DesktopWebMcpTool.init()
      const asked: Permission.Request[] = []
      const { ctx, stop } = ctxFor(session.id, asked)
      try {
        const reading = tool.execute({ action: "read" }, ctx)
        const readId = await answerRead(connection, state, ctx)
        await reading
        const act = (extra: Record<string, unknown>) =>
          tool.execute({ action: "act", readId, how: "click", ...extra } as never, ctx)
        await expect(act({ ref: "e3", how: "type", text: "x" })).rejects.toThrow("credentials manually")
        await expect(act({ ref: "e2", how: "type", text: "ghp_abcdefghijklmnopqrstuvwxyz0123" })).rejects.toThrow()
        await expect(act({ ref: "e9" })).rejects.toThrow("no element e9")
        await expect(act({ ref: "e2", how: "select", text: "x" })).rejects.toThrow("not a selector")
        await expect(act({ readId: randomUUID(), ref: "e1" })).rejects.toThrow("stale")
        // Refs come from read; listing cannot refresh them, so the recovery names read.
        await expect(act({ readId: randomUUID(), ref: "e1" })).rejects.toMatchObject({
          data: { reason: "page-changed", nextAction: expect.stringContaining("action=read") },
        })
        expect(asked).toHaveLength(0)
      } finally {
        stop()
        DesktopBrowser.disconnect(connection.providerID)
      }
    })
  })

  test("denying an action never dispatches it", async () => {
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const tool = await DesktopWebMcpTool.init()
      const { ctx, stop } = ctxFor(session.id, [])
      try {
        const reading = tool.execute({ action: "read" }, ctx)
        const readId = await answerRead(connection, state, ctx)
        await reading
        const { ctx: denying, stop: stopDenying } = ctxFor(session.id, [], "reject")
        stop()
        try {
          await expect(tool.execute({ action: "act", readId, ref: "e1", how: "click" }, denying)).rejects.toThrow()
        } finally {
          stopDenying()
        }
        // A queued request would be handed out at once; an empty queue only ends when the signal aborts.
        await expect(DesktopBrowser.poll(connection.providerID, AbortSignal.timeout(100))).rejects.toThrow(
          "Provider stream closed",
        )
      } finally {
        DesktopBrowser.disconnect(connection.providerID)
      }
    })
  })

  test("rejects a page read that is malformed or carries credential-like content", async () => {
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const tool = await DesktopWebMcpTool.init()
      const { ctx, stop } = ctxFor(session.id, [])
      try {
        for (const output of [
          { readId: randomUUID(), title: "", text: "", outline: [], extra: 1 },
          { readId: randomUUID(), title: "", text: "key ghp_abcdefghijklmnopqrstuvwxyz0123", outline: [] },
        ]) {
          const reading = tool.execute({ action: "read" }, ctx)
          const batch = await DesktopBrowser.poll(connection.providerID, ctx.abort)
          DesktopBrowser.respond(connection.providerID, {
            requestID: batch.request!.requestID,
            generation: state.generation,
            status: "Completed",
            output,
          })
          await expect(reading).rejects.toThrow()
        }
      } finally {
        stop()
        DesktopBrowser.disconnect(connection.providerID)
      }
    })
  })

  test("keeps the allowlisted reason a provider reports with a failed reply", async () => {
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const tool = await DesktopWebMcpTool.init()
      const { ctx, stop } = ctxFor(session.id, [])
      const failWith = async (action: "read" | "wait", output: unknown) => {
        const call = tool.execute(
          (action === "read" ? { action } : { action, waitText: "Results" }) as never,
          ctx,
        )
        const batch = await DesktopBrowser.poll(connection.providerID, ctx.abort)
        DesktopBrowser.respond(connection.providerID, {
          requestID: batch.request!.requestID,
          generation: state.generation,
          status: "Error",
          output,
        })
        return call
      }
      try {
        await expect(failWith("wait", { reason: "timeout" })).rejects.toMatchObject({
          data: { reason: "timeout", nextAction: expect.stringContaining("action=read") },
        })
        await expect(failWith("read", { reason: "page-changed" })).rejects.toMatchObject({
          data: { reason: "page-changed", nextAction: expect.stringContaining("action=read") },
        })
        // Exception text or an unknown reason never crosses: it stays the generic failure.
        await expect(failWith("read", { reason: "secret page text" })).rejects.toMatchObject({
          data: { reason: "native-failure" },
        })
      } finally {
        stop()
        DesktopBrowser.disconnect(connection.providerID)
      }
    })
  })

  test("a read cut at the provider caps says so and that scrolling will not help", async () => {
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const tool = await DesktopWebMcpTool.init()
      const { ctx, stop } = ctxFor(session.id, [])
      try {
        const reading = tool.execute({ action: "read" }, ctx)
        const batch = await DesktopBrowser.poll(connection.providerID, ctx.abort)
        DesktopBrowser.respond(connection.providerID, {
          requestID: batch.request!.requestID,
          generation: state.generation,
          status: "Completed",
          output: {
            readId: randomUUID(),
            title: "Results",
            text: "r".repeat(8000),
            outline: Array.from({ length: 150 }, (_, i) => ({ ref: `e${i + 1}`, kind: "link", name: `Item ${i}` })),
          },
        })
        const read = JSON.parse((await reading).output)
        expect(read.note).toContain("8000 characters")
        expect(read.note).toContain("150 controls")
        expect(read.note).toContain("scrolling")
      } finally {
        stop()
        DesktopBrowser.disconnect(connection.providerID)
      }
    })
  })

  test("waits for text and reports whether it appeared", async () => {
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const tool = await DesktopWebMcpTool.init()
      const { ctx, stop } = ctxFor(session.id, [])
      try {
        const waiting = tool.execute({ action: "wait", waitText: "Results", timeoutMs: 2000 }, ctx)
        const batch = await DesktopBrowser.poll(connection.providerID, ctx.abort)
        expect(batch.request).toMatchObject({ operation: "wait", waitText: "Results", timeoutMs: 2000 })
        DesktopBrowser.respond(connection.providerID, {
          requestID: batch.request!.requestID,
          generation: state.generation,
          status: "Completed",
          output: { found: true },
        })
        const found = JSON.parse((await waiting).output)
        expect(found.result).toEqual({ found: true })
        expect(found.note).toBeUndefined()
        // An unmet wait names the next step instead of inviting the same wait again.
        const missing = tool.execute({ action: "wait", waitText: "Results" }, ctx)
        const missed = await DesktopBrowser.poll(connection.providerID, ctx.abort)
        DesktopBrowser.respond(connection.providerID, {
          requestID: missed.request!.requestID,
          generation: state.generation,
          status: "Completed",
          output: { found: false },
        })
        expect(JSON.parse((await missing).output).note).toContain("call action=read")
        await expect(tool.execute({ action: "wait" }, ctx)).rejects.toThrow("text to wait for")
      } finally {
        stop()
        DesktopBrowser.disconnect(connection.providerID)
      }
    })
  })
})
