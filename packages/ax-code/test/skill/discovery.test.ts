import { describe, test, expect, beforeAll, afterAll, vi, type MockInstance } from "vitest"
import { Discovery } from "../../src/skill/discovery"
import { Global } from "../../src/global"
import { Filesystem } from "../../src/util/filesystem"
import { Ssrf } from "../../src/util/ssrf"
import { rm, readFile, readdir } from "fs/promises"
import path from "path"
import dns from "dns/promises"
import { createHash } from "crypto"

let CLOUDFLARE_SKILLS_URL: string
let downloadCount = 0
let externalFetchCount = 0
const origin = "http://example.com"
const originalFetch = globalThis.fetch
let lookupSpy: MockInstance
let pinnedFetchSpy: MockInstance

const fixturePath = path.join(import.meta.dirname, "../fixture/skills")
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
          return new Response(new Uint8Array(await readFile(fullPath)))
        }
      }

      return new Response("Not Found", { status: 404 })
    },
    { preconnect: (originalFetch as { preconnect?: unknown }).preconnect },
  ) as typeof fetch

  lookupSpy = vi.spyOn(dns, "lookup").mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }] as any)
  pinnedFetchSpy = vi.spyOn(Ssrf, "pinnedFetch").mockImplementation(async (url, init) => {
    await Ssrf.assertPublicUrl(url, init?.label)
    const { label: _label, ...fetchInit } = init ?? {}
    return globalThis.fetch(url, fetchInit)
  })
  CLOUDFLARE_SKILLS_URL = `${origin}/.well-known/skills/`
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  pinnedFetchSpy.mockRestore()
  lookupSpy.mockRestore()
  await rm(cacheDir, { recursive: true, force: true })
})

describe("Discovery.pull", () => {
  const pull = (url: string) => Discovery.pull(url)
  let literalAttempt = 0

  test.each([
    ["references/overview#details.md", "references/overview%23details.md"],
    ["references/version%notes.md", "references/version%25notes.md"],
    ["%2e%2e/escaped.md", "%252e%252e/escaped.md"],
    ["references/with spaces.md", "references/with%20spaces.md"],
  ])("downloads the literal manifest filename %s", async (filename, encoded) => {
    const implementation = pinnedFetchSpy.getMockImplementation()!
    const requested: string[] = []
    const base = `${origin}/literal-paths-${++literalAttempt}/`
    pinnedFetchSpy.mockImplementation(async (url) => {
      requested.push(String(url))
      if (String(url) === `${base}index.json`)
        return Response.json({
          skills: [
            {
              name: "literal-skill",
              files: [
                { path: "SKILL.md", sha256: safeSkillHash },
                { path: filename, sha256: safeSkillHash },
              ],
            },
          ],
        })
      return new Response(safeSkillBody)
    })
    try {
      const roots = await pull(base)
      expect(roots).toHaveLength(1)
      expect(requested.sort()).toEqual(
        [`${base}index.json`, `${base}literal-skill/SKILL.md`, `${base}literal-skill/${encoded}`].sort(),
      )
      expect(await readFile(path.join(roots[0], filename), "utf8")).toBe(safeSkillBody)
    } finally {
      pinnedFetchSpy.mockImplementation(implementation)
    }
  })

  test("ignores malformed Unicode filenames without rejecting a valid skill", async () => {
    pinnedFetchSpy.mockResolvedValueOnce(
      Response.json({
        skills: [
          {
            name: "unicode-skill",
            files: [
              { path: "SKILL.md", sha256: safeSkillHash },
              { path: "references/\uD800.md", sha256: safeSkillHash },
            ],
          },
        ],
      }),
    )
    pinnedFetchSpy.mockResolvedValueOnce(new Response(safeSkillBody))
    const roots = await pull(`${origin}/malformed-unicode/`)
    expect(roots).toHaveLength(1)
    expect(await readdir(roots[0])).toEqual(["SKILL.md"])
  })

  test("rejects backslash network references before fetching them", async () => {
    const implementation = pinnedFetchSpy.getMockImplementation()!
    const requested: string[] = []
    pinnedFetchSpy.mockImplementation(async (url) => {
      requested.push(String(url))
      if (String(url).endsWith("index.json"))
        return Response.json({
          skills: [
            {
              name: "backslash-skill",
              files: [
                { path: "SKILL.md", sha256: safeSkillHash },
                { path: "\\\\attacker.example/payload.md", sha256: safeSkillHash },
              ],
            },
          ],
        })
      return new Response(safeSkillBody)
    })
    try {
      await pull(`${origin}/backslash-source/`)
      expect(requested.every((url) => new URL(url).origin === origin)).toBe(true)
    } finally {
      pinnedFetchSpy.mockImplementation(implementation)
    }
  })

  test.each(["./SKILL.md", "skill.md"])(
    "rejects duplicate destination alias %s before downloading skill files",
    async (alias) => {
      const implementation = pinnedFetchSpy.getMockImplementation()!
      let downloads = 0
      pinnedFetchSpy.mockImplementation(async (url) => {
        if (String(url).endsWith("index.json"))
          return Response.json({
            skills: [
              {
                name: "duplicate-skill",
                files: [
                  { path: "SKILL.md", sha256: safeSkillHash },
                  { path: alias, sha256: safeSkillHash },
                ],
              },
            ],
          })
        downloads++
        return new Response(safeSkillBody)
      })
      try {
        expect(await pull(`${origin}/duplicate-source/`)).toEqual([])
        expect(downloads).toBe(0)
      } finally {
        pinnedFetchSpy.mockImplementation(implementation)
      }
    },
  )

  test("cancels an oversized chunked index before buffering the entire response", async () => {
    const body = new TextEncoder().encode(JSON.stringify({ skills: [], padding: "x".repeat(2 * 1024 * 1024) }))
    let offset = 0
    let cancelled = false
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset === body.length) return controller.close()
          const end = Math.min(offset + 16384, body.length)
          controller.enqueue(body.subarray(offset, end))
          offset = end
        },
        cancel() {
          cancelled = true
        },
      }),
    )
    pinnedFetchSpy.mockResolvedValueOnce(response)
    expect(await pull(`${origin}/oversized-chunked-index/`)).toEqual([])
    expect(cancelled).toBe(true)
    expect(offset).toBeLessThan(body.length)
  })

  test("keeps source and manifest revisions isolated for skills with the same name", async () => {
    const hash = (text: string) => createHash("sha256").update(text).digest("hex")
    async function version(source: string, body: string, resource: string) {
      pinnedFetchSpy.mockResolvedValueOnce(
        Response.json({
          skills: [
            {
              name: "collision-skill",
              files: [
                { path: "SKILL.md", sha256: hash(body) },
                { path: resource, sha256: hash(resource) },
              ],
            },
          ],
        }),
      )
      pinnedFetchSpy.mockImplementationOnce(
        async (url) => new Response(String(url).endsWith("SKILL.md") ? body : resource),
      )
      pinnedFetchSpy.mockImplementationOnce(
        async (url) => new Response(String(url).endsWith("SKILL.md") ? body : resource),
      )
      const roots = await pull(source)
      expect(roots).toHaveLength(1)
      return roots[0]
    }
    const original = await version(`${origin}/source-a/`, "Original", "original.txt")
    const otherSource = await version(`${origin}/source-b/`, "Other source", "other.txt")
    const revised = await version(`${origin}/source-a/`, "Revised", "revised.txt")
    expect(new Set([original, otherSource, revised]).size).toBe(3)
    expect(await readFile(path.join(original, "SKILL.md"), "utf8")).toBe("Original")
    expect(await Filesystem.exists(path.join(revised, "original.txt"))).toBe(false)
  })

  test("decodes skill discovery index values", () => {
    expect(
      Discovery.decodeIndexValue({
        skills: [{ name: "safe-skill", files: [{ path: "SKILL.md", sha256: safeSkillHash }] }],
      }),
    ).toEqual({
      skills: [{ name: "safe-skill", files: [{ path: "SKILL.md", sha256: safeSkillHash }] }],
    })
    expect(() => Discovery.decodeIndexValue({ skills: [{ name: "safe-skill", files: [123] }] })).toThrow()
  })

  test("parses skill discovery index text before value decoding", () => {
    expect(
      Discovery.parseIndexText(
        JSON.stringify({ skills: [{ name: "safe-skill", files: [{ path: "SKILL.md", sha256: safeSkillHash }] }] }),
      ),
    ).toEqual({
      skills: [{ name: "safe-skill", files: [{ path: "SKILL.md", sha256: safeSkillHash }] }],
    })
    expect(() => Discovery.parseIndexText("{not json")).toThrow(SyntaxError)
  })

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
    expect(await Filesystem.exists(path.join(dirs[0], "SKILL.md"))).toBe(true)
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
      const entries = await readdir(refs, { recursive: true })
      const refDir = entries
        .filter((e) => typeof e === "string" && e.endsWith(".md"))
        .map((e) => path.join(refs, String(e)))
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
