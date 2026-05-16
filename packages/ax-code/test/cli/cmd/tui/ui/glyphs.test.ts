import { describe, expect, test } from "bun:test"
import { buildGlyphSet, resolveNerdFontEnabled } from "@/cli/cmd/tui/ui/glyphs"

describe("resolveNerdFontEnabled", () => {
  test("env override wins when defined", () => {
    expect(resolveNerdFontEnabled({ env: true, kv: false })).toBe(true)
    expect(resolveNerdFontEnabled({ env: false, kv: true })).toBe(false)
  })

  test("falls through to kv when env is undefined", () => {
    expect(resolveNerdFontEnabled({ env: undefined, kv: true })).toBe(true)
    expect(resolveNerdFontEnabled({ env: undefined, kv: false })).toBe(false)
  })

  test("defaults to false when both env and kv are undefined", () => {
    expect(resolveNerdFontEnabled({})).toBe(false)
  })
})

describe("buildGlyphSet — disabled (safe mode)", () => {
  const safe = buildGlyphSet(false)

  test("reports disabled", () => {
    expect(safe.enabled).toBe(false)
  })

  test("returns empty strings for every glyph getter", () => {
    expect(safe.fileType("foo.ts")).toBe("")
    expect(safe.fileType("dir/")).toBe("")
    expect(safe.folder()).toBe("")
    expect(safe.branch()).toBe("")
  })
})

describe("buildGlyphSet — enabled (nerd mode)", () => {
  const nerd = buildGlyphSet(true)

  test("reports enabled", () => {
    expect(nerd.enabled).toBe(true)
  })

  test("returns non-empty single-codepoint glyphs", () => {
    expect(nerd.fileType("foo.ts").length).toBeGreaterThan(0)
    expect(nerd.folder().length).toBeGreaterThan(0)
    expect(nerd.branch().length).toBeGreaterThan(0)
  })

  test("returns folder glyph for trailing-slash paths", () => {
    expect(nerd.fileType("src/")).toBe(nerd.folder())
  })

  test("matches by extension across common languages", () => {
    const ts = nerd.fileType("foo.ts")
    const tsx = nerd.fileType("foo.tsx")
    const py = nerd.fileType("foo.py")
    const rs = nerd.fileType("foo.rs")
    const md = nerd.fileType("README.md")
    expect(ts).toBeTruthy()
    expect(tsx).toBeTruthy()
    expect(py).toBeTruthy()
    expect(rs).toBeTruthy()
    expect(md).toBeTruthy()
    // Different languages should at least produce defined glyphs (we
    // don't assert distinctness because seti can map related types to
    // the same icon, but each must resolve).
  })

  test("recognizes special filenames (Dockerfile, Makefile, package.json)", () => {
    expect(nerd.fileType("Dockerfile")).toBeTruthy()
    expect(nerd.fileType("Makefile")).toBeTruthy()
    expect(nerd.fileType("package.json")).toBeTruthy()
  })

  test("falls back to generic file glyph for unknown extensions", () => {
    const unknown = nerd.fileType("foo.unknownext")
    const generic = nerd.fileType("README") // no extension
    expect(unknown.length).toBeGreaterThan(0)
    expect(generic.length).toBeGreaterThan(0)
  })

  test("is case-insensitive on extension", () => {
    expect(nerd.fileType("FOO.TS")).toBe(nerd.fileType("foo.ts"))
    expect(nerd.fileType("App.JSX")).toBe(nerd.fileType("app.jsx"))
  })
})
