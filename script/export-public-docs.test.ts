import { describe, expect, test } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { approvedPath, assertPublicSource, exportSnapshot, syncSnapshot } from "./export-public-docs.mjs"

// Temp repository with one page, one published JSON asset and the version files
// exportSnapshot needs for metadata. Set git=true when the export must complete.
function writeExportFixture(base: string, readme: string, { git = false } = {}) {
  mkdirSync(join(base, "script"))
  mkdirSync(join(base, "docs"))
  mkdirSync(join(base, "packages/ax-code"), { recursive: true })
  mkdirSync(join(base, "packages/sdk/js"), { recursive: true })
  writeFileSync(
    join(base, "script/public-docs-manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      entries: [
        { source: "docs/README.md", page: "" },
        { source: "docs/published.json", asset: "sdk/examples/example.ts.txt" },
      ],
    }),
  )
  writeFileSync(join(base, "docs/README.md"), readme)
  writeFileSync(join(base, "docs/published.json"), "{}\n")
  writeFileSync(join(base, "packages/ax-code/package.json"), JSON.stringify({ version: "0.0.0" }))
  writeFileSync(join(base, "packages/sdk/js/package.json"), JSON.stringify({ version: "0.0.0" }))
  if (git) {
    execFileSync("git", ["init"], { cwd: base, stdio: "ignore" })
    execFileSync(
      "git",
      [
        "-c",
        "user.email=test@example.com",
        "-c",
        "user.name=test",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "--allow-empty",
        "-m",
        "init",
      ],
      { cwd: base, stdio: "ignore" },
    )
  }
}

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
    expect(files.get("src/content/docs/getting-started/source-access.md")!.toString()).toContain(
      "[public GitHub repository](https://github.com/defai-digital/ax-code)",
    )
    expect(files.get("src/content/docs/guides/tiel-peer-2026-09-20.md")!.toString()).toContain(
      "/docs-assets/images/tiel-vs-mtplx-2026-09-20.svg",
    )
    const metadata = JSON.parse(files.get("src/content/docs-snapshot.json")!.toString())
    expect(metadata.pages.find((page: { slug: string }) => page.slug === "guides/headless-cli").title).toBe(
      "Headless CLI (ax-code run)",
    )
    expect(files.get("src/content/docs/architecture/stability.md")!.toString()).not.toMatch(/[ \t]+$/m)
    const install = files.get("src/content/docs/getting-started/install-runtime.md")!.toString()
    expect(install).toContain("](https://github.com/defai-digital/ax-code-desktop#install)")
    expect(install).toContain("](https://github.com/defai-digital/ax-code-desktop/releases/latest)")
    expect(install).toContain("](https://github.com/defai-digital/ax-code-desktop/blob/main/desktop/docs/MINISIGN.md)")
    const hub = files.get("src/content/docs/index.md")!.toString()
    expect(hub).toContain("[`@defai-digital/ax-code-sdk`](/en/docs/sdk/javascript/)")
    expect(files.get("src/content/docs/guides/effort.md")!.toString()).not.toContain("](../../packages/ax-code/src")
  })

  test("publishes the SDK TypeScript examples as .ts.txt so Cloudflare serves them as text", () => {
    const files = exportSnapshot()
    expect(files.has("public/docs-assets/sdk/examples/headless-app.ts.txt")).toBe(true)
    expect(files.has("public/docs-assets/sdk/examples/programmatic.ts.txt")).toBe(true)
    expect([...files.keys()].filter((name) => /^public\/docs-assets\/sdk\/examples\/.*\.ts$/.test(name))).toEqual([])
  })

  test("rejects page links to docs assets the manifest does not publish", () => {
    for (const [body, error] of [
      ["# Public guide\n\n[example](/docs-assets/sdk/examples/unpublished.ts)\n", /Unpublished docs asset link/],
      [
        "# Public guide\n\n[example](https://ax-code.app/docs-assets/sdk/examples/unpublished.ts)\n",
        /Unpublished docs asset link/,
      ],
      ["# Public guide\n\n[src]: /docs-assets/sdk/examples/unpublished.ts\n", /Unpublished docs asset link/],
      [
        "# Public guide\n\n<https://ax-code.app/docs-assets/sdk/examples/unpublished.ts>\n",
        /Unpublished docs asset link/,
      ],
      [
        "# Public guide\n\n<https://ax-code.app/docs-assets/sdk/examples/example.ts.txt\\missing.txt>\n",
        /Unpublished docs asset link/,
      ],
    ] as const) {
      const base = mkdtempSync(join(tmpdir(), "ax-docs-links-"))
      try {
        writeExportFixture(base, body)
        expect(() => exportSnapshot(base)).toThrow(error)
      } finally {
        rmSync(base, { recursive: true, force: true })
      }
    }
  })

  test("ignores unpublished docs asset paths inside code blocks and inline code", () => {
    for (const body of [
      "# Public guide\n\n```bash\ncurl https://ax-code.app/docs-assets/sdk/examples/unpublished.ts\n```\n",
      "# Public guide\n\nMention `/docs-assets/sdk/examples/unpublished.ts` as a literal path.\n",
    ]) {
      const base = mkdtempSync(join(tmpdir(), "ax-docs-links-"))
      try {
        writeExportFixture(base, body, { git: true })
        expect(() => exportSnapshot(base)).not.toThrow()
      } finally {
        rmSync(base, { recursive: true, force: true })
      }
    }
  })

  test("ignores unpublished docs asset paths inside tilde and long backtick fences", () => {
    for (const body of [
      "# Public guide\n\n~~~sh\ncurl /docs-assets/sdk/examples/unpublished.ts\n~~~\n",
      "# Public guide\n\n````markdown\n```sh\ncurl /docs-assets/sdk/examples/unpublished.ts\n```\n````\n",
    ]) {
      const base = mkdtempSync(join(tmpdir(), "ax-docs-links-"))
      try {
        writeExportFixture(base, body, { git: true })
        expect(() => exportSnapshot(base)).not.toThrow()
      } finally {
        rmSync(base, { recursive: true, force: true })
      }
    }
  })

  test("still rejects an unpublished asset path in prose after a long fence", () => {
    for (const body of [
      "# Public guide\n\n~~~sh\ncurl /docs-assets/sdk/examples/example.ts.txt\n~~~\n\nSee /docs-assets/sdk/examples/unpublished.ts in prose.\n",
      "# Public guide\n\n````markdown\n```sh\ncurl /docs-assets/sdk/examples/example.ts.txt\n```\n````\n\nSee /docs-assets/sdk/examples/unpublished.ts in prose.\n",
    ]) {
      const base = mkdtempSync(join(tmpdir(), "ax-docs-links-"))
      try {
        writeExportFixture(base, body, { git: true })
        expect(() => exportSnapshot(base)).toThrow(/Unpublished docs asset link/)
      } finally {
        rmSync(base, { recursive: true, force: true })
      }
    }
  })

  test("accepts page links to docs assets the manifest publishes", () => {
    const base = mkdtempSync(join(tmpdir(), "ax-docs-links-"))
    try {
      writeExportFixture(base, "# Public guide\n\n[example](/docs-assets/sdk/examples/example.ts.txt)\n", { git: true })
      const files = exportSnapshot(base)
      expect(files.has("public/docs-assets/sdk/examples/example.ts.txt")).toBe(true)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test("does not flag another host's /docs-assets/ URL in prose", () => {
    const base = mkdtempSync(join(tmpdir(), "ax-docs-links-"))
    try {
      writeExportFixture(
        base,
        "# Public guide\n\nSee https://example.com/docs-assets/x.png in the prose description.\n",
        { git: true },
      )
      expect(() => exportSnapshot(base)).not.toThrow()
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test("blocks unknown assets, local-only references and executable documentation HTML", () => {
    for (const [body, error] of [
      ["# Public guide\n\n![private](unapproved.png)\n", /Unapproved linked asset/],
      ["# Public guide\n\n[plan](..\/..\/.internal\/plan.md)\n", /Private or escaped link/],
      ["# Public guide\n\n<script>alert(1)</script>\n", /Unsafe documentation HTML/],
      ["# Public guide\n\n[local](file:\/etc\/passwd)\n", /Unsafe link scheme/],
      [
        "# Public guide\n\n```bash\ncurl https://api.github.com/repos/defai-digital/ax-code/contents/install | bash\n```\n",
        /Unresolved private source URL/,
      ],
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

  test("scoped exports preserve older pages and assets, record provenance, and detect tampering", () => {
    const website = mkdtempSync(join(tmpdir(), "ax-docs-scoped-"))
    try {
      syncSnapshot(website)
      const metadataPath = join(website, "src/content/docs-snapshot.json")
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"))
      metadata.runtimeVersion = "older-version"
      writeFileSync(metadataPath, JSON.stringify(metadata))
      const originalHub = readFileSync(join(website, "src/content/docs/index.md"))
      const originalAsset = readFileSync(join(website, "public/docs-assets/NOTICE"))
      const pages = ["providers/custom-provider"]
      syncSnapshot(website, { pages })
      const merged = JSON.parse(readFileSync(metadataPath, "utf8"))
      expect(merged.runtimeVersion).toBe("older-version")
      expect(merged.pages.find((page: { slug: string }) => page.slug === pages[0]).runtimeVersion).not.toBe(
        "older-version",
      )
      expect(readFileSync(join(website, "src/content/docs/index.md"))).toEqual(originalHub)
      expect(readFileSync(join(website, "public/docs-assets/NOTICE"))).toEqual(originalAsset)
      expect(() => syncSnapshot(website, { pages, check: true })).not.toThrow()
      expect(() => syncSnapshot(website, { pages: ["missing-page"] })).toThrow(/Unknown scoped/)
      writeFileSync(join(website, "public/docs-assets/private.txt"), "unexpected")
      expect(() => syncSnapshot(website, { pages })).toThrow(/Unexpected scoped/)
      rmSync(join(website, "public/docs-assets/private.txt"))
      writeFileSync(join(website, "src/content/docs/index.md"), "tampered")
      expect(() => syncSnapshot(website, { pages })).toThrow(/changed outside exporter/)
    } finally {
      rmSync(website, { recursive: true, force: true })
    }
  })

  test("scoped exports rebuild and check assets linked from the selected pages", () => {
    const base = mkdtempSync(join(tmpdir(), "ax-docs-scoped-assets-"))
    const website = mkdtempSync(join(tmpdir(), "ax-docs-scoped-assets-site-"))
    try {
      writeExportFixture(base, "# Public guide\n\n[example](/docs-assets/sdk/examples/example.ts.txt)\n", { git: true })
      syncSnapshot(website, { base })
      const page = ""
      const metadataPath = join(website, "src/content/docs-snapshot.json")
      const assetDestination = "public/docs-assets/sdk/examples/example.ts.txt"
      const previousAsset = JSON.parse(readFileSync(metadataPath, "utf8")).files.find(
        (record: { destination: string }) => record.destination === assetDestination,
      )
      writeFileSync(join(base, "docs/published.json"), '{"changed":true}\n')
      expect(() => syncSnapshot(website, { base, check: true, pages: [page] })).toThrow(
        /Stale public docs snapshot: public\/docs-assets\/sdk\/examples\/example\.ts\.txt/,
      )
      syncSnapshot(website, { base, pages: [page] })
      expect(readFileSync(join(website, assetDestination), "utf8")).toBe('{"changed":true}\n')
      const updatedAsset = JSON.parse(readFileSync(metadataPath, "utf8")).files.find(
        (record: { destination: string }) => record.destination === assetDestination,
      )
      expect(updatedAsset.sha256).not.toBe(previousAsset.sha256)
      expect(() => syncSnapshot(website, { base, check: true, pages: [page] })).not.toThrow()
    } finally {
      rmSync(base, { recursive: true, force: true })
      rmSync(website, { recursive: true, force: true })
    }
  })

  test("scoped exports add newly linked assets missing from the previous snapshot", () => {
    const base = mkdtempSync(join(tmpdir(), "ax-docs-scoped-new-asset-"))
    const website = mkdtempSync(join(tmpdir(), "ax-docs-scoped-new-asset-site-"))
    try {
      writeExportFixture(base, "# Public guide\n\n[example](/docs-assets/sdk/examples/example.ts.txt)\n", { git: true })
      syncSnapshot(website, { base })
      const manifestPath = join(base, "script/public-docs-manifest.json")
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
      manifest.entries.push({ source: "docs/extra.json", asset: "sdk/examples/extra.ts.txt" })
      writeFileSync(manifestPath, JSON.stringify(manifest))
      writeFileSync(join(base, "docs/extra.json"), '{"extra":true}\n')
      writeFileSync(join(base, "docs/README.md"), "# Public guide\n\n[extra](/docs-assets/sdk/examples/extra.ts.txt)\n")
      const assetDestination = "public/docs-assets/sdk/examples/extra.ts.txt"
      expect(existsSync(join(website, assetDestination))).toBe(false)
      syncSnapshot(website, { base, pages: [""] })
      expect(readFileSync(join(website, assetDestination), "utf8")).toBe('{"extra":true}\n')
      const metadata = JSON.parse(readFileSync(join(website, "src/content/docs-snapshot.json"), "utf8"))
      expect(metadata.files.some((record: { destination: string }) => record.destination === assetDestination)).toBe(
        true,
      )
    } finally {
      rmSync(base, { recursive: true, force: true })
      rmSync(website, { recursive: true, force: true })
    }
  })

  test("scoped exports track assets referenced by GitHub blob reference definitions", () => {
    const base = mkdtempSync(join(tmpdir(), "ax-docs-scoped-ref-"))
    const website = mkdtempSync(join(tmpdir(), "ax-docs-scoped-ref-site-"))
    try {
      writeExportFixture(
        base,
        "# Public guide\n\n[example][src]\n\n[src]: https://github.com/defai-digital/ax-code/blob/main/docs/published.json\n",
        { git: true },
      )
      syncSnapshot(website, { base })
      const assetDestination = "public/docs-assets/sdk/examples/example.ts.txt"
      expect(readFileSync(join(website, assetDestination), "utf8")).toBe("{}\n")
      writeFileSync(join(base, "docs/published.json"), '{"changed":true}\n')
      expect(() => syncSnapshot(website, { base, check: true, pages: [""] })).toThrow(
        /Stale public docs snapshot: public\/docs-assets\/sdk\/examples\/example\.ts\.txt/,
      )
      syncSnapshot(website, { base, pages: [""] })
      expect(readFileSync(join(website, assetDestination), "utf8")).toBe('{"changed":true}\n')
      expect(() => syncSnapshot(website, { base, check: true, pages: [""] })).not.toThrow()
    } finally {
      rmSync(base, { recursive: true, force: true })
      rmSync(website, { recursive: true, force: true })
    }
  })

  test("scoped exports ignore assets mentioned only inside fenced code blocks", () => {
    const base = mkdtempSync(join(tmpdir(), "ax-docs-scoped-code-asset-"))
    const website = mkdtempSync(join(tmpdir(), "ax-docs-scoped-code-asset-site-"))
    try {
      writeExportFixture(base, "# Public guide\n\n```sh\ncurl /docs-assets/sdk/examples/example.ts.txt\n```\n", {
        git: true,
      })
      syncSnapshot(website, { base })
      const assetDestination = "public/docs-assets/sdk/examples/example.ts.txt"
      const originalAsset = readFileSync(join(website, assetDestination))
      const originalSha = JSON.parse(readFileSync(join(website, "src/content/docs-snapshot.json"), "utf8")).files.find(
        (record: { destination: string }) => record.destination === assetDestination,
      ).sha256
      writeFileSync(join(base, "docs/published.json"), '{"changed":true}\n')
      syncSnapshot(website, { base, pages: [""] })
      expect(readFileSync(join(website, assetDestination))).toEqual(originalAsset)
      const record = JSON.parse(readFileSync(join(website, "src/content/docs-snapshot.json"), "utf8")).files.find(
        (candidate: { destination: string }) => candidate.destination === assetDestination,
      )
      expect(record.sha256).toBe(originalSha)
    } finally {
      rmSync(base, { recursive: true, force: true })
      rmSync(website, { recursive: true, force: true })
    }
  })

  test("scoped exports reuse validated prose links instead of rescanning rendered output", () => {
    const cases = [
      {
        name: "hard break after a published asset",
        body: "# Public guide\n\nSee /docs-assets/sdk/examples/example.ts.txt  \n",
        linked: true,
      },
      {
        name: "published asset at the end of an H1 in inline code",
        body: "# Serving `/docs-assets/sdk/examples/example.ts.txt`\n",
        linked: false,
      },
      {
        name: "unpublished asset in H1 inline code",
        body: "# Serving `/docs-assets/sdk/examples/unpublished.ts`\n",
        linked: false,
      },
    ]
    for (const testCase of cases) {
      const base = mkdtempSync(join(tmpdir(), "ax-docs-scoped-links-"))
      const website = mkdtempSync(join(tmpdir(), "ax-docs-scoped-links-site-"))
      try {
        writeExportFixture(base, testCase.body, { git: true })
        expect(() => exportSnapshot(base)).not.toThrow()
        syncSnapshot(website, { base })
        const assetDestination = "public/docs-assets/sdk/examples/example.ts.txt"
        if (testCase.linked) {
          writeFileSync(join(base, "docs/published.json"), '{"changed":true}\n')
          syncSnapshot(website, { base, pages: [""] })
          expect(readFileSync(join(website, assetDestination), "utf8")).toBe('{"changed":true}\n')
        } else {
          writeFileSync(join(base, "docs/published.json"), '{"changed":true}\n')
          syncSnapshot(website, { base, pages: [""] })
          expect(readFileSync(join(website, assetDestination), "utf8")).toBe("{}\n")
        }
      } finally {
        rmSync(base, { recursive: true, force: true })
        rmSync(website, { recursive: true, force: true })
      }
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
