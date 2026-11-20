import { describe, expect, test } from "vitest"
import { parseMarkdownIncremental } from "../src/renderables/markdown-parser.js"

const hasLink = (tokens: unknown[]) => JSON.stringify(tokens).includes('"type":"link"')

describe("incremental markdown with reference definitions", () => {
  test("appended references resolve against defs in the stable prefix", () => {
    const base = "[docs]: https://example.com\n\nP1\n\nP2\n\nP3"
    const s1 = parseMarkdownIncremental(base, null, 2)
    const s2 = parseMarkdownIncremental(base + "\n\nSee [docs].", s1, 2)
    const last = s2.tokens[s2.tokens.length - 1]
    expect(hasLink([last])).toBe(true)
    expect(JSON.stringify(last)).toContain("https://example.com")
  })

  test("appended defs re-resolve references in the stable prefix", () => {
    const base = "See [docs].\n\nP2\n\nP3\n\nP4"
    const r1 = parseMarkdownIncremental(base, null, 2)
    const r2 = parseMarkdownIncremental(base + "\n\n[docs]: https://example.com", r1, 2)
    expect(hasLink(r2.tokens)).toBe(true)
    const final = parseMarkdownIncremental(r2.content, r2, 0)
    expect(hasLink(final.tokens)).toBe(true)
  })

  test("def-free incremental parses keep token identity", () => {
    const a1 = parseMarkdownIncremental("# Title\n\nP1\n\nP2\n\nBody text", null, 2)
    const a2 = parseMarkdownIncremental(a1.content + "\n\nMore", a1, 2)
    expect(a2.tokens[0]).toBe(a1.tokens[0])
  })
})
