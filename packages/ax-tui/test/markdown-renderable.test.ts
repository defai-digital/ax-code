import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Characterization coverage for MarkdownRenderable, which previously had none.
// The driver runs against the built package in a subprocess because the
// renderer needs Node's --experimental-ffi. Markdown text blocks draw through
// CodeRenderable, which only paints once its tree-sitter client answers, so
// the driver pairs a MockTreeSitterClient with a settle wait after each step.
// The mock resolves with empty highlights, so conceal has nothing to hide and
// markup markers stay visible — that is the behavior these tests pin.
function runDriver(source: string): string {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  return result.stdout
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
// Code blocks stay blank until tree-sitter resolves. A fixed delay loses that
// race on a busy Windows runner, so wait for the promises the render started.
const settle = async (setup) => {
  await setup.renderOnce()
  const pending = []
  collectHighlighting(setup.renderer.root, pending)
  await Promise.all(pending)
  await setup.renderOnce()
}
`

test.skipIf(!supportsFfi)("markdown renders blocks, rerenders on style refresh, and streams appends", () => {
  runDriver(`
${PREAMBLE}
const document = [
  "# Title",
  "",
  "Some **bold** and \`code\` text.",
  "",
  "- one",
  "- two",
  "",
  "> quoted",
  "",
  "| A | B |",
  "|---|---|",
  "| 1 | 2 |",
  "",
].join(NL)

const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 1 })
const setup = await createTestRenderer({ width: 60, height: 30 })
try {
  const markdown = new MarkdownRenderable(setup.renderer, {
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
    content: document,
    streaming: false,
  })
  setup.renderer.root.add(markdown)
  await setup.renderOnce()
  await settle(setup)

  let frame = setup.captureCharFrame()
  assert.ok(frame.includes("Title"), frame)
  assert.ok(frame.includes("Some **bold** and \`code\` text."), frame)
  assert.ok(frame.includes("one"), frame)
  assert.ok(frame.includes("two"), frame)
  assert.ok(frame.includes("quoted"), frame)
  assert.ok(frame.includes("A"), frame)
  assert.ok(frame.includes("B"), frame)

  // Style-refresh path: conceal flips re-render existing blocks in place.
  // With empty mock highlights nothing is concealed, so the frame is stable.
  const before = setup.captureCharFrame()
  markdown.conceal = false
  await settle(setup)
  assert.equal(setup.captureCharFrame(), before)

  // refreshStyles re-renders without changing content; frame must be stable.
  markdown.refreshStyles()
  await settle(setup)
  assert.equal(setup.captureCharFrame(), before)

  // Streaming append keeps earlier blocks and shows the new trailing text.
  markdown.streaming = true
  markdown.content = document + NL + "Appended trailing paragraph"
  await settle(setup)
  frame = setup.captureCharFrame()
  assert.ok(frame.includes("Appended trailing paragraph"), frame)
  assert.ok(frame.includes("Some **bold** and \`code\` text."), frame)

  markdown.streaming = false
  await settle(setup)
  assert.ok(setup.captureCharFrame().includes("Appended trailing paragraph"))
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("markdown-renderable ok")
`)
})

test.skipIf(!supportsFfi)("markdown top-level block mode renders the same document", () => {
  runDriver(`
${PREAMBLE}
const document = [
  "# Title",
  "",
  "Paragraph text here.",
  "",
  "| A | B |",
  "|---|---|",
  "| 1 | 2 |",
  "",
].join(NL)

const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 1 })
const setup = await createTestRenderer({ width: 60, height: 30 })
try {
  const markdown = new MarkdownRenderable(setup.renderer, {
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
    content: document,
    streaming: false,
    internalBlockMode: "top-level",
  })
  setup.renderer.root.add(markdown)
  await setup.renderOnce()
  await settle(setup)

  let frame = setup.captureCharFrame()
  assert.ok(frame.includes("Title"), frame)
  assert.ok(frame.includes("Paragraph text here."), frame)
  assert.ok(frame.includes("A"), frame)
  assert.ok(frame.includes("B"), frame)

  markdown.refreshStyles()
  await settle(setup)
  frame = setup.captureCharFrame()
  assert.ok(frame.includes("Paragraph text here."), frame)
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("markdown-top-level ok")
`)
})

test.skipIf(!supportsFfi)("markdown refreshStyles preserves custom renderNode blocks", () => {
  runDriver(`
${PREAMBLE}
import { TextRenderable } from "@defai-digital/ax-tui"

const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 1 })
const setup = await createTestRenderer({ width: 40, height: 12 })
try {
  let calls = 0
  let latest
  const markdown = new MarkdownRenderable(setup.renderer, {
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
    content: "Fallback paragraph",
    streaming: false,
    renderNode(token) {
      if (token.type !== "paragraph") return undefined
      calls += 1
      latest = new TextRenderable(setup.renderer, { content: "CUSTOM" })
      return latest
    },
  })
  setup.renderer.root.add(markdown)
  await setup.renderOnce()
  await settle(setup)
  assert.ok(setup.captureCharFrame().includes("CUSTOM"))

  markdown.refreshStyles()
  await settle(setup)
  assert.ok(setup.captureCharFrame().includes("CUSTOM"), "custom renderable was replaced by a default block")
  assert.equal(calls, 2)
  assert.equal(latest.isDestroyed, false)
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("markdown-render-node-refresh ok")
`)
})

test.skipIf(!supportsFfi)("markdown preserves link href through nested inline styles", () => {
  runDriver(`
${PREAMBLE}
const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 1 })
const setup = await createTestRenderer({ width: 60, height: 10 })
try {
  const markdown = new MarkdownRenderable(setup.renderer, {
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
    content: "A [**bold**](https://example.com) B **[*em link*](https://example.com)**",
    streaming: false,
  })
  setup.renderer.root.add(markdown)
  await setup.renderOnce()

  const paragraph = markdown._parseState.tokens.find(token => token.type === "paragraph")
  assert.ok(paragraph && paragraph.tokens)
  const chunks = []
  markdown.renderInlineContent(paragraph.tokens, chunks)
  const bold = chunks.find(chunk => chunk.text === "bold")
  const em = chunks.find(chunk => chunk.text === "em link")
  assert.ok(bold, "bold link label chunk is missing")
  assert.equal(bold.link?.url, "https://example.com")
  assert.ok(em, "nested link label chunk is missing")
  assert.equal(em.link?.url, "https://example.com")
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("markdown-nested-link ok")
`)
})

test.skipIf(!supportsFfi)("markdown table options reach tables nested in list items", () => {
  runDriver(`
${PREAMBLE}
import { TextTableRenderable } from "@defai-digital/ax-tui"

const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 1 })
const setup = await createTestRenderer({ width: 50, height: 20 })
try {
  const markdown = new MarkdownRenderable(setup.renderer, {
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
    content: ["- item", "", "  | A | B |", "  |---|---|", "  | 1 | 2 |"].join(NL),
    streaming: false,
    internalBlockMode: "top-level",
    tableOptions: { borders: true },
  })
  setup.renderer.root.add(markdown)
  await setup.renderOnce()
  await settle(setup)

  const findTable = node => {
    if (node instanceof TextTableRenderable) return node
    for (const child of node?.getChildren?.() ?? []) {
      const found = findTable(child)
      if (found) return found
    }
    return undefined
  }
  const table = findTable(markdown)
  assert.ok(table, "nested table was not created")
  assert.equal(table.border, true)

  markdown.tableOptions = { borders: false }
  assert.equal(table.border, false, "nested table did not receive tableOptions")
  assert.equal(table.showBorders, false)
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("markdown-nested-table-options ok")
`)
})
