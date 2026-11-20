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

test.skipIf(!supportsFfi)("markdown top-level blocks skip unrenderable tokens without leaving state holes", () => {
  runDriver(`
${PREAMBLE}
const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 1 })
const setup = await createTestRenderer({ width: 40, height: 12 })
try {
  const document = ["alpha", "", "SKIPME", "", "omega"].join(NL)
  const markdown = new MarkdownRenderable(setup.renderer, {
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
    content: "",
    streaming: false,
    internalBlockMode: "top-level",
  })
  const original = markdown.getTopLevelBlockRaw.bind(markdown)
  markdown.getTopLevelBlockRaw = token => (token.raw.includes("SKIPME") ? undefined : original(token))
  markdown.content = document
  setup.renderer.root.add(markdown)
  await settle(setup)

  let frame = setup.captureCharFrame()
  assert.ok(frame.includes("alpha"), frame)
  assert.ok(frame.includes("omega"), frame)
  assert.ok(!frame.includes("SKIPME"), frame)
  assert.equal(markdown._blockStates.length, 2)

  // Clearing content destroys every block state; a sparse hole used to throw here.
  markdown.content = ""
  await setup.renderOnce()

  markdown.getTopLevelBlockRaw = original
  markdown.content = document
  await settle(setup)
  frame = setup.captureCharFrame()
  assert.ok(frame.includes("SKIPME"), frame)
  assert.equal(markdown._blockStates.length, 3)

  // Changing the skipped block to a heading forces the replace path: the old
  // state must be spliced out instead of leaving a stale entry behind.
  markdown.getTopLevelBlockRaw = token => (token.raw.includes("SKIPME") ? undefined : original(token))
  markdown.content = ["alpha", "", "# SKIPME", "", "omega"].join(NL)
  await settle(setup)
  frame = setup.captureCharFrame()
  assert.ok(!frame.includes("SKIPME"), frame)
  assert.ok(frame.includes("omega"), frame)
  assert.equal(markdown._blockStates.length, 2)
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("markdown-sparse-blocks ok")
`)
})

test.skipIf(!supportsFfi)("diff split view keeps sides aligned while conceal highlighting resolves", () => {
  runDriver(`
${PREAMBLE}
import { DiffRenderable } from "@defai-digital/ax-tui"

const LONG = "[alpha beta gamma delta epsilon zeta eta theta iota kappa](http://example.com)"
const diff = ["--- a/f.md", "+++ b/f.md", "@@ -1,3 +1,3 @@", " start", "-" + LONG, "+short", " end"].join(NL)
const treeSitterClient = new MockTreeSitterClient()
const setup = await createTestRenderer({ width: 80, height: 12 })
try {
  const view = new DiffRenderable(setup.renderer, {
    diff,
    view: "split",
    wrapMode: "word",
    conceal: true,
    filetype: "markdown",
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
    width: 80,
    height: 10,
  })
  setup.renderer.root.add(view)
  await setup.renderOnce()
  // The line-info pass runs before the code children start highlighting, so
  // the diff must treat dirty-but-not-started highlights as pending too.
  assert.equal(view._waitingForHighlight, true)

  // Wrap alignment rewrites the short side's content, queueing another highlight
  // batch, so settle repeatedly until the pending flag clears.
  for (let i = 0; i < 3; i++) {
    treeSitterClient.resolveAllHighlightOnce()
    await Promise.all([view.leftCodeRenderable.highlightingDone, view.rightCodeRenderable.highlightingDone])
    await setup.renderOnce()
  }
  assert.equal(view._waitingForHighlight, false)

  const rows = setup.captureCharFrame().split(NL)
  const leftRow = rows.findIndex(row => row.slice(0, 40).includes("end"))
  const rightRow = rows.findIndex(row => row.slice(40).includes("end"))
  assert.ok(leftRow >= 0 && rightRow >= 0, rows.join("|"))
  assert.equal(leftRow, rightRow, rows.join("|"))
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("diff-split-conceal ok")
`)
})

test.skipIf(!supportsFfi)("markdown style setters schedule a render on an idle renderer", () => {
  runDriver(`
${PREAMBLE}
const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 1 })
const setup = await createTestRenderer({ width: 60, height: 20 })
try {
  const markdown = new MarkdownRenderable(setup.renderer, {
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
    content: ["# Title", "", "Some **bold** text."].join(NL),
    streaming: false,
  })
  setup.renderer.root.add(markdown)
  await settle(setup)
  const idle = async () => {
    for (let i = 0; i < 50; i++) {
      await setup.renderOnce()
      await setup.waitForVisualIdle()
      if (!setup.renderer.getSchedulerState().hasScheduledRender) return
    }
    throw new Error("renderer never became idle")
  }
  await idle()
  const mutations = [
    () => { markdown.syntaxStyle = SyntaxStyle.create() },
    () => { markdown.fg = "#ff0000" },
    () => { markdown.bg = "#0000ff" },
    () => { markdown.conceal = false },
    () => { markdown.concealCode = true },
  ]
  for (const mutate of mutations) {
    assert.equal(setup.renderer.getSchedulerState().hasScheduledRender, false)
    mutate()
    assert.equal(setup.renderer.getSchedulerState().hasScheduledRender, true, "setter did not schedule a render")
    await settle(setup)
    await idle()
  }
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("markdown-setter-render ok")
`)
})

test.skipIf(!supportsFfi)("diff split view defaults wrapMode to none on first render", () => {
  runDriver(`
${PREAMBLE}
import { DiffRenderable } from "@defai-digital/ax-tui"
const diff = ["--- a/f.txt", "+++ b/f.txt", "@@ -1,2 +1,2 @@", " alpha", "-beta", "+gamma"].join(NL)
const setup = await createTestRenderer({ width: 80, height: 12 })
try {
  const view = new DiffRenderable(setup.renderer, { diff, view: "split", width: 80, height: 10 })
  setup.renderer.root.add(view)
  await setup.renderOnce()
  assert.equal(view.leftCodeRenderable.wrapMode, "none")
  assert.equal(view.rightCodeRenderable.wrapMode, "none")

  view.diff = ["--- a/f.txt", "+++ b/f.txt", "@@ -1,2 +1,2 @@", " alpha", "-beta", "+delta"].join(NL)
  await setup.renderOnce()
  assert.equal(view.leftCodeRenderable.wrapMode, "none")
  assert.equal(view.rightCodeRenderable.wrapMode, "none")
} finally {
  setup.renderer.destroy()
}
console.log("diff-default-wrap-mode ok")
`)
})

test.skipIf(!supportsFfi)("diff error view propagates conceal and wrapMode", () => {
  runDriver(`
${PREAMBLE}
import { DiffRenderable } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 80, height: 12 })
try {
  // A hunk header with no body lines fails parsePatch and builds the error view.
  const view = new DiffRenderable(setup.renderer, { diff: "@@ -1,1 +1,1 @@" + NL, view: "unified", width: 80, height: 10 })
  setup.renderer.root.add(view)
  await setup.renderOnce()
  assert.ok(view.errorCodeRenderable)

  view.conceal = true
  await setup.renderOnce()
  assert.equal(view.errorCodeRenderable.conceal, true)

  view.wrapMode = "word"
  await setup.renderOnce()
  assert.equal(view.errorCodeRenderable.wrapMode, "word")
} finally {
  setup.renderer.destroy()
}
console.log("diff-error-view-options ok")
`)
})

test.skipIf(!supportsFfi)("markdown hr border follows the conceal style on content update", () => {
  runDriver(`
${PREAMBLE}
import { BoxRenderable } from "@defai-digital/ax-tui"
const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 1 })
const setup = await createTestRenderer({ width: 60, height: 20 })
try {
  const style = SyntaxStyle.create()
  const markdown = new MarkdownRenderable(setup.renderer, {
    syntaxStyle: style,
    treeSitterClient,
    content: ["# t", "", "---", ""].join(NL),
    streaming: false,
  })
  setup.renderer.root.add(markdown)
  await settle(setup)
  const hr = markdown._blockStates.find((state) => state.renderable instanceof BoxRenderable)
  assert.ok(hr)

  style.registerStyle("conceal", { fg: "#ff0000" })
  // Change the hr's raw text (--- to ----) so the block is not skipped as
  // unchanged and takes the in-place update branch instead of recreation.
  markdown.content = ["# t2", "", "----", ""].join(NL)
  await settle(setup)
  const updated = markdown._blockStates.find((state) => state.renderable instanceof BoxRenderable)
  assert.ok(updated)
  assert.equal(updated.renderable.borderColor.r, 1)
  assert.equal(updated.renderable.borderColor.g, 0)
  assert.equal(updated.renderable.borderColor.b, 0)
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("markdown-hr-conceal-update ok")
`)
})

test.skipIf(!supportsFfi)("diff filetype clear propagates to code panes", () => {
  runDriver(`
${PREAMBLE}
import { DiffRenderable } from "@defai-digital/ax-tui"
const diff = ["--- a/f.js", "+++ b/f.js", "@@ -1,2 +1,2 @@", " alpha", "-beta", "+gamma"].join(NL)
const setup = await createTestRenderer({ width: 80, height: 12 })
try {
  const view = new DiffRenderable(setup.renderer, { diff, view: "unified", filetype: "js", width: 80, height: 10 })
  setup.renderer.root.add(view)
  await setup.renderOnce()
  assert.equal(view.leftCodeRenderable.filetype, "js")

  // Clearing the filetype must reach existing panes; the update path used to
  // skip undefined and leave stale highlighting in place.
  view.filetype = undefined
  await setup.renderOnce()
  assert.equal(view.leftCodeRenderable.filetype, undefined)

  view.filetype = "ts"
  await setup.renderOnce()
  assert.equal(view.leftCodeRenderable.filetype, "ts")

  view.view = "split"
  await setup.renderOnce()
  assert.equal(view.leftCodeRenderable.filetype, "ts")
  assert.equal(view.rightCodeRenderable.filetype, "ts")
  view.filetype = undefined
  await setup.renderOnce()
  assert.equal(view.leftCodeRenderable.filetype, undefined)
  assert.equal(view.rightCodeRenderable.filetype, undefined)
} finally {
  setup.renderer.destroy()
}
console.log("diff-filetype-clear ok")
`)
})

test.skipIf(!supportsFfi)("diff error view propagates fg and selection colors", () => {
  runDriver(`
${PREAMBLE}
import { DiffRenderable } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 80, height: 12 })
try {
  const view = new DiffRenderable(setup.renderer, {
    diff: "@@ -1,1 +1,1 @@" + NL,
    view: "unified",
    width: 80,
    height: 10,
    fg: "#ff0000",
    selectionBg: "#00ff00",
    selectionFg: "#0000ff",
  })
  setup.renderer.root.add(view)
  await setup.renderOnce()
  assert.ok(view.errorCodeRenderable)
  assert.equal(view.errorCodeRenderable.fg.r, 1)
  assert.equal(view.errorCodeRenderable.fg.g, 0)
  assert.equal(view.errorCodeRenderable.selectionBg.g, 1)
  assert.equal(view.errorCodeRenderable.selectionFg.b, 1)

  view.fg = "#00ffff"
  view.selectionBg = "#ff00ff"
  view.selectionFg = "#ffff00"
  await setup.renderOnce()
  assert.equal(view.errorCodeRenderable.fg.r, 0)
  assert.equal(view.errorCodeRenderable.fg.g, 1)
  assert.equal(view.errorCodeRenderable.fg.b, 1)
  assert.equal(view.errorCodeRenderable.selectionBg.r, 1)
  assert.equal(view.errorCodeRenderable.selectionFg.r, 1)

  // A new invalid diff takes the error-view update path; colors must survive.
  view.diff = "@@ -2,2 +2,2 @@" + NL
  await setup.renderOnce()
  assert.equal(view.errorCodeRenderable.fg.g, 1)
  assert.equal(view.errorCodeRenderable.selectionBg.r, 1)
  assert.equal(view.errorCodeRenderable.selectionFg.r, 1)
} finally {
  setup.renderer.destroy()
}
console.log("diff-error-view-colors ok")
`)
})