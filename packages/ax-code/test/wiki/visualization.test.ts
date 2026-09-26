import { describe, expect, test } from "vitest"
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { request } from "node:http"
import { tmpdir } from "../fixture/fixture"
import { WikiVisualization } from "../../src/wiki/visualization"

const manifest = {
  schemaVersion: 1,
  generator: "ax-wiki",
  pages: {
    "guide.md": { title: "Guide", sources: ["src/a.ts"], sourceHashes: { "src/a.ts": "a".repeat(64) } },
  },
}
async function setup(root: string) {
  await mkdir(path.join(root, "ax-wiki"))
  await writeFile(path.join(root, "ax-wiki", ".manifest.json"), JSON.stringify(manifest))
}

describe("Wiki visualization snapshot", () => {
  test("is read-only, source-independent and gives content-bound identity", async () => {
    await using tmp = await tmpdir()
    await setup(tmp.path)
    const before = await readFile(path.join(tmp.path, "ax-wiki", ".manifest.json"), "utf8")
    const graph = await WikiVisualization.snapshot(tmp.path)
    expect(graph.snapshot).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(graph.nodes.every((n) => n.freshness === "unknown")).toBe(true)
    expect(await WikiVisualization.snapshot(tmp.path)).toEqual(graph)
    await writeFile(
      path.join(tmp.path, "ax-wiki", ".manifest.json"),
      JSON.stringify({ pages: manifest.pages, generator: "ax-wiki", schemaVersion: 1 }),
    )
    expect((await WikiVisualization.snapshot(tmp.path)).snapshot).toBe(graph.snapshot)
    expect(JSON.stringify(graph)).not.toContain(tmp.path)
    await writeFile(path.join(tmp.path, "ax-wiki", ".manifest.json"), before.replace('"Guide"', '"Changed"'))
    expect((await WikiVisualization.snapshot(tmp.path)).snapshot).not.toBe(graph.snapshot)
  })
  test("rejects missing, corrupt, oversized, symlinked manifests and unsafe directories", async () => {
    await using tmp = await tmpdir()
    await expect(WikiVisualization.snapshot(tmp.path)).rejects.toThrow(/No Wiki/)
    await setup(tmp.path)
    const file = path.join(tmp.path, "ax-wiki", ".manifest.json")
    await writeFile(file, "{")
    await expect(WikiVisualization.snapshot(tmp.path)).rejects.toThrow()
    await writeFile(file, " ".repeat(4 * 1024 * 1024 + 1))
    await expect(WikiVisualization.snapshot(tmp.path)).rejects.toThrow(/4 MiB/)
    await expect(WikiVisualization.snapshot(tmp.path, "../outside")).rejects.toThrow()
    await mkdir(path.join(tmp.path, "linked"))
    await symlink(file, path.join(tmp.path, "linked", ".manifest.json"))
    await expect(WikiVisualization.snapshot(tmp.path, "linked")).rejects.toThrow(/symlink/)
    await symlink(path.join(tmp.path, "ax-wiki"), path.join(tmp.path, "alias"), "dir")
    await expect(WikiVisualization.snapshot(tmp.path, "alias")).rejects.toThrow(/symlink/)
  })
  test("exports exclusively without replacing existing files or symlinks", async () => {
    await using tmp = await tmpdir()
    await setup(tmp.path)
    const output = path.join(tmp.path, "view.html")
    const document = WikiVisualization.render(await WikiVisualization.snapshot(tmp.path))
    await WikiVisualization.exportHtml(output, document.html)
    expect(await readFile(output, "utf8")).toBe(document.html)
    await expect(WikiVisualization.exportHtml(output, "overwrite")).rejects.toThrow()
    const alias = path.join(tmp.path, "alias.html")
    await symlink(output, alias)
    await expect(WikiVisualization.exportHtml(alias, "overwrite")).rejects.toThrow()
    expect(await readFile(output, "utf8")).toBe(document.html)
  })
})

test("serves only the capability snapshot with exact authority, origin and method checks; closes its port", async () => {
  await using tmp = await tmpdir()
  await setup(tmp.path)
  const document = WikiVisualization.render(await WikiVisualization.snapshot(tmp.path))
  const server = await WikiVisualization.serve(document)
  const url = new URL(server.url)
  const get = (pathname = url.pathname, headers: Record<string, string> = {}, method = "GET") =>
    new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
      const req = request({ hostname: url.hostname, port: url.port, path: pathname, method, headers }, (res) => {
        let body = ""
        res.on("data", (chunk) => {
          body += chunk
        })
        res.on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }))
      })
      req.on("error", reject)
      req.end()
    })
  try {
    const response = await get()
    expect(response.status).toBe(200)
    expect(response.body).toBe(document.html)
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'")
    expect(response.headers["referrer-policy"]).toBe("no-referrer")
    expect(response.headers["cache-control"]).toBe("no-store")
    expect((await get(url.pathname, {}, "HEAD")).body).toBe("")
    expect((await get(url.pathname, { Host: "attacker.test" })).status).toBe(403)
    expect((await get(url.pathname, { Origin: "https://attacker.test" })).status).toBe(403)
    expect((await get(url.pathname, { Origin: url.origin })).status).toBe(200)
    expect((await get(url.pathname, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403)
    expect((await get(url.pathname, {}, "POST")).status).toBe(405)
    for (const route of ["/", "/favicon.ico", `${url.pathname}?extra=1`, `${url.pathname}/../secret`])
      expect((await get(route)).status).toBe(404)
  } finally {
    await server.close()
  }
  await server.close()
  await expect(get()).rejects.toThrow()
})

describe("live Wiki onboarding page", () => {
  test("serves loading before any graph, updates detached public state and embeds graph only on its origin", async () => {
    await using tmp = await tmpdir()
    await setup(tmp.path)
    const listener = await WikiVisualization.serveLive()
    try {
      const page = await fetch(listener.url)
      expect(page.status).toBe(200)
      expect(await page.text()).toContain("Preparing Wiki")
      expect(page.headers.get("content-security-policy")).toContain("connect-src 'self'")
      const initial = await (await fetch(listener.url + "/state")).json()
      expect(initial.phase).toBe("queued")
      const graph = await WikiVisualization.snapshot(tmp.path)
      listener.update({ phase: "ready", reason: "complete", completed: 1, total: 1, revision: 1 }, graph)
      const ready = await (await fetch(listener.url + "/state")).json()
      expect(ready.snapshot).toBe(graph.snapshot)
      expect(JSON.stringify(ready)).not.toContain(tmp.path)
      const child = await fetch(listener.url + "/graph?revision=" + encodeURIComponent(graph.snapshot))
      expect(child.status).toBe(200)
      expect(child.headers.get("content-security-policy")).toContain("frame-ancestors 'self'")
      expect(await child.text()).toContain("wiki-viewer")
      expect((await fetch(listener.url + "/state", { headers: { origin: "https://external.example" } })).status).toBe(
        403,
      )
      expect((await fetch(listener.url + "/state", { method: "POST" })).status).toBe(405)
      expect((await fetch(listener.url + "/other")).status).toBe(404)
    } finally {
      await listener.close()
    }
    await expect(fetch(listener.url)).rejects.toThrow()
  })
})
