import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression drivers for block updates: style refresh must keep the raw block
// text, list children must not be reused across token types (structural list
// rendering only happens in top-level mode), and a mode round trip must not
// leave stale margins. The driver runs
// against the built package in a subprocess because the renderer needs Node's
// --experimental-ffi; text blocks draw through CodeRenderable, so each step
// waits for the mock tree-sitter client to settle.
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
const findByContent = (node, text) => {
  if (typeof node?.content === "string" && node.content.trim() === text) return node
  for (const child of node?.getChildren?.() ?? []) {
    const found = findByContent(child, text)
    if (found) return found
  }
  return null
}
`

test.skipIf(!supportsFfi)("markdown style refresh keeps the blank row after a coalesced heading", () => {
  runDriver(`
${PREAMBLE}
const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 1 })
const setup = await createTestRenderer({ width: 60, height: 30 })
try {
  const markdown = new MarkdownRenderable(setup.renderer, {
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
    content: ["# Title", "", "> quoted"].join(NL),
    streaming: false,
  })
  setup.renderer.root.add(markdown)
  await settle(setup)
  const before = setup.captureCharFrame()
  assert.ok(before.includes("Title"), before)
  assert.ok(before.includes("quoted"), before)
  markdown.refreshStyles()
  await settle(setup)
  assert.equal(setup.captureCharFrame(), before)
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("markdown-heading-refresh ok")
`)
})

test.skipIf(!supportsFfi)("markdown list child swap from rule to nested list recreates the child", () => {
  runDriver(`
${PREAMBLE}
const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 1 })
const setup = await createTestRenderer({ width: 60, height: 30 })
try {
  const markdown = new MarkdownRenderable(setup.renderer, {
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
    content: ["- parent", "", "  ---"].join(NL),
    streaming: false,
    internalBlockMode: "top-level",
  })
  setup.renderer.root.add(markdown)
  await settle(setup)
  markdown.content = ["- parent", "", "  - child 1", "  - child 2"].join(NL)
  await settle(setup)
  const frame = setup.captureCharFrame()
  assert.ok(frame.includes("child 1"), frame)
  assert.ok(frame.includes("child 2"), frame)
  const child = findByContent(setup.renderer.root, "child 1")
  assert.ok(child, "child 1 renderable missing")
  let node = child
  while (node) {
    assert.ok(!(node.height === 1 && node.border), "nested list reuses stale rule box: " + node.id)
    node = node.parent
  }
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("markdown-list-rule-to-list ok")
`)
})

test.skipIf(!supportsFfi)("markdown list child swap from text to code drops text chunk linkification", () => {
  runDriver(`
${PREAMBLE}
const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 1 })
const setup = await createTestRenderer({ width: 60, height: 30 })
try {
  const markdown = new MarkdownRenderable(setup.renderer, {
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
    content: "- plain text",
    streaming: false,
    internalBlockMode: "top-level",
  })
  setup.renderer.root.add(markdown)
  await settle(setup)
  markdown.content = ["- \`\`\`js", "  x", "  \`\`\`"].join(NL)
  await settle(setup)
  const code = findByContent(setup.renderer.root, "x")
  assert.ok(code, "code renderable missing")
  assert.equal(code.onChunks, undefined)
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("markdown-list-text-to-code ok")
`)
})

test.skipIf(!supportsFfi)("markdown list child swap from code to text restores chunk linkification", () => {
  runDriver(`
${PREAMBLE}
const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 1 })
const setup = await createTestRenderer({ width: 60, height: 30 })
try {
  const markdown = new MarkdownRenderable(setup.renderer, {
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
    content: ["- \`\`\`js", "  x", "  \`\`\`"].join(NL),
    streaming: false,
    internalBlockMode: "top-level",
  })
  setup.renderer.root.add(markdown)
  await settle(setup)
  markdown.content = "- plain text"
  await settle(setup)
  const text = findByContent(setup.renderer.root, "plain text")
  assert.ok(text, "text renderable missing")
  assert.equal(typeof text.onChunks, "function")
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("markdown-list-code-to-text ok")
`)
})

test.skipIf(!supportsFfi)("markdown mode round trip restores coalesced spacing", () => {
  runDriver(`
${PREAMBLE}
const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 1 })
const setup = await createTestRenderer({ width: 60, height: 30 })
try {
  const markdown = new MarkdownRenderable(setup.renderer, {
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
    content: ["- item", "", "\`\`\`js", "1", "\`\`\`"].join(NL),
    streaming: false,
  })
  setup.renderer.root.add(markdown)
  await settle(setup)
  const before = setup.captureCharFrame()
  assert.ok(before.includes("item"), before)
  markdown.internalBlockMode = "top-level"
  await settle(setup)
  markdown.internalBlockMode = "coalesced"
  await settle(setup)
  assert.equal(setup.captureCharFrame(), before)
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("markdown-mode-roundtrip ok")
`)
})