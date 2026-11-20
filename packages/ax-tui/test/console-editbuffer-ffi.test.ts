import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

function runFfiScript(script: string) {
  return spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 20_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
}

test.skipIf(!supportsFfi)("wrapped console lines carry the indent flag without baked-in spaces", () => {
  const result = runFfiScript(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 12, consoleMode: "console-overlay" })
const { renderer, renderOnce } = setup
try {
  renderer.console.activate()
  console.log("first log line")
  console.log("x".repeat(120))
  renderer.console.show()
  await renderOnce()
  const lines = renderer.console["_displayLines"]
  assert.ok(lines.length > 4, "long entries must wrap into multiple display lines")
  assert.equal(lines[0].indent, false)
  const indented = lines.filter((line) => line.indent)
  assert.ok(indented.length > 0, "wrapped continuation lines must carry the indent flag")
  for (const line of indented) {
    assert.ok(/^x+'?$/.test(line.text),
      "indent must come from the flag, not baked-in spaces: " + JSON.stringify(line))
  }
} finally { renderer.destroy() }
process.stdout.write("AX_CONSOLE_INDENT_COMPLETE\\n")
`)
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain("AX_CONSOLE_INDENT_COMPLETE")
})

test.skipIf(!supportsFfi)("console destroy frees the framebuffer", () => {
  const result = runFfiScript(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 12, consoleMode: "console-overlay" })
const { renderer, renderOnce } = setup
try {
  renderer.console.activate()
  console.log("hello")
  renderer.console.show()
  await renderOnce()
  assert.ok(renderer.console["frameBuffer"], "show must allocate the framebuffer")
  renderer.console.destroy()
  assert.equal(renderer.console["frameBuffer"], null, "destroy must free the framebuffer")
} finally { renderer.destroy() }
process.stdout.write("AX_CONSOLE_DESTROY_COMPLETE\\n")
`)
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain("AX_CONSOLE_DESTROY_COMPLETE")
})

test.skipIf(!supportsFfi)("newLine replaces the selection instead of appending", () => {
  const result = runFfiScript(`
import assert from "node:assert/strict"
import { TextareaRenderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 30, height: 6 })
const { renderer } = setup
try {
  const area = new TextareaRenderable(renderer, { initialValue: "hello world", width: 20, height: 3 })
  renderer.root.add(area)
  area.selectAll()
  assert.ok(area.hasSelection(), "selectAll must create a selection")
  area.newLine()
  assert.equal(area.plainText, "\\n", "newLine must delete the selection before inserting the newline")
} finally { renderer.destroy() }
console.log("AX_NEWLINE_SELECTION_COMPLETE")
`)
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain("AX_NEWLINE_SELECTION_COMPLETE")
})

test.skipIf(!supportsFfi)("home and end stay on the current line at its boundaries", () => {
  const result = runFfiScript(`
import assert from "node:assert/strict"
import { TextareaRenderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 30, height: 6 })
const { renderer } = setup
try {
  const area = new TextareaRenderable(renderer, { initialValue: "ab\\ncd", width: 20, height: 3 })
  renderer.root.add(area)
  area.setCursor(1, 0)
  area.gotoLineHome()
  assert.equal(area.logicalCursor.row, 1, "home at column 0 must stay on the current line")
  assert.equal(area.logicalCursor.col, 0)
  area.setCursor(0, 2)
  area.gotoLineEnd()
  assert.equal(area.logicalCursor.row, 0, "end at EOL must stay on the current line")
  assert.equal(area.logicalCursor.col, 2)
  area.setCursor(1, 1)
  area.gotoLineHome()
  assert.equal(area.logicalCursor.row, 1)
  assert.equal(area.logicalCursor.col, 0)
  area.gotoLineEnd()
  assert.equal(area.logicalCursor.row, 1)
  assert.equal(area.logicalCursor.col, 2)
} finally { renderer.destroy() }
console.log("AX_HOME_END_COMPLETE")
`)
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain("AX_HOME_END_COMPLETE")
})
