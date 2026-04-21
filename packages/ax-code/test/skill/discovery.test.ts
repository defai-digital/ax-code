import { describe, test, expect, beforeAll, afterAll, spyOn } from "bun:test"
import { Effect } from "effect"
import { Discovery } from "../../src/skill/discovery"
import { Global } from "../../src/global"
import { Filesystem } from "../../src/util/filesystem"
import { rm } from "fs/promises"
import path from "path"
import dns from "dns/promises"
import { createHash } from "crypto"

let CLOUDFLARE_SKILLS_URL: string
let downloadCount = 0
let externalFetchCount = 0
const origin = "http://example.com"
const originalFetch = globalThis.fetch
let lookupSpy: ReturnType<typeof spyOn>

const fixturePath = path.join(import.meta.dir, "../fixture/skills")
const cacheDir = path.join(Global.Path.cache, "skills")
const safeSkillBody = "# Safe Skill"
const safeSkillHash = createHash("sha256").update(safeSkillBody).digest("hex")
const publicHost = new URL(origin).host

beforeAll(async () => {
  await rm(cacheDir, { recursive: true, force: true })

  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      const url = new URL(req.url)
      const host = req.headers.get("Host")

      if (host === "attacker.example" || url.pathname === "/payload.md") {
        externalFetchCount++
        return new Response("External fetch should be rejected", { status: 500 })
      }

      if (url.pathname === "/unsafe-skills/index.json") {
        return Response.json({
          skills: [{ name: "../evil", files: ["SKILL.md"] }],
        })
      }

      if (url.pathname === "/external-file/index.json") {
        return Response.json({
          skills: [
            {
              name: "safe-skill",
              files: [
                { path: "SKILL.md", sha256: safeSkillHash },
                { path: "https://attacker.example/payload.md", sha256: "0".repeat(64) },
              ],
            },
          ],
        })
      }

      if (url.pathname === "/external-file/safe-skill/SKILL.md") {
        return new Response(safeSkillBody)
      }

      if (url.pathname === "/hashed-skill/index.json") {
        return Response.json({
          skills: [{ name: "safe-skill", files: [{ path: "SKILL.md", sha256: safeSkillHash }] }],
        })
      }

      if (url.pathname === "/hashed-skill/safe-skill/SKILL.md") {
        return new Response(safeSkillBody)
      }

      if (url.pathname === "/bad-hash/index.json") {
        return Response.json({
          skills: [{ name: "safe-skill", files: [{ path: "SKILL.md", sha256: "0".repeat(64) }] }],
        })
      }

      if (url.pathname === "/bad-hash/safe-skill/SKILL.md") {
        return new Response(safeSkillBody)
      }

      if (url.pathname === "/hashless-skill/index.json") {
        return Response.json({
          skills: [{ name: "safe-skill", files: ["SKILL.md"] }],
        })
      }

      if (url.pathname === "/hashless-skill/safe-skill/SKILL.md") {
        return new Response(safeSkillBody)
      }

      // Only serve the local fixture for the expected public test origin.
      if ((host === publicHost || url.host === publicHost) && url.pathname.startsWith("/.well-known/skills/")) {
        const filePath = url.pathname.replace("/.well-known/skills/", "")
        const fullPath = path.join(fixturePath, filePath)

        if (await Filesystem.exists(fullPath)) {
          if (!fullPath.endsWith("index.json")) {
            downloadCount++
          }
          return new Response(Bun.file(fullPath))
        }
      }

      return new Response("Not Found", { status: 404 })
    },
    { preconnect: originalFetch.preconnect },
  ) as typeof fetch

  lookupSpy = spyOn(dns, "lookup").mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }] as any)
  CLOUDFLARE_SKILLS_URL = `${origin}/.well-known/skills/`
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  lookupSpy.mockRestore()
  await rm(cacheDir, { recursive: true, force: true })
})

describe("Discovery.pull", () => {
  const pull = (url: string) =>
    Effect.runPromise(Discovery.Service.use((s) => s.pull(url)).pipe(Effect.provide(Discovery.defaultLayer)))

  test("downloads skills from cloudflare url", async () => {
    const dirs = await pull(CLOUDFLARE_SKILLS_URL)
    expect(dirs.length).toBeGreaterThan(0)
    for (const dir of dirs) {
      expect(dir).toStartWith(cacheDir)
      const md = path.join(dir, "SKILL.md")
      expect(await Filesystem.exists(md)).toBe(true)
    }
  })

  test("url without trailing slash works", async () => {
    const dirs = await pull(CLOUDFLARE_SKILLS_URL.replace(/\/$/, ""))
    expect(dirs.length).toBeGreaterThan(0)
    for (const dir of dirs) {
      const md = path.join(dir, "SKILL.md")
      expect(await Filesystem.exists(md)).toBe(true)
    }
  })

  test("returns empty array for invalid url", async () => {
    const dirs = await pull(`${origin}/invalid-url/`)
    expect(dirs).toEqual([])
  })

  test("returns empty array for non-json response", async () => {
    // any url not explicitly handled in server returns 404 text "Not Found"
    const dirs = await pull(`${origin}/some-other-path/`)
    expect(dirs).toEqual([])
  })

  test("rejects private skill discovery urls", async () => {
    const dirs = await pull("http://127.0.0.1/.well-known/skills/")
    expect(dirs).toEqual([])
  })

  test("rejects unsafe remote skill names before cache writes", async () => {
    await rm(path.join(cacheDir, "..", "evil"), { recursive: true, force: true })
    const dirs = await pull(`${origin}/unsafe-skills/`)
    expect(dirs).toEqual([])
    expect(await Filesystem.exists(path.join(cacheDir, "..", "evil", "SKILL.md"))).toBe(false)
  })

  test("rejects external file references from remote skill index", async () => {
    externalFetchCount = 0
    const dirs = await pull(`${origin}/external-file/`)
    expect(dirs.length).toBe(1)
    expect(externalFetchCount).toBe(0)
  })

  test("accepts skill files with matching sha256 integrity metadata", async () => {
    await rm(path.join(cacheDir, "safe-skill"), { recursive: true, force: true })
    const dirs = await pull(`${origin}/hashed-skill/`)
    expect(dirs.length).toBe(1)
    expect(await Filesystem.exists(path.join(cacheDir, "safe-skill", "SKILL.md"))).toBe(true)
  })

  test("rejects skill files with mismatched sha256 integrity metadata", async () => {
    await rm(path.join(cacheDir, "safe-skill"), { recursive: true, force: true })
    const dirs = await pull(`${origin}/bad-hash/`)
    expect(dirs).toEqual([])
    expect(await Filesystem.exists(path.join(cacheDir, "safe-skill", "SKILL.md"))).toBe(false)
  })

  test("rejects hashless skill file entries", async () => {
    await rm(path.join(cacheDir, "safe-skill"), { recursive: true, force: true })
    const dirs = await pull(`${origin}/hashless-skill/`)
    expect(dirs).toEqual([])
    expect(await Filesystem.exists(path.join(cacheDir, "safe-skill", "SKILL.md"))).toBe(false)
  })

  test("downloads reference files alongside SKILL.md", async () => {
    const dirs = await pull(CLOUDFLARE_SKILLS_URL)
    // find a skill dir that should have reference files (e.g. agents-sdk)
    const agentsSdk = dirs.find((d) => d.endsWith(path.sep + "agents-sdk"))
    expect(agentsSdk).toBeDefined()
    if (agentsSdk) {
      const refs = path.join(agentsSdk, "references")
      expect(await Filesystem.exists(path.join(agentsSdk, "SKILL.md"))).toBe(true)
      // agents-sdk has reference files per the index
      const refDir = await Array.fromAsync(new Bun.Glob("**/*.md").scan({ cwd: refs, onlyFiles: true }))
      expect(refDir.length).toBeGreaterThan(0)
    }
  })

  test("caches downloaded files on second pull", async () => {
    // clear dir and downloadCount
    await rm(cacheDir, { recursive: true, force: true })
    downloadCount = 0

    // first pull to populate cache
    const first = await pull(CLOUDFLARE_SKILLS_URL)
    expect(first.length).toBeGreaterThan(0)
    const firstCount = downloadCount
    expect(firstCount).toBeGreaterThan(0)

    // second pull should return same results from cache
    const second = await pull(CLOUDFLARE_SKILLS_URL)
    expect(second.length).toBe(first.length)
    expect(second.sort()).toEqual(first.sort())

    // second pull should NOT increment download count
    expect(downloadCount).toBe(firstCount)
  })
})
