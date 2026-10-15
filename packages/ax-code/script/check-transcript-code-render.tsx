// Native renderer regression for the transcript's finished-text block.
//
// Invariants, all about the moment a streamed reply finishes:
//
// 1. Tree-sitter initialises and highlights a fenced ```ts block inside
//    markdown. A failed initialisation silently degrades every finished reply
//    to plain text, so it fails this check instead.
// 2. The first frame of the finished block shows its text. With
//    `drawUnstyledText: false`, ax-tui leaves `_shouldRenderTextBuffer` false
//    until the async tree-sitter highlight resolves, so the first frame is EMPTY
//    and the block reappears with whichever wrapping the highlighted pass
//    produces. The framework default (true) paints the plain buffer immediately
//    and lets the highlight replace it.
// 3. A finished ```ts block is syntax-highlighted. The transcript used to strip
//    the fence lines from the finished text too, so tree-sitter parsed the code
//    as a paragraph and nothing was coloured.
// 4. The finalize swap changes no row. The code renderer removes fence rows
//    once highlighted (the markdown highlights query marks delimiters
//    `conceal_lines`), so the streamed plain text drops them
//    (`stripFenceLines`) and the finished renderer paints the stripped text as
//    `initialStyledText` until the highlight lands. Streamed, first finished,
//    and settled finished frames must all paint identical rows. The
//    experimental markdown renderable gets the same parity check.
//
// See .internal/reports/2026-09-26-tui-transcript-stability-plan.md.
//
// Usage: pnpm --dir packages/ax-code run check:transcript-code-render

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
const { MarkdownRenderable, SyntaxStyle, RGBA, TextRenderable, getTreeSitterClient, stringToStyledText } = await import(
  "ax-tui"
)
const { SessionCodeRenderer } = await import("../src/cli/tui/routes/session/render-adapter")
const { stripFenceLines } = await import("../src/cli/tui/routes/session/view-model")

const content = ["# Heading", "", "paragraph text here", "", "```ts", "const answer = 42", "```", ""].join("\n")

const DEFAULT_FG = RGBA.fromInts(220, 220, 220)
const KEYWORD_FG = RGBA.fromInts(255, 0, 0)
const TYPE_FG = RGBA.fromInts(0, 128, 255)
// Distinct keyword/type colours so a highlighted span is unambiguous.
const syntaxStyle = SyntaxStyle.fromTheme([
  { scope: ["default"], style: { foreground: DEFAULT_FG } },
  { scope: ["keyword"], style: { foreground: KEYWORD_FG } },
  { scope: ["type", "type.builtin"], style: { foreground: TYPE_FG } },
])

function paintedRows(frame: string) {
  return frame.split("\n").filter((line) => line.trim().length > 0).length
}

/** Frame rows down to the last painted one, interior blank rows included. */
function paintedLines(frame: string) {
  const lines = frame.split("\n").map((line) => line.trimEnd())
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  return lines
}

function sameColor(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  const close = (x: number, y: number) => Math.abs(x - y) < 1 / 255
  return close(a.r, b.r) && close(a.g, b.g) && close(a.b, b.b)
}

/** Painted text of every span drawn in `color`. */
function spansIn(frame: { lines: { spans: { text: string; fg: any }[] }[] }, color: any) {
  return frame.lines.flatMap((line) =>
    line.spans.filter((span) => sameColor(span.fg, color)).map((span) => span.text.trim()),
  )
}

async function renderOnce(
  make: (renderer: any) => any,
  width: number,
  height: number,
  ready: (frame: string) => boolean,
) {
  const setup = await createTestRenderer({ width, height })
  try {
    setup.renderer.root.add(make(setup.renderer))
    await setup.renderOnce()
    const deadline = Date.now() + 10_000
    let frame = setup.captureCharFrame()
    while (!ready(frame) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      setup.renderer.requestRender()
      await setup.renderOnce()
      frame = setup.captureCharFrame()
    }
    assert(ready(frame), "rendered text did not settle before the 10-second deadline")
    return paintedLines(frame)
  } finally {
    setup.renderer.destroy()
  }
}

/** Render a finished transcript code block; return its first and highlighted frames. */
async function renderFinished(source: string, width: number, height: number) {
  const setup = await testRender(
    () => (
      <SessionCodeRenderer
        display={{ filetype: "markdown", content: source }}
        streaming={false}
        syntaxStyle={syntaxStyle}
        conceal={true}
        // Mirrors transcript.tsx: the pre-highlight frame paints the text with
        // the fence rows the highlight conceals already removed.
        initialStyledText={stringToStyledText(stripFenceLines(source))}
      />
    ),
    { width, height },
  )
  try {
    await setup.renderOnce()
    const first = paintedLines(setup.captureCharFrame())
    const deadline = Date.now() + 10_000
    let spans = setup.captureSpans()
    while (spansIn(spans, KEYWORD_FG).length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      setup.renderer.requestRender()
      await setup.renderOnce()
      spans = setup.captureSpans()
    }
    return { first, settled: paintedLines(setup.captureCharFrame()), spans }
  } finally {
    setup.renderer.destroy()
  }
}

let cases = 0
try {
  // Invariant 1: tree-sitter initialises and highlights the fenced block.
  const client = getTreeSitterClient()
  await client.initialize()
  assert(client.isInitialized(), "tree-sitter client failed to initialise")
  const probe = await client.highlightOnce(content, "markdown")
  assert(!probe.error, `tree-sitter highlight failed: ${probe.error}`)
  const groups = new Set((probe.highlights ?? []).map((highlight) => highlight[2]))
  assert(
    groups.has("keyword"),
    `tree-sitter returned no keyword capture for a fenced ts block: ${[...groups].join(", ") || "(none)"}`,
  )
  console.log(`tree-sitter: initialised, ${probe.highlights?.length ?? 0} captures`)
  cases++

  // Invariant 2: the first frame of a finished code block shows its text. The
  // probe uses the component's own defaults — passing `drawUnstyledText`
  // explicitly here would hide the regression the guard exists for.
  const setup = await testRender(
    () => (
      <SessionCodeRenderer display={{ filetype: "markdown", content }} streaming={false} syntaxStyle={syntaxStyle} />
    ),
    { width: 60, height: 12 },
  )
  try {
    await setup.flush()
    const first = setup.captureCharFrame()
    assert(first.includes("Heading"), "first frame must show the finished heading")
    assert(first.includes("paragraph text"), "first frame must show the finished prose")
    assert(first.includes("const answer"), "first frame must show the finished code block")
    console.log(`finished block first frame: ${paintedRows(first)} painted rows`)
    cases++
  } finally {
    setup.renderer.destroy()
  }

  // Legacy control: the old configuration is exactly why the guard exists. It
  // is allowed to paint nothing, so it is reported rather than asserted.
  const legacy = await testRender(
    () => (
      <SessionCodeRenderer
        display={{ filetype: "markdown", content }}
        drawUnstyledText={false}
        streaming={false}
        syntaxStyle={syntaxStyle}
      />
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

  // Invariants 3 and 4 share the fixture the transcript would stream. The
  // width keeps every line unwrapped: conceal also hides inline markers
  // (`**`, backticks, link targets), which can legitimately re-wrap a long
  // line at the finalize swap (documented in transcript.tsx). This check is
  // about fence rows.
  const parityFixture = [
    "## Heading one",
    "",
    "Some **bold** text with `code` and a [link](https://example.com/x).",
    "",
    "- first bullet",
    "- second bullet",
    "",
    "```ts",
    "const answer: number = 42",
    "```",
    "",
    "outro line",
  ].join("\n")
  const parityReady = (frame: string) =>
    [
      "Heading one",
      "Some **bold** text",
      "first bullet",
      "second bullet",
      "const answer: number = 42",
      "outro line",
    ].every((line) => frame.includes(line))
  const streamed = await renderOnce(
    (renderer) => new TextRenderable(renderer, { content: stripFenceLines(parityFixture), wrapMode: "word" }),
    100,
    24,
    parityReady,
  )

  // Invariant 3: the finished ```ts block is highlighted.
  const finished = await renderFinished(parityFixture, 100, 24)
  const keywords = spansIn(finished.spans, KEYWORD_FG)
  const types = spansIn(finished.spans, TYPE_FG)
  assert(
    keywords.includes("const"),
    `finished ts block has no keyword highlight (keyword spans: ${keywords.join(",")})`,
  )
  assert(types.includes("number"), `finished ts block has no type highlight (type spans: ${types.join(",")})`)
  console.log(`finished ts block highlighted: keyword=[${keywords.join(",")}] type=[${types.join(",")}]`)
  cases++

  // Invariant 4: streamed, first finished, and highlighted finished frames
  // paint identical rows, and no fence row survives the highlight.
  const finishedRows = (lines: string[]) => lines.length
  assert.equal(
    finished.first.length,
    streamed.length,
    `the finished pre-highlight frame changed the row count (${finished.first.length} vs streamed ${streamed.length})`,
  )
  assert.equal(
    finished.settled.length,
    streamed.length,
    `the highlighted finished frame changed the row count (${finished.settled.length} vs streamed ${streamed.length}):\n${finished.settled.join("\n")}\n---\n${streamed.join("\n")}`,
  )
  assert(!finished.settled.some((line) => line.includes("```")), "the highlighted finished frame painted a fence row")
  assert(!finished.first.some((line) => line.includes("```")), "the pre-highlight finished frame painted a fence row")
  console.log(
    `streamed/finished-code parity: streamed=${streamed.length} first=${finishedRows(finished.first)} settled=${finishedRows(finished.settled)} rows`,
  )
  cases++

  // The experimental markdown renderable consumes fenced blocks structurally;
  // the streamed text drops fence rows for it too.
  const markdown = await renderOnce(
    (renderer) => new MarkdownRenderable(renderer, { content: parityFixture, conceal: false, syntaxStyle }),
    100,
    24,
    parityReady,
  )
  assert.equal(
    markdown.join("\n"),
    streamed.join("\n"),
    "the streamed text and the finished markdown render must paint identical rows",
  )
  console.log(`streamed/finished-markdown parity: ${streamed.length} rows identical`)
  cases++

  console.log(`PASS: ${cases} transcript finish-state checks.`)
} finally {
  await fs.rm(state, { recursive: true, force: true })
}
