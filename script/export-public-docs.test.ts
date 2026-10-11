import { describe, expect, test } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { approvedPath, assertPublicSource, exportSnapshot, syncSnapshot } from "./export-public-docs.mjs"

describe("public documentation export", () => {
  test("refuses credentials and private source even when a manifest lists them", () => {
    for (const name of [
      ".env",
      "docs/secrets.key",
      "docs/.env.json",
      "packages/ax-code/src/index-node.ts",
      "script/deploy.mjs",
    ])
      expect(() => assertPublicSource(name)).toThrow()
    expect(() => assertPublicSource("packages/sdk/js/example/headless-app.ts")).not.toThrow()
  })

  test("exports approved operator content and public contracts without implementation files", () => {
    const files = exportSnapshot()
    expect(files.has("src/content/docs/getting-started/upgrade.md")).toBe(true)
    expect(files.has("public/docs-assets/sdk/openapi.json")).toBe(true)
    expect(files.has("public/docs-assets/schema/config.schema.json")).toBe(true)
    expect(files.has("public/docs-assets/NOTICE")).toBe(true)
    expect([...files.keys()].some((name) => name.includes("packages/ax-code/src") || name.includes(".internal"))).toBe(
      false,
    )
    for (const [name, data] of files) {
      if (name.endsWith(".md"))
        expect(data.toString()).not.toMatch(
          /https:\/\/(?:github\.com|raw\.githubusercontent\.com)\/defai-digital\/ax-code(?:[\/#]|$)/,
        )
    }
    const metadata = JSON.parse(files.get("src/content/docs-snapshot.json")!.toString())
    expect(metadata.pages.find((page: { slug: string }) => page.slug === "guides/headless-cli").title).toBe(
      "Headless CLI (ax-code run)",
    )
    expect(files.get("src/content/docs/architecture/stability.md")!.toString()).not.toMatch(/[ \t]+$/m)
    const hub = files.get("src/content/docs/index.md")!.toString()
    expect(hub).toContain("[`@defai-digital/ax-code-sdk`](/en/docs/sdk/javascript/)")
    expect(files.get("src/content/docs/guides/effort.md")!.toString()).not.toContain("](../../packages/ax-code/src")
  })

  test("blocks unknown assets, local-only references and executable documentation HTML", () => {
    for (const [body, error] of [
      ["# Public guide\n\n![private](unapproved.png)\n", /Unapproved linked asset/],
      ["# Public guide\n\n[plan](..\/..\/.internal\/plan.md)\n", /Private or escaped link/],
      ["# Public guide\n\n<script>alert(1)</script>\n", /Unsafe documentation HTML/],
      ["# Public guide\n\n[local](file:\/etc\/passwd)\n", /Unsafe link scheme/],
    ] as const) {
      const base = mkdtempSync(join(tmpdir(), "ax-docs-content-"))
      try {
        mkdirSync(join(base, "script"))
        mkdirSync(join(base, "docs"))
        writeFileSync(
          join(base, "script/public-docs-manifest.json"),
          JSON.stringify({ schemaVersion: 1, entries: [{ source: "docs/README.md", page: "" }] }),
        )
        writeFileSync(join(base, "docs/README.md"), body)
        expect(() => exportSnapshot(base)).toThrow(error)
      } finally {
        rmSync(base, { recursive: true, force: true })
      }
    }
  })

  test("rejects traversal and nested symlinks before reading approved content", () => {
    const base = mkdtempSync(join(tmpdir(), "ax-docs-path-"))
    try {
      for (const name of [
        "../secret",
        "/etc/passwd",
        ".internal/plan.md",
        "docs/../secret",
        "docs\\secret",
        "docs//file",
      ]) {
        expect(() => approvedPath(base, name)).toThrow()
      }
      mkdirSync(join(base, "docs"))
      symlinkSync(tmpdir(), join(base, "docs", "linked"))
      expect(() => approvedPath(base, "docs/linked/secret")).toThrow(/Symlink/)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test("produces deterministic snapshots and detects edits, missing and extra public files", () => {
    const website = mkdtempSync(join(tmpdir(), "ax-docs-site-"))
    try {
      syncSnapshot(website)
      const first = readFileSync(join(website, "src/content/docs-snapshot.json"))
      expect(() => syncSnapshot(website, { check: true })).not.toThrow()
      syncSnapshot(website)
      expect(readFileSync(join(website, "src/content/docs-snapshot.json"))).toEqual(first)
      writeFileSync(join(website, "public/docs-assets/private.txt"), "unexpected")
      expect(() => syncSnapshot(website, { check: true })).toThrow(/private.txt/)
      syncSnapshot(website)
      writeFileSync(join(website, "src/content/docs/index.md"), "changed")
      expect(() => syncSnapshot(website, { check: true })).toThrow(/index.md/)
      syncSnapshot(website)
      rmSync(join(website, "public/docs-assets/NOTICE"))
      expect(() => syncSnapshot(website, { check: true })).toThrow(/NOTICE/)
    } finally {
      rmSync(website, { recursive: true, force: true })
    }
  })

  test("refuses symlinked output trees before deleting or writing", () => {
    const website = mkdtempSync(join(tmpdir(), "ax-docs-output-"))
    try {
      mkdirSync(join(website, "public"))
      symlinkSync(tmpdir(), join(website, "public/docs-assets"))
      expect(() => syncSnapshot(website)).toThrow(/Symlink/)
    } finally {
      rmSync(website, { recursive: true, force: true })
    }
  })
})
