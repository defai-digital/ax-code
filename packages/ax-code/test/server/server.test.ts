import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
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
