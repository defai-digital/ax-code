import fs from "node:fs/promises"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { Permission } from "../../src/permission"
import { SessionID } from "../../src/session/schema"
import { WebMcpApprovals } from "../../src/mcp/webmcp-approvals"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { MCP } from "../../src/mcp"
import { Filesystem } from "../../src/util/filesystem"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Hono } from "hono"
import { PermissionRoutes } from "../../src/server/routes/permission"
import { McpRoutes } from "../../src/server/routes/mcp"
import { ServerRuntimeAuth } from "../../src/server/runtime-auth"

const entry = () => WebMcpProfile.config({ allowedOrigins: [], read: true }, false)
const sessionID = SessionID.make("ses_webmcp_allowlist")
beforeEach(async () => {
  await fs.rm(WebMcpApprovals.filepath, { force: true })
  vi.spyOn(MCP, "matchesWebMcpProfile").mockResolvedValue(true)
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Instance.disposeAll()
  await fs.rm(WebMcpApprovals.filepath, { force: true })
})

test("the idle countdown resolves once and never writes a persistent approval", async () => {
  vi.stubEnv("AX_CODE_AUTONOMOUS", "1")
  vi.stubEnv("AX_CODE_ISOLATION_MODE", "full-access")
  vi.stubEnv("AX_CODE_PERMISSION_IDLE_ONCE_MS", "300")
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const first = await ask()
      expect(first.request.autoOnceAt).toBeTypeOf("number")
      await first.pending
      expect(await Permission.saveWebMcpApproval(first.request.id)).toBe(false)
      expect(await WebMcpApprovals.list("bridge")).toEqual([])
    },
  })
})

test("denial during persistence rolls back the saved approval and leaves the ask pending", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const ruleset: Permission.Ruleset = []
      const first = await ask(undefined, ruleset)
      const write = Filesystem.writeJson
      vi.spyOn(Filesystem, "writeJson").mockImplementationOnce(async (...args) => {
        await write(...args)
        ruleset.push({ permission: "bridge_*", pattern: "*", action: "deny" })
      })
      await expect(Permission.saveWebMcpApproval(first.request.id)).rejects.toBeInstanceOf(Permission.DeniedError)
      expect(await WebMcpApprovals.list("bridge")).toEqual([])
      expect(await Permission.list()).toHaveLength(1)
      await Permission.reply({ requestID: first.request.id, reply: "once" })
      await first.pending
    },
  })
})

test("an older generic always grant cannot hide a current deny during saved approval admission", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const input = {
        sessionID,
        permission: "bridge_list_pages",
        patterns: ["*"],
        always: ["*"],
        metadata: {},
        ruleset: [],
      }
      const pending = Permission.ask(input)
      await vi.waitFor(async () => expect(await Permission.list()).toHaveLength(1))
      const [request] = await Permission.list()
      await Permission.reply({ requestID: request.id, reply: "always" })
      await pending
      await expect(
        Permission.checkDenials({ ...input, ruleset: [{ permission: "bridge_*", pattern: "*", action: "deny" }] }),
      ).rejects.toBeInstanceOf(Permission.DeniedError)
    },
  })
})

async function ask(signal?: AbortSignal, ruleset: Permission.Ruleset = []) {
  const candidate = (await WebMcpApprovals.capture(
    { server: "bridge", toolName: "list_pages", profile: entry().webmcp },
    { capability: "list_pages" },
  ))!
  const metadata = { server: "bridge", tool: "list_pages" }
  WebMcpApprovals.bind(metadata, candidate, { permission: "bridge_list_pages", patterns: ["*"] })
  const pending = Permission.ask(
    { sessionID, permission: "webmcp", patterns: ["bridge_list_pages"], always: [], metadata, ruleset },
    { signal },
  )
  pending.catch(() => {})
  await vi.waitFor(async () => expect(await Permission.list()).toHaveLength(1))
  const [request] = await Permission.list()
  return { pending, request, candidate }
}

test("explicit save resolves once, auto-approves the next bound call and preserves denies", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const first = await ask()
      expect(first.request.webmcpAllowlist).toMatchObject({ server: "bridge", scope: { capability: "list_pages" } })
      expect(await Permission.saveWebMcpApproval(first.request.id)).toBe(true)
      await first.pending
      expect(await Permission.saveWebMcpApproval(first.request.id)).toBe(false)
      const metadata = {}
      WebMcpApprovals.bind(metadata, first.candidate, { permission: "bridge_list_pages", patterns: ["*"] })
      const input = {
        sessionID,
        permission: "webmcp",
        patterns: ["bridge_list_pages"],
        always: [],
        metadata,
        ruleset: [],
      }
      await Permission.ask(input)
      expect(await Permission.list()).toHaveLength(0)
      await expect(
        Permission.ask({ ...input, ruleset: [{ permission: "webmcp", pattern: "*", action: "deny" }] }),
      ).rejects.toBeInstanceOf(Permission.DeniedError)
      await expect(
        Permission.checkDenials({
          ...input,
          permission: "bridge_list_pages",
          patterns: ["*"],
          ruleset: [{ permission: "bridge_*", pattern: "*", action: "deny" }],
        }),
      ).rejects.toBeInstanceOf(Permission.DeniedError)
    },
  })
})

test("serialized client metadata and generic always cannot mint an approval", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const pending = Permission.ask({
        sessionID,
        permission: "webmcp",
        patterns: ["bridge_list_pages"],
        always: ["*"],
        ruleset: [],
        metadata: { server: "bridge", tool: "list_pages" },
        webmcpAllowlist: { server: "bridge", project: Instance.project.id, scope: { capability: "list_pages" } },
      })
      await vi.waitFor(async () => expect(await Permission.list()).toHaveLength(1))
      const [request] = await Permission.list()
      expect(request.webmcpAllowlist).toBeUndefined()
      expect(await Permission.saveWebMcpApproval(request.id)).toBe(false)
      await Permission.reply({ requestID: request.id, reply: "always" })
      await pending
      expect(await WebMcpApprovals.list("bridge")).toEqual([])
    },
  })
})

test("an earlier once reply prevents save; an explicit save reserves against competing replies", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const first = await ask()
      await Permission.reply({ requestID: first.request.id, reply: "once" })
      expect(await Permission.saveWebMcpApproval(first.request.id)).toBe(false)
      await first.pending
      expect(await WebMcpApprovals.list("bridge")).toEqual([])
      const second = await ask()
      const save = Permission.saveWebMcpApproval(second.request.id)
      await vi.waitFor(async () =>
        expect(await Permission.reply({ requestID: second.request.id, reply: "once" })).toBe(false),
      )
      expect(await save).toBe(true)
      await second.pending
      expect(await WebMcpApprovals.list("bridge")).toHaveLength(1)
    },
  })
})

test("failed saves leave a pending request retryable", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const first = await ask()
      vi.spyOn(Filesystem, "writeJson").mockRejectedValueOnce(new Error("disk full"))
      await expect(Permission.saveWebMcpApproval(first.request.id)).rejects.toThrow("disk full")
      expect(await Permission.list()).toHaveLength(1)
      expect(await Permission.saveWebMcpApproval(first.request.id)).toBe(true)
      await first.pending
    },
  })
})

test("abort while saving rejects the call and leaves no saved approval", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const controller = new AbortController()
      const first = await ask(controller.signal)
      const rejected = expect(first.pending).rejects.toThrow()
      const write = Filesystem.writeJson
      vi.spyOn(Filesystem, "writeJson").mockImplementationOnce(async (...args) => {
        await write(...args)
        controller.abort()
      })
      await expect(Permission.saveWebMcpApproval(first.request.id)).rejects.toThrow("canceled")
      await rejected
      expect(await WebMcpApprovals.list("bridge")).toEqual([])
      expect(await Permission.list()).toHaveLength(0)
    },
  })
})

test("HTTP save requires runtime authorization, binds the pending request, and supports revocation", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const app = new Hono().route("/permission", PermissionRoutes()).route("/mcp", McpRoutes())
      const first = await ask()
      const url = `http://localhost/permission/${first.request.id}/webmcp-allowlist`
      expect((await app.request(url, { method: "POST" })).status).toBe(403)
      expect(await WebMcpApprovals.list("bridge")).toEqual([])
      const headers = ServerRuntimeAuth.headers()
      expect((await app.request(url, { method: "POST", headers })).status).toBe(200)
      await first.pending
      expect((await app.request(url, { method: "POST", headers })).status).toBe(404)
      const list = await app.request("http://localhost/mcp/bridge/webmcp-approvals")
      const records = await list.json()
      expect(records).toHaveLength(1)
      expect(
        (await app.request(`http://localhost/mcp/bridge/webmcp-approvals?id=${records[0].id}`, { method: "DELETE" }))
          .status,
      ).toBe(403)
      expect(
        (
          await app.request(`http://localhost/mcp/bridge/webmcp-approvals?id=${records[0].id}`, {
            method: "DELETE",
            headers,
          })
        ).status,
      ).toBe(200)
      expect(await WebMcpApprovals.allowed(first.candidate)).toBe(false)
    },
  })
})
