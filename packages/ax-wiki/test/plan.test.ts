import { describe, expect, test } from "vitest"
import { createWikiPlan, globToRegExp, sanitizeWikiDir, type WikiSource } from "../src"

function source(path: string): WikiSource {
  return { path, hash: path, bytes: 100, category: path.endsWith(".md") ? "documentation" : "code" }
}

describe("AX Wiki planning and paths", () => {
  test("creates a deterministic core plan and module pages", () => {
    const sources = [source("packages/web/src/index.ts"), source("README.md"), source("packages/core/src/api.ts")]
    const plan = createWikiPlan(sources)
    expect(plan.pages.map((page) => page.path)).toEqual([
      "quickstart.md",
      "architecture/overview.md",
      "development/workflows.md",
      "modules/core.md",
      "modules/web.md",
    ])
    expect(plan.modules.map((module) => module.prefix)).toEqual(["packages/core/", "packages/web/"])
  })

  test("rejects unsafe wiki directories and supports recursive globs", () => {
    expect(sanitizeWikiDir("../../outside")).toBe("ax-wiki")
    expect(sanitizeWikiDir("docs/wiki")).toBe("docs/wiki")
    expect(globToRegExp("packages/**/src/*.ts").test("packages/core/src/api.ts")).toBe(true)
    expect(globToRegExp("packages/**/src/*.ts").test("packages/core/test/api.ts")).toBe(false)
  })

  test("requires quickstart for explicit page plans", () => {
    expect(() =>
      createWikiPlan([source("README.md")], {
        pages: [{ path: "architecture.md", title: "Architecture", purpose: "Explain architecture", selectors: ["**"] }],
      }),
    ).toThrow("must include quickstart.md")
  })
})
