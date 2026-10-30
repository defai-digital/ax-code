import assert from "node:assert/strict"
import { test } from "node:test"
import xterm from "@xterm/headless"
import { TextRenderable } from "@defai-digital/ax-tui"
import { terminal } from "./split-footer-support.mjs"

// Disjoint wire-byte categories, including SGR in control rather than text.
function account(output, mode = "split-footer") {
  const result = { total: Buffer.byteLength(output), rows: 0, footer: 0, control: 0, clears: 0 }
  let row = 1
  for (const token of output.match(/\x1b\[[0-?]*[ -/]*[@-~]|[\r\n]|[^\x1b\r\n]+/g) ?? []) {
    const bytes = Buffer.byteLength(token)
    if (token.startsWith("\x1b")) {
      result[/[JK]$/.test(token) ? "clears" : "control"] += bytes
      const cursor = token.match(/^\x1b\[(\d+);\d+H$/)
      if (cursor) row = Number(cursor[1])
    } else if (token === "\r" || token === "\n") {
      result.control += bytes
      if (token === "\n") row++
    } else if (mode === "main-screen") {
      // Main-screen emits partial cell diffs, so classify by cursor row,
      // not by whole transcript markers. Its footer occupies rows 1-12.
      result[row <= 12 ? "footer" : "rows"] += bytes
    } else {
      const rows = (token.match(/ROW\d{4}/g) ?? []).join("").length
      result.rows += rows
      result.footer += bytes - rows
    }
  }
  assert.equal(result.total, result.rows + result.footer + result.control + result.clears)
  return result
}

for (const [width, height] of [[80, 24], [200, 60]]) {
  for (const mode of ["split-footer", "main-screen"]) test(`${mode} byte budget ${width}x${height}`, async t => {
    const { renderer, stdout, frame, drain } = await terminal({ width, height, footerHeight: 12,
      screenMode: mode, externalOutputMode: mode === "split-footer" ? "capture-stdout" : "passthrough" })
    const footer = new TextRenderable(renderer, { content: Array.from({ length: 12 }, (_, i) =>
      `FOOTER ${i}`.padEnd(width - 1, ".")).join("\n"), width, height: 12 })
    renderer.root.add(footer)
    await frame()
    const screen = new xterm.Terminal({ cols: width, rows: height, allowProposedApi: true })
    const display = data => new Promise(resolve => screen.write(data, resolve))
    await display(stdout.text())
    stdout.clear()
    const budgets = []
    for (let i = 0; i < 30; i++) {
      const content = Array.from({ length: 1 + i % 3 }, (_, row) => `ROW${String(i * 3 + row).padStart(4, "0")}`).join("\n")
      if (mode === "split-footer") renderer.writeToScrollback(({ renderContext }) => ({
        root: new TextRenderable(renderContext, { content, width: 7, height: 1 + i % 3 }),
      }))
      else {
        // Same incoming rows replace the live transcript area in the main-screen profile.
        if (!renderer.byteTranscript) {
          renderer.byteTranscript = new TextRenderable(renderer, { content, width, height: 3 })
          renderer.root.add(renderer.byteTranscript)
        }
        renderer.byteTranscript.content = content
      }
      await frame()
      const output = stdout.text()
      budgets.push(account(output, mode))
      await display(output)
      if (mode === "split-footer") {
        assert.deepEqual(output.match(/ROW\d{4}/g), content.split("\n"), "rows appear exactly once in order")
        for (let row = 0; row < 12; row++) {
          assert.equal(screen.buffer.active.getLine(screen.buffer.active.baseY + renderer.renderOffset + row)
            .translateToString(true).trimEnd(), `FOOTER ${row}`.padEnd(width - 1, "."))
        }
      }
      stdout.clear()
    }
    const sum = values => values.reduce((a, b) => Object.fromEntries(Object.keys(b).map(k => [k, (a[k] ?? 0) + b[k]])), {})
    const growth = sum(budgets.slice(0, 20))
    const tail = sum(budgets.slice(20))
    let resizes = 0
    renderer.on("resize", () => resizes++)
    for (let i = 0; i < 100; i++) renderer.handleResize(width + 1 + i % 2, height + 1 + i % 2)
    await new Promise(resolve => setTimeout(resolve, 150))
    await drain()
    await frame()
    const storm = account(stdout.text(), mode)
    screen.dispose()
    t.diagnostic(JSON.stringify({ width, height, mode, growth, tail, storm, resizes }))
    if (process.env.AX_TUI_BYTE_BASELINE !== "1" && mode === "split-footer") {
      assert.equal(growth.footer, 0, "unchanged footer must move without repaint")
      for (const budget of budgets) assert.ok(budget.total <= budget.rows + 250, JSON.stringify(budget))
      assert.equal(resizes, 1, "resize burst must apply only final geometry")
    }
  })
}

for (const transition of ["settle", "restore", "destroy"]) test(`pending resize rows survive ${transition}`, async () => {
  const { renderer, stdout, frame, drain } = await terminal({ width: 80, height: 24, footerHeight: 12 })
  renderer.root.add(new TextRenderable(renderer, { content: "LIVE-FOOTER", height: 1 }))
  await frame()
  stdout.clear()
  renderer.handleResize(82, 26)
  renderer.writeToScrollback(({ renderContext }) => ({
    root: new TextRenderable(renderContext, { content: "ROW0000", width: 7, height: 1 }),
  }))
  await frame()
  if (transition === "restore") renderer.handleResize(80, 24)
  assert.equal(stdout.text(), "", "do not append through obsolete scroll margins")
  if (transition === "destroy") renderer.destroy()
  else {
    await new Promise(resolve => setTimeout(resolve, 150))
    await drain()
    await frame()
  }
  await renderer._feed?.idle()
  const output = stdout.text()
  assert.deepEqual(output.match(/ROW\d{4}/g), ["ROW0000"])
  if (transition === "settle") {
    assert.equal((output.match(/LIVE-FOOTER/g) ?? []).length, 1)
    assert.equal(account(output).footer, 82 * 12, "one populated footer repaint, no preceding blank repaint")
  }
  assert.ok(!output.includes("\x1b[2J") && !output.includes("\x1b[?1049l"))
})

test("relocated footer repaints only a changed cell", async () => {
  const { renderer, stdout, frame } = await terminal({ width: 80, height: 24, footerHeight: 12 })
  const footer = new TextRenderable(renderer, { content: "FOOTER", height: 1 })
  renderer.root.add(footer)
  await frame()
  stdout.clear()
  footer.content = "fOOTER"
  renderer.writeToScrollback(({ renderContext }) => ({
    root: new TextRenderable(renderContext, { content: "ROW0000", width: 7, height: 1 }),
  }))
  await frame()
  assert.equal(account(stdout.text()).footer, 1)
  assert.ok(stdout.text().includes("f"))
})
