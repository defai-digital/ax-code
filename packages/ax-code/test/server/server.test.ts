import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Server } from "../../src/server/server"
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

    const body = await response.json() as { directory: string }
    expect(body.directory).toBe(tmp.path)
  } finally {
    await fs.unlink(link).catch(() => {})
  }
})
