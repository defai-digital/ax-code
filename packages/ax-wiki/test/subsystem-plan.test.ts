import { describe, expect, test } from "vitest"
import { buildPure } from "../src/build-pure"
import { createWikiPlan, selectPageSources } from "../src/plan"
import type { WikiPageGenerationRequest, WikiSource } from "../src/types"

function source(path: string, category: WikiSource["category"] = "code", bytes = 100): WikiSource {
  return { path, hash: path, bytes, category }
}

function subsystem(name: string, count = 3, root = "packages/core/src"): WikiSource[] {
  return Array.from({ length: count }, (_, index) => source(`${root}/${name}/${index === 0 ? "index" : index}.ts`))
}

const scopedPath = "modules/core/src/session.md"

describe("bounded subsystem navigation", () => {
  test("gives large package subsystems focused evidence within the existing page cap", () => {
    const sources = [
      ...subsystem("session", 45),
      ...subsystem("provider", 40),
      ...Array.from({ length: 12 }, (_, index) => source(`packages/small-${index}/src/index.ts`)),
      source("packages/core/test/session/rollback.test.ts", "test"),
      source("packages/core/tests/session.spec.ts", "test"),
      source("packages/core/test/provider/routing.test.ts", "test"),
    ]
    const plan = createWikiPlan(sources)
    expect(plan.pages).toHaveLength(12)
    expect(plan.pages.map((page) => page.path)).toContain(scopedPath)
    expect(plan.pages.map((page) => page.path)).toContain("modules/core/src/provider.md")
    expect(plan.pages.findIndex((page) => page.path === "modules/core.md")).toBeLessThan(
      plan.pages.findIndex((page) => page.path === scopedPath),
    )
    const page = plan.pages.find((page) => page.path === scopedPath)!
    const selected = selectPageSources(sources, page, 4)
    expect(selected.map((item) => item.path)).toEqual([
      "packages/core/src/session/index.ts",
      "packages/core/test/session/rollback.test.ts",
      "packages/core/tests/session.spec.ts",
      "packages/core/src/session/1.ts",
    ])
    expect(page.purpose).toContain("tests")
    expect(createWikiPlan([...sources].reverse())).toEqual(plan)
  })

  test("splits byte-heavy packages even below the source-count limit", () => {
    const sources = [...subsystem("session"), ...subsystem("provider")].map((item) => ({ ...item, bytes: 32_000 }))
    expect(createWikiPlan(sources).pages.map((page) => page.path)).toContain(scopedPath)
    expect(createWikiPlan(sources, { maxPageSourceBytes: 200_000 }).pages.map((page) => page.path)).not.toContain(
      scopedPath,
    )
  })

  test("respects small-project behavior, explicit plans and tight page limits", () => {
    const sources = [...subsystem("session"), ...subsystem("provider")]
    expect(createWikiPlan(sources).pages).toHaveLength(4)
    for (const maxPages of [3, 4, 5]) {
      const plan = createWikiPlan(sources, { maxPages, maxSourcesPerPage: 3 })
      expect(plan.pages).toHaveLength(maxPages)
      expect(plan.pages.slice(0, 3).map((page) => page.kind)).toEqual(["quickstart", "architecture", "development"])
    }
    const pages = [{ path: "quickstart.md", title: "Start", purpose: "Curated entry", selectors: ["**"] }]
    expect(createWikiPlan(sources, { pages, maxSourcesPerPage: 1 }).pages).toEqual([{ ...pages[0], kind: "custom" }])
  })

  test("does not invent subsystems from test-only trees or one-file directories", () => {
    const sources = [
      ...subsystem("session", 20),
      ...subsystem("tiny", 1),
      ...subsystem("__tests__", 20),
      ...subsystem("fixtures", 20).map((item) => ({ ...item, category: "test" as const })),
    ]
    expect(createWikiPlan(sources, { maxSourcesPerPage: 3 }).pages).toHaveLength(4)
  })

  test("keeps standalone source modules and disambiguates package, root and subsystem names", () => {
    const sources = [
      ...subsystem("foo-bar", 3),
      ...subsystem("foo_bar", 3),
      ...subsystem("foo-bar", 3, "packages/core/lib"),
      ...subsystem("session", 3, "apps/core/src"),
      ...subsystem("provider", 3, "apps/core/src"),
      source("src/session/index.ts"),
    ]
    const plan = createWikiPlan(sources, { maxSourcesPerPage: 3, maxPages: 40 })
    const paths = plan.pages.map((page) => page.path)
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toContain("modules/core/src/foo-bar.md")
    expect(paths).toContain("modules/core/src/foo-bar-2.md")
    expect(paths).toContain("modules/core/lib/foo-bar.md")
    expect(paths).toContain("modules/core-2/src/session.md")
    expect(paths).toContain("modules/session.md")
    expect(createWikiPlan([...sources].reverse(), { maxSourcesPerPage: 3, maxPages: 40 })).toEqual(plan)
  })

  test("test sampling remains bounded and does not duplicate or change custom-page evidence", () => {
    const sources = [source("src/index.ts"), source("test/a.test.ts", "test"), source("test/b.test.ts", "test")]
    const page = { path: "module.md", title: "Module", purpose: "Explain", selectors: ["**"], kind: "module" as const }
    expect(selectPageSources(sources, page, 1)).toEqual([sources[0]])
    expect(selectPageSources(sources, page, 2)).toEqual(sources.slice(0, 2))
    expect(selectPageSources(sources, page, 10)).toEqual(sources)
    expect(selectPageSources(sources.slice(1), page, 10)).toEqual(sources.slice(1))
    const withMoreCode = [...sources, source("src/api.ts")]
    expect(selectPageSources(withMoreCode, { ...page, kind: "custom" }, 2).map((item) => item.path)).toEqual([
      "src/index.ts",
      "src/api.ts",
    ])
  })
})

test("subsystem builds cite scoped evidence and reuse unrelated pages on update", async () => {
  const sources = [
    source("README.md", "documentation"),
    ...subsystem("session"),
    ...subsystem("provider"),
    source("packages/core/test/session/rollback.test.ts", "test"),
  ]
  const calls: WikiPageGenerationRequest[] = []
  const input = {
    root: "/virtual/repo",
    wikiDir: "ax-wiki",
    sources,
    config: { maxSourcesPerPage: 4 },
    generator: async (request: WikiPageGenerationRequest) => {
      calls.push(request)
      return {
        summary: `Source-backed navigation for ${request.page.title}.`,
        body: "## Change guidance\n\nRead the supplied implementation and regression tests, verify current source before making changes, and run the relevant checks.",
      }
    },
    evidenceReader: async ({ sources }: { sources: WikiSource[] }) =>
      sources.map((item) => ({ ...item, content: `Evidence for ${item.path}`, truncated: false })),
    readExistingPage: async () => undefined,
  }
  const first = await buildPure({ ...input, action: "generate" })
  expect(first.validation.ok).toBe(true)
  const session = calls.find((call) => call.page.path === scopedPath)
  expect(session).toBeDefined()
  expect(session!.sources.map((item) => item.path)).toContain("packages/core/test/session/rollback.test.ts")
  expect(session!.sources.every((item) => item.path.includes("/session/"))).toBe(true)
  expect(first.manifest.pages[scopedPath].sources).toEqual(session!.sources.map((item) => item.path))

  const changed = sources.map((item) =>
    item.path === "packages/core/src/session/index.ts" ? { ...item, hash: "edited-session" } : item,
  )
  calls.length = 0
  const updated = await buildPure({
    ...input,
    sources: changed,
    action: "update",
    previous: first.manifest,
    readExistingPage: async (pagePath) => first.candidate.get(pagePath),
  })
  expect(updated.validation.ok).toBe(true)
  expect(updated.generatedPages.sort()).toEqual(["modules/core.md", scopedPath].sort())
  expect(updated.unchangedPages).toContain("modules/core/src/provider.md")
  expect(updated.candidate.get("modules/core/src/provider.md")).toBe(
    first.candidate.get("modules/core/src/provider.md"),
  )
})
