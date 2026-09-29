import { describe, expect, test } from "vitest"
import { parseFrontmatter, renderWikiPage } from "../src/frontmatter.js"
import type { WikiPlanPage } from "../src/types.js"

const PAGE: WikiPlanPage = {
  path: "overview.md",
  title: "Overview",
  purpose: "Describe the repository",
  selectors: [],
  kind: "quickstart",
}

function render(
  overrides: {
    title?: string
    summary?: string
    body?: string
    symbols?: string[]
    symbolSummaries?: Array<{ name: string; summary: string }>
    sources?: string[]
  } = {},
) {
  return renderWikiPage({
    page: { ...PAGE, title: overrides.title ?? PAGE.title },
    result: {
      summary: overrides.summary ?? "A summary that is comfortably longer than twenty characters.",
      body: overrides.body ?? "## Purpose\n\nEnough body content to pass the minimum length check for generated pages.",
      symbols: overrides.symbols ?? ["alpha", "beta"],
      symbolSummaries: overrides.symbolSummaries,
    },
    sources: (overrides.sources ?? ["src/index.ts"]).map((source) => ({
      path: source,
      hash: "abc",
      bytes: 10,
      category: "code" as const,
    })),
  })
}

describe("renderWikiPage / parseFrontmatter round trip", () => {
  test("round-trips titles, summaries, symbols, and sources", () => {
    const parsed = parseFrontmatter(render())
    expect(parsed.title).toBe("Overview")
    expect(parsed.summary).toContain("longer than twenty")
    expect(parsed.symbols).toEqual(["alpha", "beta"])
    expect(parsed.sources).toEqual(["src/index.ts"])
    expect(parsed.body).toContain("# Overview")
    expect(parsed.body).toContain("## Sources")
  })

  test("keeps a leading indented code block in the body", () => {
    const content = render({ body: "## Notes\n\n    indented code keeps its four spaces\n\nMore text follows here." })
    const parsed = parseFrontmatter(content)
    expect(parsed.body).toContain("    indented code keeps its four spaces")
  })

  test("does not treat a --- prefix inside a value as the closing delimiter", () => {
    const content = [
      "---",
      'title: "Doc"',
      'summary: "A summary that is comfortably longer than twenty characters."',
      "generated_by: ax-wiki",
      "symbols: []",
      "sources: []",
      "---tricky",
      "---",
      "",
      "body",
    ].join("\n")
    const parsed = parseFrontmatter(content)
    expect(parsed.body).toBe("body")
  })

  test("parses CRLF frontmatter and a BOM prefix", () => {
    const content = render().replaceAll("\n", "\r\n")
    const parsed = parseFrontmatter(`\uFEFF${content}`)
    expect(parsed.title).toBe("Overview")
    expect(parsed.symbols).toEqual(["alpha", "beta"])
  })

  test("a body that is only a heading is dropped instead of duplicating the H1", () => {
    const content = render({ body: "# Overview" })
    expect(content.match(/^# Overview$/gm)!.length).toBe(1)
  })
})

describe("parseFrontmatter hardening", () => {
  test("non-string JSON scalars fall back to raw text instead of lying about types", () => {
    const parsed = parseFrontmatter(
      [
        "---",
        "title: 123",
        'summary: "A summary that is comfortably longer than twenty characters."',
        "---",
        "",
        "b",
      ].join("\n"),
    )
    expect(parsed.title).toBe("123")
    expect(typeof parsed.title).toBe("string")
  })

  test("list items that are not strings fall back to their raw text", () => {
    const parsed = parseFrontmatter(["---", "symbols:", "  - 42", '  - "real"', "---", "", "b"].join("\n"))
    expect(parsed.symbols).toEqual(["42", "real"])
  })

  test("inline lists and unindented list items are accepted", () => {
    const parsed = parseFrontmatter(
      ["---", 'symbols: ["a", "b"]', "sources:", "- src/one.ts", "---", "", "b"].join("\n"),
    )
    expect(parsed.symbols).toEqual(["a", "b"])
    expect(parsed.sources).toEqual(["src/one.ts"])
  })

  test("blank lines and comments inside a block list do not end it", () => {
    const parsed = parseFrontmatter(
      ["---", "symbols:", '  - "a"', "", "# comment", '  - "b"', "---", "", "b"].join("\n"),
    )
    expect(parsed.symbols).toEqual(["a", "b"])
  })

  test("duplicate keys resolve to the last occurrence", () => {
    const parsed = parseFrontmatter(["---", 'title: "first"', 'title: "second"', "---", "", "b"].join("\n"))
    expect(parsed.title).toBe("second")
  })

  test("mismatched quotes are not repaired away", () => {
    const parsed = parseFrontmatter(["---", `title: "oops'`, "---", "", "b"].join("\n"))
    expect(parsed.title).toBe(`"oops'`)
  })
})

describe("renderWikiPage injection guards", () => {
  test("a title with line breaks cannot inject extra Markdown structure", () => {
    const content = render({ title: "Title\n\n## Injected heading" })
    // No new heading line is created; the title stays a single escaped line.
    expect(content).not.toContain("\n## Injected heading")
    const parsed = parseFrontmatter(content)
    expect(parsed.title).toBe("Title\n\n## Injected heading")
  })

  test("source paths with backticks or line breaks cannot break the Sources list", () => {
    const content = render({ sources: ["src/we`ird.ts"] })
    expect(content).toContain("- `src/we\\`ird.ts`")
    const withNewline = render({ sources: ["src/a.ts\n- injected"] })
    // The line break is collapsed: no new list item line appears.
    expect(withNewline).not.toContain("\n- injected")
  })

  test("round-trips symbol glosses through an inline JSON array", () => {
    const parsed = parseFrontmatter(
      render({
        symbolSummaries: [
          { name: "alpha", summary: "Starts the runtime." },
          { name: " beta ", summary: "  Stops the runtime.  " },
          { name: "alpha", summary: "Duplicate gloss is dropped." },
        ],
      }),
    )
    expect(parsed.symbolSummaries).toEqual([
      { name: "alpha", summary: "Starts the runtime." },
      { name: "beta", summary: "Stops the runtime." },
    ])
  })

  test("missing or malformed gloss frontmatter yields no glosses", () => {
    expect(parseFrontmatter(render()).symbolSummaries).toEqual([])
    const content = render().replace("symbol_summaries: []", 'symbol_summaries: [{"name": 42}]')
    expect(parseFrontmatter(content).symbolSummaries).toEqual([])
    const broken = render().replace("symbol_summaries: []", "symbol_summaries: [oops")
    expect(parseFrontmatter(broken).symbolSummaries).toEqual([])
  })
})
