import { describe, expect, test } from "vitest"
import {
  defaultOpenWikiBlockBody,
  hasOpenWikiBlock,
  upsertOpenWikiBlock,
  OPENWIKI_START,
  OPENWIKI_END,
} from "../../src/wiki"

describe("wiki/agents-block", () => {
  test("default block includes markers and routing guidance", () => {
    const body = defaultOpenWikiBlockBody("openwiki")
    expect(body).toContain(OPENWIKI_START)
    expect(body).toContain(OPENWIKI_END)
    expect(body).toContain("openwiki/")
    expect(body).toContain("code_intelligence")
    expect(hasOpenWikiBlock(body)).toBe(true)
  })

  test("inserts block into empty content", () => {
    const next = upsertOpenWikiBlock("")
    expect(hasOpenWikiBlock(next)).toBe(true)
    expect(next.endsWith("\n")).toBe(true)
  })

  test("appends block without clobbering existing content", () => {
    const existing = "# My Project\n\n## Rules\n\n- Use pnpm\n"
    const next = upsertOpenWikiBlock(existing)
    expect(next).toContain("# My Project")
    expect(next).toContain("Use pnpm")
    expect(hasOpenWikiBlock(next)).toBe(true)
  })

  test("replaces existing marker block idempotently for same body", () => {
    const block = defaultOpenWikiBlockBody("openwiki")
    const first = upsertOpenWikiBlock("# Title\n", block)
    const second = upsertOpenWikiBlock(first, block)
    expect(second).toBe(first)
  })

  test("replaces only the marker span when block body changes", () => {
    const v1 = upsertOpenWikiBlock("# Keep me\n", defaultOpenWikiBlockBody("openwiki"))
    const v2 = upsertOpenWikiBlock(v1, defaultOpenWikiBlockBody("docs/wiki"))
    expect(v2).toContain("# Keep me")
    expect(v2).toContain("docs/wiki/")
    expect(v2).not.toMatch(/openwiki\/quickstart/)
    // single pair of markers
    expect(v2.split(OPENWIKI_START).length - 1).toBe(1)
    expect(v2.split(OPENWIKI_END).length - 1).toBe(1)
  })
})
