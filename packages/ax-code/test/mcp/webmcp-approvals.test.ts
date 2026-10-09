import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { pathToFileURL } from "node:url"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { WebMcpApprovals } from "../../src/mcp/webmcp-approvals"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { MCP } from "../../src/mcp"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

const entry = () => WebMcpProfile.config({ allowedOrigins: [], read: true }, false)
const policy = (profile: WebMcpProfile.Configuration, toolName = "list_pages") => ({
  server: "bridge",
  profile,
  toolName,
})

beforeEach(async () => {
  await fs.rm(WebMcpApprovals.filepath, { force: true })
  vi.spyOn(MCP, "matchesWebMcpProfile").mockResolvedValue(true)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
  await fs.rm(WebMcpApprovals.filepath, { force: true })
})

test("saved listing survives instance restart, stays project scoped and can be revoked", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await using other = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const candidate = (await WebMcpApprovals.capture(policy(entry().webmcp), { capability: "list_pages" }))!
      expect(await WebMcpApprovals.allowed(candidate)).toBe(false)
      await WebMcpApprovals.save(candidate, () => true)
      expect(await WebMcpApprovals.allowed(candidate)).toBe(true)
      if (process.platform !== "win32") expect((await fs.stat(WebMcpApprovals.filepath)).mode & 0o777).toBe(0o600)
    },
  })
  await Instance.disposeAll()
  await Instance.provide({
    directory: other.path,
    fn: async () => {
      const candidate = (await WebMcpApprovals.capture(policy(entry().webmcp), { capability: "list_pages" }))!
      expect(await WebMcpApprovals.allowed(candidate)).toBe(false)
      expect(await WebMcpApprovals.list("bridge")).toEqual([])
      await WebMcpApprovals.remove("bridge")
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const candidate = (await WebMcpApprovals.capture(policy(entry().webmcp), { capability: "list_pages" }))!
      expect(await WebMcpApprovals.allowed(candidate)).toBe(true)
      const [record] = await WebMcpApprovals.list("bridge")
      await WebMcpApprovals.remove("bridge", record.id)
      expect(await WebMcpApprovals.allowed(candidate)).toBe(false)
    },
  })
})

test("read grants match exact origins and bridge identity, not navigation or other origins", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const profile = entry().webmcp
      const read = (await WebMcpApprovals.capture(policy(profile, "take_snapshot"), {
        capability: "read",
        origin: "https://example.test",
      }))!
      await WebMcpApprovals.save(read, () => true)
      expect(await WebMcpApprovals.allowed(read)).toBe(true)
      for (const origin of ["https://www.example.test", "https://example.test:8443", "https://other.test"]) {
        const candidate = (await WebMcpApprovals.capture(policy(profile, "take_snapshot"), {
          capability: "read",
          origin,
        }))!
        expect(await WebMcpApprovals.allowed(candidate)).toBe(false)
      }
      const navigation = (await WebMcpApprovals.capture(policy(profile, "new_page"), {
        capability: "navigate",
        origin: "https://example.test",
      }))!
      expect(await WebMcpApprovals.allowed(navigation)).toBe(false)
      const cfg = await Config.get()
      const original = cfg.mcp!.bridge
      cfg.mcp!.bridge = WebMcpProfile.config({ allowedOrigins: [], read: true, headless: true }, false)
      expect(await WebMcpApprovals.allowed(read)).toBe(false)
      cfg.mcp!.bridge = original
      vi.mocked(MCP.matchesWebMcpProfile).mockResolvedValue(false)
      expect(await WebMcpApprovals.allowed(read)).toBe(false)
    },
  })
})

test("managed denial and narrowed origins invalidate saved authority", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const profile = entry().webmcp
      const read = (await WebMcpApprovals.capture(policy(profile, "take_snapshot"), {
        capability: "read",
        origin: "https://example.test",
      }))!
      await WebMcpApprovals.save(read, () => true)
      const cfg = await Config.get()
      for (const requirement of [{ allow: false }, { allowRead: false }, { allowedOrigins: ["https://other.test"] }]) {
        cfg.webmcp = requirement
        expect(await WebMcpApprovals.allowed(read)).toBe(false)
      }
      delete cfg.webmcp
      expect(await WebMcpApprovals.allowed(read)).toBe(true)
    },
  })
})

test("concurrent writes preserve other capabilities and revoked calls fail dispatch", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const profile = entry().webmcp
      const listing = (await WebMcpApprovals.capture(policy(profile), { capability: "list_pages" }))!
      const read = (await WebMcpApprovals.capture(policy(profile, "take_snapshot"), {
        capability: "read",
        origin: "https://example.test",
      }))!
      await Promise.all([WebMcpApprovals.save(listing, () => true), WebMcpApprovals.save(read, () => true)])
      expect(await WebMcpApprovals.list("bridge")).toHaveLength(2)
      const metadata = {}
      WebMcpApprovals.bind(metadata, listing)
      WebMcpApprovals.markReused(metadata)
      const call = {}
      WebMcpApprovals.bindCall(call, metadata)
      await WebMcpApprovals.checkCall(call)
      const record = (await WebMcpApprovals.list("bridge")).find((row) => row.scope.capability === "list_pages")!
      await WebMcpApprovals.remove("bridge", record.id)
      await expect(WebMcpApprovals.checkCall(call)).rejects.toThrow("no longer valid")
      expect(await WebMcpApprovals.allowed(read)).toBe(true)
    },
  })
})

test("cancel during atomic write rolls back only the new revision", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const profile = entry().webmcp
      const read = (await WebMcpApprovals.capture(policy(profile, "take_snapshot"), {
        capability: "read",
        origin: "https://example.test",
      }))!
      const listing = (await WebMcpApprovals.capture(policy(profile), { capability: "list_pages" }))!
      await WebMcpApprovals.save(read, () => true)
      let active = true
      const write = Filesystem.writeJson
      vi.spyOn(Filesystem, "writeJson").mockImplementationOnce(async (...args) => {
        await write(...args)
        active = false
      })
      await expect(WebMcpApprovals.save(listing, () => active)).rejects.toThrow("canceled")
      expect(await WebMcpApprovals.allowed(listing)).toBe(false)
      expect(await WebMcpApprovals.allowed(read)).toBe(true)
    },
  })
})

test("corrupt stores fail closed and are preserved", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const candidate = (await WebMcpApprovals.capture(policy(entry().webmcp), { capability: "list_pages" }))!
      await fs.writeFile(WebMcpApprovals.filepath, "invalid store")
      await expect(WebMcpApprovals.allowed(candidate)).rejects.toThrow()
      await expect(WebMcpApprovals.save(candidate, () => true)).rejects.toThrow()
      expect(await fs.readFile(WebMcpApprovals.filepath, "utf8")).toBe("invalid store")
    },
  })
})

test("origin scopes reject wildcards, credentials, paths and arbitrary HTTP origins", () => {
  for (const origin of [
    "https://*.test",
    "https://user:pass@example.test",
    "https://example.test/path",
    "http://example.test",
  ]) {
    expect(WebMcpApprovals.Scope.safeParse({ capability: "read", origin }).success).toBe(false)
  }
  expect(WebMcpApprovals.Scope.safeParse({ capability: "read", origin: "http://localhost:3000" }).success).toBe(true)
  expect(WebMcpApprovals.Scope.safeParse({ capability: "list_pages", origin: "https://example.test" }).success).toBe(
    false,
  )
})

test("two processes preserve both records under the shared store lock", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  const sourceRoot = path.resolve(import.meta.dirname, "../../src")
  const script = path.join(tmp.path, "save-approval.mts")
  await fs.writeFile(
    script,
    `
import { Instance } from ${JSON.stringify(pathToFileURL(path.join(sourceRoot, "project/instance.ts")).href)}
import { Config } from ${JSON.stringify(pathToFileURL(path.join(sourceRoot, "config/config.ts")).href)}
import { MCP } from ${JSON.stringify(pathToFileURL(path.join(sourceRoot, "mcp/impl.ts")).href)}
import { WebMcpApprovals } from ${JSON.stringify(pathToFileURL(path.join(sourceRoot, "mcp/webmcp-approvals.ts")).href)}
MCP.matchesWebMcpProfile = async () => true
await Instance.provide({ directory: process.argv[2], fn: async () => {
  const profile = (await Config.get()).mcp.bridge.webmcp
  const read = process.argv[3] === "read"
  const candidate = await WebMcpApprovals.capture({ server: "bridge", toolName: read ? "take_snapshot" : "list_pages", profile },
    read ? { capability: "read", origin: "https://example.test" } : { capability: "list_pages" })
  if (!candidate) throw new Error("Missing candidate")
  await WebMcpApprovals.save(candidate, () => true)
}})
await Instance.disposeAll()
`,
  )
  const run = (capability: string) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", script, tmp.path, capability], {
        cwd: path.resolve(import.meta.dirname, "../.."),
        env: { ...process.env, TSX_TSCONFIG_PATH: path.resolve(import.meta.dirname, "../../tsconfig.json") },
        stdio: ["ignore", "ignore", "pipe"],
      })
      let stderr = ""
      child.stderr.on("data", (data) => {
        stderr += data
      })
      child.on("error", reject)
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(stderr))))
    })
  await Promise.all([run("read"), run("list_pages")])
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect((await WebMcpApprovals.list("bridge")).map((record) => record.scope.capability).sort()).toEqual([
        "list_pages",
        "read",
      ])
    },
  })
})

test("directories without Git do not share the global project approval scope", async () => {
  await using tmp = await tmpdir({ config: { mcp: { bridge: entry() } } })
  await using other = await tmpdir({ config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const candidate = (await WebMcpApprovals.capture(policy(entry().webmcp), { capability: "list_pages" }))!
      await WebMcpApprovals.save(candidate, () => true)
    },
  })
  await Instance.provide({
    directory: other.path,
    fn: async () => {
      const candidate = (await WebMcpApprovals.capture(policy(entry().webmcp), { capability: "list_pages" }))!
      expect(await WebMcpApprovals.allowed(candidate)).toBe(false)
    },
  })
})

test("navigation reuse checks the current destination, and unrelated operations cannot persist", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const profile = entry().webmcp
      const candidate = (await WebMcpApprovals.captureCall(policy(profile, "navigate_page"), {
        pageId: 1,
        url: "https://example.test/first",
      }))!
      await WebMcpApprovals.save(candidate, () => true)
      const metadata = {}
      WebMcpApprovals.bind(metadata, candidate)
      WebMcpApprovals.markReused(metadata)
      const call = { pageId: 1, url: "https://example.test/second" }
      WebMcpApprovals.bindCall(call, metadata)
      await WebMcpApprovals.checkCall(call)
      call.url = "https://other.test/"
      await expect(WebMcpApprovals.checkCall(call)).rejects.toThrow("destination changed")
      for (const name of ["close_page", "execute_webmcp_tool", "fill", "handle_dialog"]) {
        expect(await WebMcpApprovals.captureCall(policy(profile, name), { pageId: 1 })).toBeUndefined()
      }
    },
  })
})

test("close authority requires its own exact-origin record and an in-memory target", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: entry() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const current = policy(entry().webmcp, "close_page")
      const call = { pageId: 1, origin: "https://example.test" }
      expect(await WebMcpApprovals.captureCall(current, call)).toBeUndefined()
      WebMcpApprovals.bindCloseTarget(call, "https://example.test")
      const candidate = (await WebMcpApprovals.captureCall(current, call))!
      await WebMcpApprovals.save(candidate, () => true)
      for (const origin of ["https://other.test", "https://example.test:8443", "https://www.example.test"]) {
        const other = (await WebMcpApprovals.capture(current, { capability: "close", origin }))!
        expect(await WebMcpApprovals.allowed(other)).toBe(false)
      }
      expect(await WebMcpApprovals.capture(policy(entry().webmcp, "new_page"), candidate.scope)).toBeUndefined()
      expect(() => WebMcpApprovals.checkCloseTarget(call, 2, "https://example.test")).toThrow("changed")
      expect(() => WebMcpApprovals.checkCloseTarget(call, 1, undefined)).toThrow("changed")
      expect(() => WebMcpApprovals.checkCloseTarget(call, 1, "https://example.test")).not.toThrow()
    },
  })
})
