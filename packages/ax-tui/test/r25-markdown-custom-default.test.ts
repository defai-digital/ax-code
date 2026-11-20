import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression driver for a custom renderNode that calls defaultRender() more
// than once during a single invocation: the earlier default renderable must
// be destroyed, not orphaned with a yoga node and registry entry. Runs in a
// Node child process with FFI enabled because the renderer needs native
// buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test.skipIf(!supportsFfi)("a repeated defaultRender call releases the earlier default renderable", () => {
  runDriver(`
import assert from "node:assert/strict"
import { createTestRenderer, MockTreeSitterClient } from "@defai-digital/ax-tui/testing"
import { BoxRenderable, MarkdownRenderable, Renderable, SyntaxStyle } from "@defai-digital/ax-tui"
const NL = String.fromCharCode(10)
const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 1 })
const setup = await createTestRenderer({ width: 40, height: 12 })
try {
  const markdown = new MarkdownRenderable(setup.renderer, {
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
    content: ["# Hi"].join(NL),
    streaming: false,
    renderNode: (token, { defaultRender }) => {
      defaultRender()
      defaultRender()
      return new BoxRenderable(setup.renderer, { width: 4, height: 1 })
    },
  })
  setup.renderer.root.add(markdown)
  await setup.renderOnce()
  const pending = []
  const collect = (node) => {
    if (node?.highlightingDone?.then) pending.push(node.highlightingDone)
    for (const child of node?.getChildren?.() ?? []) collect(child)
  }
  collect(setup.renderer.root)
  await Promise.all(pending)
  await setup.renderOnce()
  const orphans = [...Renderable.renderablesByNumber.values()].filter(
    (r) => !r.isDestroyed && r.parent === null && r !== setup.renderer.root,
  )
  assert.equal(orphans.length, 0, "repeated defaultRender must not orphan default renderables: " + orphans.map((r) => r.id).join(","))
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("markdown-custom-default-render ok")
`)
})
