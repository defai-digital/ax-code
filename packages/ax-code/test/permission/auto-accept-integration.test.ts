import { afterEach, beforeEach, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { Hono } from "hono"
import { Bus } from "../../src/bus"
import { Permission } from "../../src/permission"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { PermissionID } from "../../src/permission/schema"
import { PermissionRoutes } from "../../src/server/routes/permission"
import { ServerRuntimeAuth } from "../../src/server/runtime-auth"
import { tmpdir } from "../fixture/fixture"

// This fixture exercises permission admission without starting an MCP sampling runtime.
// The full, unmocked permission/bash suites remain part of the verification command.
vi.mock("../../src/mcp/sampling", () => ({ McpSampling: { clientCapabilities: () => ({}) } }))

beforeEach(() => {
  vi.stubEnv("AX_CODE_AUTONOMOUS", "false")
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Instance.disposeAll()
})

const request = (permission = "edit", patterns = ["src/file.ts"]) => ({
  sessionID: SessionID.make("ses_auto_accept"),
  permission,
  patterns,
  metadata: {},
  always: [],
  ruleset: [{ permission: "*", pattern: "*", action: "ask" as const }],
})

async function staysAsking(input: ReturnType<typeof request> & { interactiveOnly?: boolean; riskClass?: "unknown" }) {
  const id = PermissionID.ascending()
  const controller = new AbortController()
  const pending = new Promise<void>((resolve) => {
    const unsub = Bus.subscribe(Permission.Event.Asked, ({ properties }) => {
      if (properties.id !== id) return
      unsub()
      resolve()
    })
  })
  const call = Permission.ask({ ...input, id }, { signal: controller.signal })
  const result = call.catch((error: unknown) => error)
  try {
    await Promise.race([
      pending,
      call.then(() => {
        throw new Error("Unexpected auto-approval")
      }),
    ])
    expect((await Permission.list()).some((entry) => entry.id === id)).toBe(true)
  } finally {
    controller.abort(new Error("test cleanup"))
    await result
  }
}

test("trusted config enables ordinary asks and emits one auto-accepted event per call", async () => {
  await using tmp = await tmpdir({ git: true, config: { permission: { auto_accept: true } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const events: unknown[] = []
      const off = Bus.subscribe(Permission.Event.AutoAccepted, (event) => {
        events.push(event.properties)
      })
      for (const permission of ["edit", "write", "apply_patch", "multiedit", "bash"]) {
        await Permission.ask({
          ...request(permission, [permission === "bash" ? "echo hello" : "src/file.ts"]),
          metadata: { bashCommand: "echo hello", bashCwd: tmp.path },
        })
      }
      expect(events).toHaveLength(5)
      expect(await Permission.list()).toEqual([])
      expect(Permission.fromConfig({ auto_accept: true, edit: "ask" })).toEqual([
        { permission: "edit", pattern: "*", action: "ask" },
      ])
      off()
    },
  })
})

test("excluded requests remain pending, explicit deny still throws, and symlinks cannot hide protected paths", async () => {
  await using tmp = await tmpdir({ git: true, config: { permission: { auto_accept: true } } })
  await fs.mkdir(path.join(tmp.path, "secrets"))
  await fs.symlink(path.join(tmp.path, "secrets"), path.join(tmp.path, "ordinary"))
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      for (const permission of ["external_directory", "computer", "mcp_sampling", "hook"])
        await staysAsking(request(permission))
      await staysAsking({ ...request(), interactiveOnly: true })
      await staysAsking({ ...request(), riskClass: "unknown" })
      await staysAsking(request("edit", [".env"]))
      await staysAsking(request("edit", [".git/HEAD"]))
      await staysAsking(request("edit", ["ordinary/new-file"]))
      await expect(
        Permission.ask({ ...request(), ruleset: [{ permission: "edit", pattern: "*", action: "deny" }] }),
      ).rejects.toBeInstanceOf(Permission.DeniedError)
    },
  })
})

test("untrusted project cannot enable; runtime override is temporary and scoped to the instance", async () => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "0")
  await using first = await tmpdir({ git: true, config: { permission: { auto_accept: true } } })
  await using second = await tmpdir({ git: true })
  await Instance.provide({
    directory: first.path,
    fn: async () => {
      expect((await Permission.autoAcceptStatus()).enabled).toBe(false)
      expect((await Permission.setAutoAccept(true)).enabled).toBe(true)
      await Permission.ask(request())
    },
  })
  await Instance.provide({
    directory: second.path,
    fn: async () => {
      expect((await Permission.autoAcceptStatus()).enabled).toBe(false)
    },
  })
  await Instance.disposeAll()
  await Instance.provide({
    directory: first.path,
    fn: async () => {
      expect((await Permission.autoAcceptStatus()).enabled).toBe(false)
    },
  })
})

test("managed false wins over trusted config, later managed true, and runtime toggle; managed asks stay asking", async () => {
  await using managed = await tmpdir()
  await using project = await tmpdir({ git: true, config: { permission: { auto_accept: true } } })
  vi.spyOn(Config, "global").mockResolvedValue({ permission: { auto_accept: true } })
  const previous = Config.managedConfigDir()
  Config.__setTestManagedConfigDir(managed.path)
  try {
    await fs.writeFile(path.join(managed.path, "ax-code.json"), JSON.stringify({ permission: { auto_accept: false } }))
    await fs.writeFile(path.join(managed.path, "ax-code.jsonc"), JSON.stringify({ permission: { auto_accept: true } }))
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect(await Permission.setAutoAccept(true)).toMatchObject({ enabled: false, managedDisabled: true })
        await staysAsking(request())
        await fs.writeFile(path.join(managed.path, "ax-code.json"), JSON.stringify({ permission: { edit: "ask" } }))
        await Config.invalidate()
        expect((await Permission.setAutoAccept(true)).enabled).toBe(true)
        await staysAsking(request())
      },
    })
  } finally {
    Config.__setTestManagedConfigDir(previous)
  }
})

test("runtime toggle requires runtime authentication and never persists a config change", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const app = new Hono().route("/permission", PermissionRoutes())
      const body = JSON.stringify({ enabled: true })
      expect(
        (
          await app.request("/permission/auto-accept", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body,
          })
        ).status,
      ).toBe(403)
      const response = await app.request("/permission/auto-accept", {
        method: "PUT",
        headers: { "content-type": "application/json", ...ServerRuntimeAuth.headers() },
        body,
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ enabled: true })
      expect((await Config.get()).permission?.auto_accept).toBeUndefined()
    },
  })
})

test("user config may enable auto-accept but inline and agent config cannot", async () => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "0")
  vi.spyOn(Config, "global").mockResolvedValue({ permission: { auto_accept: true } })
  await using user = await tmpdir({ git: true })
  await Instance.provide({
    directory: user.path,
    fn: async () => {
      expect((await Permission.autoAcceptStatus()).enabled).toBe(true)
    },
  })
  vi.mocked(Config.global).mockResolvedValue({})
  vi.stubEnv(
    "AX_CODE_CONFIG_CONTENT",
    JSON.stringify({ permission: { auto_accept: true }, agent: { build: { permission: { auto_accept: true } } } }),
  )
  await using inline = await tmpdir({ git: true })
  await Instance.provide({
    directory: inline.path,
    fn: async () => {
      expect((await Permission.autoAcceptStatus()).enabled).toBe(false)
    },
  })
})

test("supervised full-access bash retains prompts for opaque code and protected redirects", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: { permission: { auto_accept: true }, isolation: { mode: "full-access" } },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      for (const command of [
        'python3 -c \'open(".env","w").write("x")\'',
        "node -e 'code'",
        "perl -e 'code'",
        "bash -c 'echo hi'",
        "pnpm test",
        "echo x > .env",
        "echo x > .git/HEAD",
      ])
        await staysAsking({ ...request("bash", [command]), metadata: { bashCommand: command, bashCwd: tmp.path } })
      await staysAsking(request("bash", ["ls"]))
      for (const command of ["ls", "cat src/file", "wc src/file"]) {
        await Permission.ask({ ...request("bash", [command]), metadata: { bashCommand: command, bashCwd: tmp.path } })
      }
    },
  })
})

test.each(["edit", "write", "apply_patch", "multiedit", "bash"])(
  "dangling and unresolvable symlinks retain %s approval",
  async (permission) => {
    await using outside = await tmpdir()
    await using tmp = await tmpdir({ git: true, config: { permission: { auto_accept: true } } })
    await fs.symlink(path.join(outside.path, "new-file"), path.join(tmp.path, "outside-link"))
    await fs.symlink(path.join(tmp.path, ".env"), path.join(tmp.path, "protected-link"))
    await fs.symlink("loop", path.join(tmp.path, "loop"))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const target of ["outside-link", "outside-link/child", "protected-link", "loop/child"]) {
          const pattern = permission === "bash" ? `cat ${target}` : target
          await staysAsking({
            ...request(permission, [pattern]),
            metadata: { bashCommand: pattern, bashCwd: tmp.path },
          })
        }
      },
    })
  },
)
