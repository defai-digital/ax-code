import { $ } from "bun"
import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Server } from "../../src/server/server"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

test("cors uses the bound port after --port=0 fallback", async () => {
  const previousUrl = (Server as any).url
  ;(Server as any).url = new URL("http://localhost:52134")

  try {
    const app = Server.createApp({ port: 0 })
    const response = await app.fetch(
      new Request("http://localhost:52134/not-found", {
        headers: {
          origin: "http://localhost:52134",
        },
      }),
    )

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:52134")
  } finally {
    ;(Server as any).url = previousUrl
  }
})

test("/doc is available on loopback app instances", async () => {
  const app = Server.createApp({ hostname: "127.0.0.1", port: 4096 })
  const response = await app.fetch(new Request("http://127.0.0.1:4096/doc"))

  expect(response.status).toBe(200)
  expect(response.headers.get("content-type")).toContain("application/json")
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
  expect(await response.json()).toEqual({ error: "origin mismatch" })
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

test("experimental worktree delete removes sandbox using the canonical path", async () => {
  await using tmp = await tmpdir({ git: true })
  const sandbox = path.join(tmp.path, "sandbox")
  const link = path.join(tmp.path, "sandbox-link")

  await fs.mkdir(sandbox, { recursive: true })
  await fs.symlink(sandbox, link, process.platform === "win32" ? "junction" : undefined)

  const removeSpy = spyOn(Worktree, "remove").mockResolvedValue(true as never)
  const sandboxSpy = spyOn(Project, "removeSandbox").mockResolvedValue(undefined as never)

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
    expect(body).toContainEqual({
      name: path.basename(sandboxRealpath),
      directory: sandboxRealpath,
      branch,
    })
  } finally {
    await $`git worktree remove --force ${sandbox}`.cwd(tmp.path).quiet().nothrow()
    await fs.rm(sandbox, { recursive: true, force: true }).catch(() => {})
  }
})
