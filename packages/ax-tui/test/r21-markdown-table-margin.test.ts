import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression driver for in-place block replacement: when a table loses its
// last body row the table renderable is replaced through the fallback path,
// and the replacement must keep the block's top margin. The driver runs
// against the built package in a subprocess because the renderer needs Node's
// --experimental-ffi; each step waits for the mock tree-sitter client to settle.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

const PREAMBLE = `
import assert from "node:assert/strict"
import { createTestRenderer, MockTreeSitterClient } from "@defai-digital/ax-tui/testing"
import { MarkdownRenderable, SyntaxStyle } from "@defai-digital/ax-tui"

const NL = String.fromCharCode(10)
const collectHighlighting = (node, pending) => {
  if (node?.highlightingDone?.then) pending.push(node.highlightingDone)
  for (const child of node?.getChildren?.() ?? []) collectHighlighting(child, pending)
}
const settle = async (setup) => {
  await setup.renderOnce()
  const pending = []
  collectHighlighting(setup.renderer.root, pending)
  await Promise.all(pending)
  await setup.renderOnce()
}
`

test.skipIf(!supportsFfi)("markdown table fallback replacement keeps the block top margin", () => {
  runDriver(`
${PREAMBLE}
const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 1 })
const setup = await createTestRenderer({ width: 60, height: 30 })
try {
  const markdown = new MarkdownRenderable(setup.renderer, {
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
    content: ["# Heading", "", "| A |", "| - |", "| 1 |"].join(NL),
    streaming: false,
    internalBlockMode: "top-level",
  })
  setup.renderer.root.add(markdown)
  await settle(setup)
  assert.equal(markdown["_blockStates"][1].renderable.marginTop, 1)
  markdown.content = ["# Heading", "", "| A |", "| - |"].join(NL)
  await settle(setup)
  assert.equal(markdown["_blockStates"][1].renderable.marginTop, 1)
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("markdown-table-margin ok")
`)
})
