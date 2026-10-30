import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Characterization coverage for TextTableRenderable layout (column widths and
// row heights), which previously had none. The driver runs against the built
// package in a subprocess because the renderer needs Node's --experimental-ffi.
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
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { TextTableRenderable } from "@defai-digital/ax-tui"

const NL = String.fromCharCode(10)
const cell = (text) => [{ __isChunk: true, text, attributes: 0 }]
const CONTENT = [
  [cell("Name"), cell("Note")],
  [cell("al"), cell("short")],
  [cell("bo"), cell("a much longer note that wraps")],
]
`

test.skipIf(!supportsFfi)("fitting table keeps every row on one line", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 40, height: 12 })
try {
  const table = new TextTableRenderable(setup.renderer, { width: "100%", content: CONTENT })
  setup.renderer.root.add(table)
  await setup.renderOnce()

  const frame = setup.captureCharFrame()
  assert.ok(frame.includes("a much longer note that wraps"), frame)
  const lines = frame.split(NL)
  const headLine = lines.findIndex((line) => line.includes("a much longer note"))
  const tailLine = lines.findIndex((line) => line.includes("that wraps"))
  assert.ok(headLine >= 0 && tailLine === headLine, frame)
} finally {
  setup.renderer.destroy()
}
console.log("text-table fit ok")
`)
})

test.skipIf(!supportsFfi)("narrow table wraps overflowing cells onto extra lines", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 26, height: 12 })
try {
  const table = new TextTableRenderable(setup.renderer, { width: "100%", content: CONTENT })
  setup.renderer.root.add(table)
  await setup.renderOnce()

  const frame = setup.captureCharFrame()
  assert.ok(!frame.includes("a much longer note that wraps"), frame)
  const lines = frame.split(NL)
  const headLine = lines.findIndex((line) => line.includes("a much longer note"))
  const tailLine = lines.findIndex((line) => line.includes("that wraps"))
  assert.ok(headLine >= 0, frame)
  assert.ok(tailLine === headLine + 1, frame)

  // A content update that lengthens one cell re-wraps only through the layout.
  table.content = [
    [cell("Name"), cell("Note")],
    [cell("al"), cell("short")],
    [cell("bo"), cell("tiny")],
  ]
  await setup.renderOnce()
  const updated = setup.captureCharFrame()
  const updatedLines = updated.split(NL)
  const tinyLine = updatedLines.findIndex((line) => line.includes("tiny"))
  assert.ok(tinyLine >= 0, updated)
  assert.ok(!updated.includes("a much longer note"), updated)
} finally {
  setup.renderer.destroy()
}
console.log("text-table wrap ok")
`)
})

test.skipIf(!supportsFfi)("wrapMode none never wraps overflowing cells", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 26, height: 12 })
try {
  const table = new TextTableRenderable(setup.renderer, { width: "100%", content: CONTENT, wrapMode: "none" })
  setup.renderer.root.add(table)
  await setup.renderOnce()

  const frame = setup.captureCharFrame()
  const lines = frame.split(NL)
  const headLine = lines.findIndex((line) => line.includes("a much longer note"))
  assert.ok(headLine >= 0, frame)
  assert.ok(!frame.includes("wraps"), frame)
} finally {
  setup.renderer.destroy()
}
console.log("text-table nowrap ok")
`)
})

test.skipIf(!supportsFfi)("fitting cells skip the wrap-measure pass while overflowing cells are still measured", () => {
  runDriver(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { TextTableRenderable, TextBufferView } from "@defai-digital/ax-tui"

const cell = (text) => [{ __isChunk: true, text, attributes: 0 }]

let measureCalls = 0
const originalMeasure = TextBufferView.prototype.measureForDimensions
TextBufferView.prototype.measureForDimensions = function (...args) {
  measureCalls++
  return originalMeasure.apply(this, args)
}

const makeContent = () => [
  [cell("Name"), cell("Note"), cell("State")],
  ...Array.from({ length: 9 }, (_, i) => [cell("row" + i), cell("short note " + i), cell("ok")]),
]

const setup = await createTestRenderer({ width: 80, height: 20 })
try {
  const table = new TextTableRenderable(setup.renderer, { width: "100%", content: makeContent() })
  setup.renderer.root.add(table)
  await setup.renderOnce()

  // A content swap relayouts 30 fresh cells that all fit their columns:
  // exactly one intrinsic measure per cell, no wrap-measure pass.
  measureCalls = 0
  table.content = makeContent()
  await setup.renderOnce()
  assert.ok(measureCalls > 0 && measureCalls <= 30, "expected a single intrinsic measure per cell, got " + measureCalls)
} finally {
  setup.renderer.destroy()
}

const narrow = await createTestRenderer({ width: 26, height: 12 })
try {
  const wrapContent = () => [
    [cell("Name"), cell("Note")],
    [cell("al"), cell("short")],
    [cell("bo"), cell("a much longer note that wraps")],
  ]
  const wrapTable = new TextTableRenderable(narrow.renderer, { width: "100%", content: wrapContent() })
  narrow.renderer.root.add(wrapTable)
  await narrow.renderOnce()

  measureCalls = 0
  wrapTable.content = wrapContent()
  await narrow.renderOnce()
  assert.ok(measureCalls > 6, "overflowing cells must still be wrap-measured, got " + measureCalls)
} finally {
  narrow.renderer.destroy()
}
console.log("text-table measure-pass ok")
`)
})

test.skipIf(!supportsFfi)("wide graphemes keep their cell width instead of covering the separator", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 20, height: 6 })
try {
  const table = new TextTableRenderable(setup.renderer, {
    width: 6,
    content: [[cell("界"), cell("ab")]],
    wrapMode: "char",
  })
  setup.renderer.root.add(table)
  await setup.renderOnce()

  const frame = setup.captureCharFrame()
  assert.ok(!frame.includes("│界ab│"), frame)
  assert.ok(frame.includes("│界│"), frame)
} finally {
  setup.renderer.destroy()
}
console.log("text-table wide grapheme ok")
`)
})
