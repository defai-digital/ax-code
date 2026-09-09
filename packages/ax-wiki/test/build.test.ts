import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import {
  AX_WIKI_PROTECTED_END,
  AX_WIKI_PROTECTED_START,
  buildAxWiki,
  emptyEvidenceBundle,
  lintWiki,
  getWikiStatus,
  maybeRenderAxWikiProtocol,
  loadWikiManifest,
  mergeProtectedSections,
  type WikiPageGenerationRequest,
  type WikiPageGenerator,
} from "../src"

const roots: string[] = []

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-wiki-test-"))
  roots.push(root)
  await mkdir(path.join(root, "packages/core/src"), { recursive: true })
  await mkdir(path.join(root, "packages/web/src"), { recursive: true })
  await writeFile(path.join(root, "README.md"), "# Fixture\n\nA repository used to test AX Wiki.\n")
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture", scripts: { test: "vitest" } }))
  await writeFile(path.join(root, "packages/core/src/index.ts"), "export function coreValue() { return 1 }\n")
  await writeFile(path.join(root, "packages/web/src/index.ts"), "export function webValue() { return 'web' }\n")
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function generator() {
  return vi.fn(async (request: WikiPageGenerationRequest) => ({
    summary: `Source-backed guide for ${request.page.title} and its repository responsibilities.`,
    body: `## Purpose\n\nThis page explains ${request.page.purpose} The claims are grounded in the selected repository files and should be verified against code before structural changes.\n\n## Change guidance\n\nStart with the cited source files, run the repository tests, and use code intelligence for exact callers and references.`,
    symbols: request.page.kind === "module" ? [`${request.page.title.replace(/ Module$/, "")}Value`] : [],
  }))
}

describe("AX Wiki build lifecycle", () => {
  test("generates, skips unchanged pages, and updates only affected pages", async () => {
    const root = await fixture()
    const generate = generator()
    const first = await buildAxWiki({
      root,
      action: "generate",
      generator: generate,
      now: () => new Date("2026-01-01T00:00:00Z"),
    })
    expect(first.generatedPages).toHaveLength(5)
    expect(first.validation.ok).toBe(true)
    expect(await loadWikiManifest(root)).toBeDefined()

    const unchanged = await buildAxWiki({ root, action: "update", generator: generate })
    expect(unchanged.generatedPages).toEqual([])

    await writeFile(path.join(root, "packages/core/src/index.ts"), "export function coreValue() { return 2 }\n")
    const updated = await buildAxWiki({ root, action: "update", generator: generate })
    expect(updated.generatedPages).toEqual(["modules/core.md"])
  })

  test("preserves maintainer-owned sections and rejects unmanaged edits", async () => {
    const root = await fixture()
    const generate = generator()
    await buildAxWiki({ root, action: "generate", generator: generate })
    const page = path.join(root, "ax-wiki/modules/core.md")
    const original = await readFile(page, "utf8")
    const protectedNotes = `${AX_WIKI_PROTECTED_START} maintainer-notes -->\nKeep this operational warning.\n${AX_WIKI_PROTECTED_END}`
    await writeFile(page, original.replace("\n## Sources", `\n\n${protectedNotes}\n\n## Sources`))
    await writeFile(path.join(root, "packages/core/src/index.ts"), "export function coreValue() { return 3 }\n")
    await buildAxWiki({ root, action: "update", generator: generate })
    expect(await readFile(page, "utf8")).toContain("Keep this operational warning.")

    await writeFile(page, `${await readFile(page, "utf8")}\nUnmanaged manual edit.\n`)
    const lint = await lintWiki({ root })
    expect(lint.ok).toBe(false)
    expect(lint.issues.some((issue) => issue.code === "wiki.page_modified")).toBe(true)
    await writeFile(path.join(root, "packages/core/src/index.ts"), "export function coreValue() { return 4 }\n")
    await expect(buildAxWiki({ root, action: "update", generator: generate })).rejects.toThrow("manually modified")
  })

  test("preserves protected content containing $-patterns verbatim on merge", () => {
    // Regression test: String#replace treats a plain-string *replacement* specially
    // ($$, $&, $`, $', $1..) — mergeProtectedSections must not let those sequences in
    // a preserved section's raw content be reinterpreted when it is spliced back in.
    const id = "maintainer-notes"
    const raw = `${AX_WIKI_PROTECTED_START} ${id} -->\nDisplay math: $$ E=mc^2 $$ and a match ref $& plus $\` and $'.\n${AX_WIKI_PROTECTED_END}`
    const existing = `# Page\n\n${raw}\n\n## Sources\n`
    // The freshly generated content happens to contain a section with the same id
    // (e.g. an LLM generator echoing back what it was shown) that must be replaced
    // by, not merged with, the preserved raw content.
    const staleRaw = `${AX_WIKI_PROTECTED_START} ${id} -->\nstale\n${AX_WIKI_PROTECTED_END}`
    const generated = `# Page\n\n${staleRaw}\n\n## Sources\n`

    const merged = mergeProtectedSections(generated, existing)
    expect(merged).toContain(raw)
    expect(merged).not.toContain("stale")
  })

  test("validates the complete candidate before writing", async () => {
    const root = await fixture()
    const invalid: WikiPageGenerator = async (request) => ({
      summary: `A sufficiently detailed summary for ${request.page.title}.`,
      body: "## Invalid link\n\nThis intentionally long page contains enough prose to pass the minimum content check, but links to a page that is not part of the generated plan. [Missing](missing.md)",
      symbols: [],
    })
    await expect(buildAxWiki({ root, action: "generate", generator: invalid })).rejects.toThrow("wiki.link_broken")
    await expect(readFile(path.join(root, "ax-wiki/.manifest.json"), "utf8")).rejects.toThrow()
  })

  test("lint detects source staleness independently of git HEAD", async () => {
    const root = await fixture()
    await buildAxWiki({ root, action: "generate", generator: generator() })
    expect((await lintWiki({ root })).stale).toBe(false)
    await writeFile(path.join(root, "README.md"), "# Fixture changed\n")
    const report = await lintWiki({ root })
    expect(report.stale).toBe(true)
    expect(report.issues.some((issue) => issue.code === "wiki.stale")).toBe(true)
  })

  test("runtime wiki consumption marks modified sources stale while preserving structural health", async () => {
    const root = await fixture()
    await buildAxWiki({ root, action: "generate", generator: generator() })
    expect((await getWikiStatus({ root })).freshness).toBe("fresh")
    await writeFile(path.join(root, "README.md"), "# Updated source\n")
    const status = await getWikiStatus({ root })
    expect(status.healthy).toBe(true)
    expect(status.stale).toBe(true)
    expect(status.freshness).toBe("stale")
    const protocol = await maybeRenderAxWikiProtocol(root)
    expect(protocol).toContain("stale")
    expect(protocol).toContain("navigation only")
    expect(protocol).not.toContain("Prefer the wiki before")
  })

  test.each(["add", "delete"])("runtime freshness detects a source %s without a commit", async (change) => {
    const root = await fixture()
    await buildAxWiki({ root, action: "generate", generator: generator() })
    if (change === "add") await writeFile(path.join(root, "added.ts"), "export const added = true\n")
    else await rm(path.join(root, "packages/core/src/index.ts"))
    expect((await getWikiStatus({ root })).freshness).toBe("stale")
    expect((await lintWiki({ root })).stale).toBe(true)
  })

  test("runtime freshness honors explicit source exclusions and custom wiki paths", async () => {
    const root = await fixture()
    const config = { exclude: ["packages/web/**"] }
    const wikiDir = "knowledge"
    await buildAxWiki({ root, wikiDir, config, action: "generate", generator: generator() })
    await writeFile(path.join(root, "packages/web/src/index.ts"), "export const changed = true\n")
    expect((await getWikiStatus({ root, wikiDir, config })).freshness).toBe("fresh")
    expect(await maybeRenderAxWikiProtocol(root, { wikiDir, config })).toContain("Source freshness: fresh")
    expect((await getWikiStatus({ root, wikiDir })).freshness).toBe("stale")
  })

  test("undefined runtime config does not erase source exclusions from disk", async () => {
    const root = await fixture()
    await writeFile(path.join(root, "ax-wiki.config.json"), JSON.stringify({ exclude: ["packages/web/**"] }))
    await buildAxWiki({ root, action: "generate", generator: generator() })
    expect((await getWikiStatus({ root, config: { exclude: undefined } })).freshness).toBe("fresh")
  })

  test("invalid source configuration leaves wiki available but freshness unknown", async () => {
    const root = await fixture()
    await buildAxWiki({ root, action: "generate", generator: generator() })
    await writeFile(path.join(root, "ax-wiki.config.json"), "{invalid-json")
    expect(await getWikiStatus({ root })).toMatchObject({ healthy: true, freshness: "unknown" })
    const protocol = await maybeRenderAxWikiProtocol(root)
    expect(protocol).toContain("freshness: unknown")
    expect(protocol).toContain("navigation only")
    expect(protocol).not.toContain("Prefer the wiki before")
  })

  test.runIf(process.platform !== "win32" && process.getuid?.() !== 0)(
    "unreadable sources cannot verify as fresh",
    async () => {
      const root = await fixture()
      await buildAxWiki({ root, action: "generate", generator: generator() })
      const file = path.join(root, "README.md")
      await chmod(file, 0)
      try {
        expect(await getWikiStatus({ root })).toMatchObject({ healthy: true, freshness: "unknown" })
        await expect(lintWiki({ root })).rejects.toThrow()
      } finally {
        await chmod(file, 0o600)
      }
    },
  )

  test("missing and disabled wiki paths do not load invalid source configuration", async () => {
    const root = await fixture()
    await writeFile(path.join(root, "ax-wiki.config.json"), "{invalid-json")
    expect(await getWikiStatus({ root })).toMatchObject({ healthy: false, freshness: "unknown" })
    expect(await maybeRenderAxWikiProtocol(root)).toBeUndefined()
    expect(await maybeRenderAxWikiProtocol(root, { enabled: false })).toBeUndefined()
  })

  test.runIf(process.platform !== "win32")("refuses a symlinked output directory", async () => {
    const root = await fixture()
    const outside = `${root}-outside-wiki`
    roots.push(outside)
    await mkdir(outside)
    await symlink(outside, path.join(root, "ax-wiki"))
    await expect(buildAxWiki({ root, action: "generate", generator: generator() })).rejects.toThrow(
      "symlinked output paths",
    )
    await expect(readFile(path.join(outside, ".manifest.json"), "utf8")).rejects.toThrow()
  })

  test("forwards typed evidence to the generator and prefers it over graphContext", async () => {
    const root = await fixture()
    const generate = generator()
    const graphContext = vi.fn(async () => "legacy-graph-context")
    const provide = vi.fn(async ({ root: evidenceRoot }: { root: string }) =>
      emptyEvidenceBundle({
        root: evidenceRoot,
        completeness: "queried-zero-results",
        provenance: { producer: "test", producerVersion: "0.0.0", method: "injected" },
      }),
    )
    const result = await buildAxWiki({
      root,
      action: "generate",
      generator: generate,
      graphContext,
      evidenceProvider: { provide },
      now: () => new Date("2026-01-01T00:00:00Z"),
    })
    expect(graphContext).not.toHaveBeenCalled()
    expect(provide).toHaveBeenCalledTimes(result.plan.pages.length)
    expect(generate.mock.calls[0]![0].evidence?.completeness).toBe("queried-zero-results")
    expect(generate.mock.calls[0]![0].graphContext).toContain("# Semantic Evidence")
  })

  test("reports invalid core configuration instead of silently ignoring it", async () => {
    const root = await fixture()
    await writeFile(path.join(root, "ax-wiki.config.json"), "{invalid-json")
    await expect(buildAxWiki({ root, action: "generate", generator: generator() })).rejects.toThrow(
      "Invalid AX Wiki config",
    )
  })

  test("rejects a corrupt manifest instead of silently rebuilding over manual edits", async () => {
    const root = await fixture()
    await buildAxWiki({ root, action: "generate", generator: generator() })
    await writeFile(path.join(root, "ax-wiki/.manifest.json"), "{corrupt-json")
    await expect(buildAxWiki({ root, action: "update", generator: generator() })).rejects.toThrow(
      "manifest is not valid JSON",
    )
  })
})
