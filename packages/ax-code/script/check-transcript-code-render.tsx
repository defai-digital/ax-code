// Native renderer regression for the transcript's finished-text block.
//
// Two invariants, both about the moment a streamed reply finishes:
//
// 1. The first frame of the finished block shows its text. With
//    `drawUnstyledText: false`, ax-tui leaves `_shouldRenderTextBuffer` false
//    until the async tree-sitter highlight resolves, so the first frame is EMPTY
//    and the block reappears with whichever wrapping the highlighted pass
//    produces. The framework default (true) paints the plain buffer immediately
//    and lets the highlight replace it, which is how Kimi Code keeps a streamed
//    block stable (transient plain text, one styled pass).
// 2. The streamed plain text and the finished render paint the same rows. The
//    markdown renderable consumes fenced blocks structurally and the transcript
//    runs it with conceal off, so the streamed source only has to drop fence
//    rows (`stripFenceLines`) for the swap to be a pure styling change.
//
// See .internal/reports/2026-09-26-tui-transcript-stability-plan.md.
//
// Usage: node script/node-ffi-runner.mjs --import tsx --import ../../script/solid-loader.mjs \
//          --conditions=node script/check-transcript-code-render.tsx

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const state = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-transcript-code-"))
process.env.XDG_STATE_HOME = state
process.env.XDG_CONFIG_HOME = state
process.env.XDG_DATA_HOME = state
process.env.AX_CODE_DISABLE_PROJECT_CONFIG = "true"

const { testRender } = await import("ax-tui/solid")
const { createTestRenderer } = await import("ax-tui/testing")
const { MarkdownRenderable, SyntaxStyle, RGBA, TextRenderable } = await import("ax-tui")
const { SessionCodeRenderer } = await import("../src/cli/tui/routes/session/render-adapter")
const { stripFenceLines } = await import("../src/cli/tui/routes/session/view-model")

const content = ["# Heading", "", "paragraph text here", "", "```ts", "const answer = 42", "```", ""].join("\n")

function paintedRows(frame: string) {
  return frame.split("\n").filter((line) => line.trim().length > 0).length
}

function paintedLines(frame: string) {
  return frame
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.trimEnd())
}

async function renderOnce(make: (renderer: any) => any, width: number, height: number) {
  const setup = await createTestRenderer({ width, height })
  try {
    setup.renderer.root.add(make(setup.renderer))
    await setup.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 350))
    setup.renderer.requestRender()
    await setup.renderOnce()
    return paintedLines(setup.captureCharFrame())
  } finally {
    setup.renderer.destroy()
  }
}

let cases = 0
try {
  // Invariant: the first frame of a finished code block shows its text. The
  // probe uses the component's own defaults — passing `drawUnstyledText`
  // explicitly here would hide the regression the guard exists for.
  const setup = await testRender(
    () => <SessionCodeRenderer display={{ filetype: "markdown", content }} streaming={false} />,
    { width: 60, height: 12 },
  )
  try {
    await setup.flush()
    const first = setup.captureCharFrame()
    assert(first.includes("Heading"), "first frame must show the finished heading")
    assert(first.includes("paragraph text"), "first frame must show the finished prose")
    assert(first.includes("const answer"), "first frame must show the finished code block")

    // Reported, not asserted: once the highlight resolves, `conceal` may drop
    // the fence rows (a known, documented follow-up). The guard locks the blank
    // first frame, which is the regression this check exists for.
    await new Promise((resolve) => setTimeout(resolve, 300))
    await setup.flush()
    console.log(`finished block rows: first=${paintedRows(first)} settled=${paintedRows(setup.captureCharFrame())}`)
    cases++
  } finally {
    setup.renderer.destroy()
  }

  // Legacy control: the old configuration is exactly why the guard exists. It
  // is allowed to paint nothing, so it is reported rather than asserted.
  const legacy = await testRender(
    () => (
      <SessionCodeRenderer display={{ filetype: "markdown", content }} drawUnstyledText={false} streaming={false} />
    ),
    { width: 60, height: 12 },
  )
  try {
    await legacy.flush()
    const first = legacy.captureCharFrame()
    console.log(`legacy drawUnstyledText=false first frame: ${paintedRows(first)} painted rows`)
  } finally {
    legacy.renderer.destroy()
  }

  // Invariant 2: the streamed plain text and the finished markdown render paint
  // the same rows for the same source. The markdown renderable consumes fenced
  // blocks structurally and the transcript runs it with conceal off, so
  // `stripFenceLines` is the whole streaming-side transformation.
  const parityFixture = [
    "## Heading one",
    "",
    "Some **bold** text with `code` and a [link](https://example.com/x).",
    "",
    "- first bullet",
    "- second bullet",
    "",
    "```ts",
    "const answer = 42",
    "```",
    "",
  ].join("\n")
  const syntaxStyle = SyntaxStyle.fromTheme([
    { scope: ["default"], style: { foreground: RGBA.fromInts(220, 220, 220) } },
  ])
  const streamed = await renderOnce(
    (renderer) => new TextRenderable(renderer, { content: stripFenceLines(parityFixture), wrapMode: "word" }),
    60,
    24,
  )
  const finished = await renderOnce(
    (renderer) =>
      new MarkdownRenderable(renderer, { content: parityFixture, conceal: false, syntaxStyle }),
    60,
    24,
  )
  assert.equal(
    finished.join("\n"),
    streamed.join("\n"),
    "the streamed text and the finished markdown render must paint identical rows",
  )
  console.log(`streamed/finished parity: ${streamed.length} rows identical`)
  cases++

  console.log(`PASS: ${cases} transcript finish-state checks.`)
} finally {
  await fs.rm(state, { recursive: true, force: true })
}
