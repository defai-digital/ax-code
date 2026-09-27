import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { build } from "esbuild"
import path from "node:path"
import { createHash } from "node:crypto"
import { projectWikiManifest } from "@ax-code/ax-wiki/graph"
import { renderWikiGraphHtml } from "../src/node.js"

const graph = projectWikiManifest(
  {
    schemaVersion: 1,
    generator: "ax-wiki",
    pages: {
      "guide.md": {
        title: '</script><img src="https://attacker.test" onerror="attack()">&\u2028\u2029',
        sources: ["src/a.ts"],
        sourceHashes: {},
      },
    },
  },
  { snapshot: "fixture" },
)

test("exports inert labels with a matching script hash and no network allowances", () => {
  const { html, csp } = renderWikiGraphHtml({ ...graph, root: "/secret/project", credentials: "secret" })
  expect(html).not.toContain("/secret/project")
  expect(html).not.toContain("credentials")
  expect(html.match(/<\/script>/g)).toHaveLength(1)
  expect(html).toContain("\\u003c/script\\u003e")
  const script = html.match(/<script>([\s\S]*)<\/script>/)![1]
  const digest = createHash("sha256").update(script).digest("base64")
  expect(csp).toContain(`script-src 'sha256-${digest}'`)
  expect(csp).toContain("connect-src 'none'")
  expect(csp).not.toContain("script-src 'unsafe-inline'")
  expect(renderWikiGraphHtml(graph).html).toBe(html)
})

test("browser entry bundles without Node, polyfills, or AX Code runtime", async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
    bundle: true,
    platform: "browser",
    write: false,
    metafile: true,
  })
  expect(
    Object.keys(result.metafile!.inputs)
      .map((file) => path.resolve(file))
      .every(
        (file) =>
          /ax-wiki\/src\/graph\.ts$/.test(file) ||
          /ax-wiki-viewer\/src\/(?:index|force-layout)\.ts$/.test(file) ||
          /[/\\]node_modules[/\\]d3-(?:force|dispatch|quadtree|timer)[/\\]/.test(file),
      ),
  ).toBe(true)
  expect(result.outputFiles[0].text).not.toMatch(/\b(?:require\(|process\.|Buffer\b)|node:/)
  expect(result.outputFiles[0].text).not.toMatch(/\beval\(|new Function|fetch\(|XMLHttpRequest|WebSocket/)
})
