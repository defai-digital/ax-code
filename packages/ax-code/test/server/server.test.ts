import { $ } from "bun"
import { expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Server } from "../../src/server/server"
import { ServerRuntimeAuth } from "../../src/server/runtime-auth"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

test("cors derives an ephemeral listener origin from each request", async () => {
  const app = Server.createApp({ port: 0 })
  const response = await app.fetch(
    new Request("http://localhost:52134/not-found", {
      headers: {
        origin: "http://localhost:52134",
      },
    }),
  )

  expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:52134")
})

test("cors rejects a DNS-rebound request host even when its origin matches", async () => {
  const app = Server.createApp({ hostname: "127.0.0.1", port: 52134 })
  const headers = { origin: "http://evil.example:52134" }

  const readResponse = await app.fetch(new Request("http://evil.example:52134/not-found", { headers }))
  expect(readResponse.headers.get("access-control-allow-origin")).toBeNull()

  const writeResponse = await app.fetch(
    new Request("http://evil.example:52134/not-found", {
      method: "POST",
      headers,
    }),
  )
  expect(writeResponse.status).toBe(403)
  expect(await writeResponse.json()).toMatchObject({ message: "Origin mismatch" })
})

test("listen port validation rejects invalid port numbers before binding", () => {
  expect(Server.validateListenPort(0)).toBe(0)
  expect(Server.validateListenPort(4096)).toBe(4096)
  expect(Server.validateListenPort(65535)).toBe(65535)

  for (const value of [-1, 1.5, 65536, Number.NaN, Number.POSITIVE_INFINITY, "4096", undefined]) {
    expect(() => Server.validateListenPort(value)).toThrow("Server listen port must be an integer between 0 and 65535")
  }
})

test("/doc is available on loopback app instances", async () => {
  const app = Server.createApp({ hostname: "127.0.0.1", port: 4096 })
  const response = await app.fetch(new Request("http://127.0.0.1:4096/doc"))

  expect(response.status).toBe(200)
  expect(response.headers.get("content-type")).toContain("application/json")
})

test("runtime-authenticated app rejects missing tokens and accepts the process token", async () => {
  const app = Server.createApp({ hostname: "127.0.0.1", port: 4096, runtimeAuth: true })

  const rejected = await app.fetch(new Request("http://127.0.0.1:4096/global/health"))
  expect(rejected.status).toBe(403)

  const accepted = await app.fetch(
    new Request("http://127.0.0.1:4096/global/health", {
      headers: ServerRuntimeAuth.headers(),
    }),
  )
  expect(accepted.status).toBe(200)
})

test("/doc is disabled for non-loopback app instances by default", async () => {
  const app = Server.createApp({ hostname: "0.0.0.0", port: 4096 })
  const response = await app.fetch(new Request("http://0.0.0.0:4096/doc"))

  expect(response.status).toBe(403)
  expect(await response.json()).toEqual({
    error:
      "HTTP API documentation is disabled for non-loopback server binds. Set AX_CODE_ENABLE_HTTP_DOCS=1 to enable it.",
  })
})

test("/doc can be explicitly enabled for non-loopback app instances", async () => {
  const previous = process.env.AX_CODE_ENABLE_HTTP_DOCS
  process.env.AX_CODE_ENABLE_HTTP_DOCS = "1"
  try {
    const app = Server.createApp({ hostname: "0.0.0.0", port: 4096 })
    const response = await app.fetch(new Request("http://0.0.0.0:4096/doc"))

    expect(response.status).toBe(200)
  } finally {
    if (previous === undefined) delete process.env.AX_CODE_ENABLE_HTTP_DOCS
    else process.env.AX_CODE_ENABLE_HTTP_DOCS = previous
  }
})

test("websocket upgrades reject cross-origin browser requests", async () => {
  const app = Server.createApp({ hostname: "127.0.0.1", port: 4096 })
  const response = await app.fetch(
    new Request("http://127.0.0.1:4096/pty/pty_1/connect", {
      headers: {
        origin: "https://evil.example",
        upgrade: "websocket",
      },
    }),
  )

  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({
    name: "InvalidRequestError",
    message: "Origin mismatch",
    status: 403,
  })
})

test("direct app creation ignores remote CORS allowlist entries", async () => {
  const app = Server.createApp({ hostname: "127.0.0.1", port: 4096, cors: ["https://evil.example"] })
  const response = await app.fetch(
    new Request("http://127.0.0.1:4096/pty/pty_1/connect", {
      headers: {
        origin: "https://evil.example",
        upgrade: "websocket",
      },
    }),
  )

  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({ message: "Origin mismatch" })
})

test("pty create rejects invalid cwd as a client error", async () => {
  await using tmp = await tmpdir({ git: true })
  const directory = encodeURIComponent(tmp.path)
  const response = await Server.Default().request(`/pty?directory=${directory}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: "missing-directory" }),
  })

  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({
    name: "InvalidRequestError",
    details: { resource: "ptyCwd" },
  })
})

test("path route resolves symlinked directory requests to their canonical path", async () => {
  await using tmp = await tmpdir({ git: true })
  const link = path.join(tmp.path, "..", `${path.basename(tmp.path)}-link`)

  try {
    await fs.symlink(tmp.path, link, process.platform === "win32" ? "junction" : undefined)
    const response = await Server.Default().request(`/path?directory=${encodeURIComponent(link)}`)

    expect(response.status).toBe(200)

    const body = (await response.json()) as { directory: string }
    expect(body.directory).toBe(tmp.path)
  } finally {
    await fs.unlink(link).catch(() => {})
  }
})

test("path route preserves literal percent-encoded sequences in query directories", async () => {
  await using tmp = await tmpdir()
  const target = path.join(tmp.path, "literal%2Fdir")
  await fs.mkdir(target, { recursive: true })

  const response = await Server.Default().request(`/path?directory=${encodeURIComponent(target)}`)

  expect(response.status).toBe(200)
  const body = (await response.json()) as { directory: string }
  expect(body.directory).toBe(target)
})

test("path route still decodes encoded directory headers", async () => {
  await using tmp = await tmpdir()
  const target = path.join(tmp.path, "header encoded")
  await fs.mkdir(target, { recursive: true })

  const response = await Server.Default().request("/path", {
    headers: {
      "x-opencode-directory": encodeURIComponent(target),
    },
  })

  expect(response.status).toBe(200)
  const body = (await response.json()) as { directory: string }
  expect(body.directory).toBe(target)
})

test("path route accepts canonical AX Code directory headers", async () => {
  await using tmp = await tmpdir()
  const target = path.join(tmp.path, "canonical header")
  await fs.mkdir(target, { recursive: true })

  const response = await Server.Default().request("/path", {
    headers: {
      "x-ax-code-directory": encodeURIComponent(target),
    },
  })

  expect(response.status).toBe(200)
  const body = (await response.json()) as { directory: string }
  expect(body.directory).toBe(target)
})

test("path route rejects null byte query directories with 400 instead of 500", async () => {
  await using tmp = await tmpdir()
  const response = await Server.Default().request(`/path?directory=${encodeURIComponent(path.join(tmp.path, "\0bad"))}`)

  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({
    name: "InvalidRequestError",
    details: { resource: "directory" },
  })
})

test("path route rejects null byte header directories with 400 instead of 500", async () => {
  await using tmp = await tmpdir()
  const response = await Server.Default().request("/path", {
    headers: {
      "x-opencode-directory": encodeURIComponent(path.join(tmp.path, "\0bad")),
    },
  })

  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({
    name: "InvalidRequestError",
    details: { resource: "directory" },
  })
})

test("runtime status routes stay mounted at their public paths", async () => {
  await using tmp = await tmpdir({ git: true })
  const app = Server.Default()
  const directory = encodeURIComponent(tmp.path)

  const formatter = await app.request(`/formatter?directory=${directory}`)
  expect(formatter.status).toBe(200)
  expect(Array.isArray(await formatter.json())).toBe(true)

  const lsp = await app.request(`/lsp?directory=${directory}`)
  expect(lsp.status).toBe(200)
  expect(Array.isArray(await lsp.json())).toBe(true)
})

test("experimental worktree delete removes sandbox using the canonical path", async () => {
  await using tmp = await tmpdir({ git: true })
  const sandbox = path.join(tmp.path, "sandbox")
  const link = path.join(tmp.path, "sandbox-link")

  await fs.mkdir(sandbox, { recursive: true })
  await fs.symlink(sandbox, link, process.platform === "win32" ? "junction" : undefined)

  const removeSpy = vi.spyOn(Worktree, "remove").mockResolvedValue(true as never)
  const sandboxSpy = vi.spyOn(Project, "removeSandbox").mockResolvedValue(undefined as never)

  try {
    const response = await Server.Default().request("/experimental/worktree", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-opencode-directory": tmp.path,
      },
      body: JSON.stringify({ directory: link }),
    })

    expect(response.status).toBe(200)
    expect(sandboxSpy).toHaveBeenCalledTimes(1)
    expect(sandboxSpy.mock.calls[0]?.[1]).toBe(sandbox)
  } finally {
    removeSpy.mockRestore()
    sandboxSpy.mockRestore()
    await fs.unlink(link).catch(() => {})
  }
})

test("experimental worktree list includes branch metadata", async () => {
  await using tmp = await tmpdir({ git: true })
  const branch = `list-branch-${Date.now()}`
  const sandbox = path.join(tmp.path, "..", `${path.basename(tmp.path)}-branch`)

  try {
    await $`git worktree add ${sandbox} -b ${branch}`.cwd(tmp.path).quiet()
    const sandboxRealpath = await fs.realpath(sandbox)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Project.addSandbox(Instance.project.id, sandboxRealpath)
      },
    })

    const response = await Server.Default().request("/experimental/worktree", {
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as Array<{ name: string; directory: string; branch?: string }>
    const item = body.find((entry) => entry.branch === branch)
    expect(item).toBeDefined()
    expect(item?.name).toBe(path.basename(sandboxRealpath))
    expect(item?.directory ? await fs.realpath(item.directory) : undefined).toBe(sandboxRealpath)
  } finally {
    await $`git worktree remove --force ${sandbox}`.cwd(tmp.path).quiet().nothrow()
    await fs.rm(sandbox, { recursive: true, force: true }).catch(() => {})
  }
})
