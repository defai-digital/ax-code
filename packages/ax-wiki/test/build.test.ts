import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import {
  AX_WIKI_PROTECTED_END,
  AX_WIKI_PROTECTED_START,
  buildAxWiki,
  lintWiki,
  loadWikiManifest,
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

function generator(): WikiPageGenerator {
  return vi.fn(async (request) => ({
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

  test("reports invalid core configuration instead of silently ignoring it", async () => {
    const root = await fixture()
    await writeFile(path.join(root, "ax-wiki.config.json"), "{invalid-json")
    await expect(buildAxWiki({ root, action: "generate", generator: generator() })).rejects.toThrow(
      "Invalid AX Wiki config",
    )
  })
})
