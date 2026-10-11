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
import { MessageID } from "@/session/schema"
import type { Tool } from "@/tool/tool"
import { tmpdir } from "../fixture/fixture"

afterEach(() => {
  vi.restoreAllMocks()
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
      expect(await response.json()).toEqual({ capability: "desktop.webmcp.v1" })
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
      expect(await result).toEqual([{ ...state.tools[0], digest: DesktopBrowser.digest(state.tools[0]!) }])
    })
  })
  test("denial uses the existing permission engine and never dispatches", async () => {
    await fixture(async (session, state) => {
      const connection = await DesktopBrowser.enroll({ sessionID: session.id, snapshot: state })
      const tool = await DesktopWebMcpTool.init()
      const poll = vi.spyOn(DesktopBrowser, "list")
      const unsubscribe = Bus.subscribe(Permission.Event.Asked, (event) => {
        expect(event.properties.metadata.requireInteractive).toBe(true)
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
