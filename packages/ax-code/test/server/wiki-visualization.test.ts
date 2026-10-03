import { afterEach, expect, test } from "vitest"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"
import { fetchWikiVisualization } from "../../src/cli/tui/util/wiki-visualization"

afterEach(async () => {
  await Instance.disposeAll()
})
const manifest = {
  schemaVersion: 1,
  generator: "ax-wiki",
  pages: {
    "guide.md": { title: "Remote guide", sources: ["private/a.ts"], sourceHashes: { "private/a.ts": "a".repeat(64) } },
  },
}
function request(root: string) {
  return Server.Default().request("/experimental/wiki-visualization", { headers: { "x-opencode-directory": root } })
}
test("runtime snapshot is scoped, configured, read-only and excludes source bytes and absolute roots", async () => {
  await using tmp = await tmpdir({ git: true })
  await writeFile(path.join(tmp.path, "ax-code.json"), JSON.stringify({ wiki: { dir: "project-wiki" } }))
  await mkdir(path.join(tmp.path, "project-wiki"))
  const file = path.join(tmp.path, "project-wiki", ".manifest.json")
  await writeFile(file, JSON.stringify(manifest))
  const before = await readFile(file, "utf8")
  const response = await request(tmp.path)
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
  const body = await response.text()
  expect(body).not.toContain(tmp.path)
  expect(body).toContain("Remote guide")
  expect(await readFile(file, "utf8")).toBe(before)
  const transport: typeof fetch = async (url, init) => Server.Default().request(new Request(url, init))
  const graph = await fetchWikiVisualization({
    base: "http://runtime/",
    directory: tmp.path,
    fetch: transport,
    signal: new AbortController().signal,
  })
  expect(graph.scope).toBe("wiki-manifest")
  expect(graph.nodes).toHaveLength(2)
})
test("missing, invalid and oversized artifacts give bounded errors without private paths", async () => {
  await using tmp = await tmpdir({ git: true })
  expect(await (await request(tmp.path)).json()).toMatchObject({ code: "missing" })
  await mkdir(path.join(tmp.path, ".ax-wiki"))
  const file = path.join(tmp.path, ".ax-wiki", ".manifest.json")
  for (const [text, code] of [
    ["{broken", "invalid"],
    ["x".repeat(4 * 1024 * 1024 + 1), "too_large"],
  ]) {
    await writeFile(file, text)
    const response = await request(tmp.path)
    expect(response.status).toBe(400)
    const body = await response.text()
    expect(body).not.toContain(tmp.path)
    expect(body).toContain(`"code":"${code}"`)
  }
})
