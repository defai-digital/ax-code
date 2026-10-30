// Adapted from OpenTUI renderer.native-scene-split.test.ts (MIT). See UPSTREAM.md.
import assert from "node:assert/strict"
import { test, mock } from "node:test"
import { CliRenderEvents, Renderable, BoxRenderable, TextRenderable, OptimizedBuffer } from "@defai-digital/ax-tui"
import { setup, terminal, RecordingStdout } from "./split-footer-support.mjs"

const lines = count => Array.from({ length: count }, (_, i) => `line ${i}`)
const writeRow = (renderer, content) => renderer.writeToScrollback(({ renderContext }) => ({
  root: new TextRenderable(renderContext, { content, width: content.length, height: 1 }),
}))

for (const source of ["one stdout write", "stdout writes", "writer"]) test(`${source}: 300 rows arrive once and in order`, async () => {
  const { renderer, stdout, externalOutput, drain } = await terminal()
  const rows = lines(300)
  if (source === "one stdout write") stdout.write(rows.join("\n") + "\n")
  else for (const row of rows) source === "writer" ? writeRow(renderer, row) : stdout.write(row + "\n")
  assert.deepEqual(externalOutput.take().map(commit => commit.text), rows)
  await drain()
  assert.deepEqual(stdout.text().match(/line \d+/g), rows)
})

for (const source of ["stdout", "writer"]) for (const transition of ["frames", "passthrough", "resize", "suspend", "destroy", "alternate-screen"]) {
  test(`${source}: pending rows drain before ${transition}`, async () => {
    const { renderer, stdout, frame, drain, resize } = await terminal()
    const rows = lines(12)
    if (source === "stdout") stdout.write(rows.join("\n") + "\n")
    else rows.forEach(row => writeRow(renderer, row))
    const feed = renderer._feed
    if (transition === "frames") await frame()
    if (transition === "passthrough") renderer.externalOutputMode = "passthrough"
    if (transition === "resize") resize(60, 12)
    if (transition === "suspend") renderer.suspend()
    if (transition === "destroy") renderer.destroy()
    if (transition === "alternate-screen") {
      renderer.externalOutputMode = "passthrough"
      renderer.screenMode = "alternate-screen"
    }
    if (!renderer.isDestroyed && transition !== "suspend") await drain()
    await feed?.idle()
    const output = stdout.text()
    assert.deepEqual(output.match(/line \d+/g), rows)
    if (transition === "resize") assert.deepEqual([renderer.width, renderer.height], [60, 3])
    if (transition === "destroy" || transition === "suspend") {
      assert.ok(output.lastIndexOf("\x1b[?25h") > output.indexOf("line 11"))
    }
    if (transition === "alternate-screen") assert.ok(output.indexOf("\x1b[?1049h") > output.indexOf("line 11"))
  })
}

for (const chunked of [false, true]) test(`large captured output drains on destruction (${chunked ? "64 KiB writes" : "one write"})`, async () => {
  const { renderer, stdout, frame, externalOutput } = await terminal({ width: 80 })
  const rows = Array.from({ length: 6000 }, (_, row) => `{"row":${row},"data":"`.padEnd(76, "x") + '"},')
  if (chunked) for (let i = 0; i < rows.length; i += 800) {
    stdout.write(rows.slice(i, i + 800).join("\n") + "\n")
    await frame()
  }
  else stdout.write(rows.join("\n") + "\n")
  assert.equal(externalOutput.take().length, rows.length)
  const feed = renderer._feed
  renderer.destroy()
  await feed?.idle()
  assert.deepEqual(stdout.text().match(/"row":\d+/g), rows.map((_, i) => `"row":${i}`))
})

for (const drainKind of ["frames", "suspend", "destroy"]) test(`replay clears at the queued boundary before ${drainKind}`, async () => {
  const { renderer, stdout, drain } = await terminal()
  stdout.write(lines(10).join("\n") + "\npartial")
  renderer.resetSplitFooterForReplay({ clearSavedLines: true })
  renderer.writeToScrollback(({ renderContext, tailColumn }) => {
    assert.equal(tailColumn, 0)
    return { root: new TextRenderable(renderContext, { content: "after", width: 5, height: 1 }) }
  })
  const feed = renderer._feed
  if (drainKind === "frames") await drain()
  else if (drainKind === "suspend") renderer.suspend()
  else renderer.destroy()
  await feed?.idle()
  assert.deepEqual(stdout.text().match(/line \d+|partial|after|\x1b\[2J/g), [...lines(10), "partial", "\x1b[2J", "after"])
  assert.equal(stdout.text().match(/\x1b\[3J/g)?.length, 1)
})

for (const [name, text, commits] of [
  ["ASCII wrapping", "abcdefghijk\n", ["abcdefghi:9", "jk:2\n"]],
  ["wide wrapping", "一二三四五\n", ["一二三四:9", "五:2\n"]],
  ["graphemes", "ok👍🏽 👩‍🚀 e\u0301\n", ["ok👍🏽 👩‍🚀 e\u0301:9\n"]],
  ["tabs", "a\tb\tc\n", ["a       b:9", "c:1\n"]],
  ["CRLF", "one\r\ntwo\r\n", ["one:3\n", "two:3\n"]],
  ["CR restart", "0123456789%\r60%\n\n", ["60%:3\n", ":0\n"]],
  ["continued wide edge", ["abcdefgh", "一x"], ["abcdefgh:8", ":1", "一x:3"]],
  ["continued padding", ["abcde", "fghijklm一\n"], ["abcde:5", "fghi:4", "jklm一:6\n"]],
  ["continued tab", ["a", "bc", "\tX\n"], ["a:1", "bc:2", "     X:6\n"]],
  ["right-edge tab", "\t\tb\n", ["        b:9\n"]],
  ["early wide wrap", ["abc", "defgh一", "x\n"], ["abc:3", "defgh:6", "一:2", "x:1\n"]],
]) test(`captured stdout ${name}`, async () => {
  const stdout = new RecordingStdout(9, 10)
  const { renderer } = await setup({ width: 9, stdout })
  const written = []
  renderer.on(CliRenderEvents.EXTERNAL_OUTPUT, ({ snapshot, rowColumns, trailingNewline }) => {
    const row = new TextDecoder().decode(snapshot.getRealCharBytes(true)).trimEnd()
    written.push(`${row}:${rowColumns}${trailingNewline ? "\n" : ""}`)
  })
  for (const write of [text].flat()) stdout.write(write)
  assert.deepEqual(written, commits)
})

test("capture enabled after destruction leaves stdout uncaptured", async () => {
  const stdout = new RecordingStdout()
  const { renderer } = await setup({ stdout, externalOutputMode: "passthrough" })
  const write = stdout.write
  renderer.destroy()
  renderer.externalOutputMode = "capture-stdout"
  assert.equal(stdout.write, write)
  stdout.write("after destruction\n")
  assert.match(stdout.text(), /after destruction/)
})

for (const source of ["writer", "surface"]) test(`${source} rejects NaN rowColumns without poisoning later frames`, async () => {
  const { renderer, renderOnce, externalOutput } = await setup()
  const errors = []
  renderer.on(CliRenderEvents.RENDER_ERROR, error => errors.push(error))
  assert.throws(() => {
    if (source === "writer") renderer.writeToScrollback(({ renderContext }) => ({
      root: new TextRenderable(renderContext, { content: "x", width: 1, height: 1 }), rowColumns: NaN,
    }))
    else {
      const surface = renderer.createScrollbackSurface()
      try {
        surface.root.add(new TextRenderable(surface.renderContext, { content: "x", width: 1, height: 1 }))
        surface.render()
        surface.commitRows(0, 1, { rowColumns: NaN })
      } finally { surface.destroy() }
    }
  }, RangeError)
  assert.deepEqual(externalOutput.take(), [])
  writeRow(renderer, "next")
  await renderOnce()
  assert.deepEqual(errors, [])
})

test("failed detached paint cannot commit a stale or partially painted buffer", async () => {
  const { renderer, renderOnce, captureCharFrame, externalOutput } = await setup()
  const surface = renderer.createScrollbackSurface()
  let fail = false
  const box = new BoxRenderable(surface.renderContext, { width: 24, height: 2,
    renderBefore() { if (fail) throw new Error("detached paint failed") } })
  box.add(new TextRenderable(surface.renderContext, { content: "detached", height: 1 }))
  surface.root.add(box)
  surface.render()
  fail = true
  assert.throws(() => surface.render(), /detached paint failed/)
  assert.throws(() => surface.commitRows(0, 1), /requires render/)
  fail = false
  const footer = new BoxRenderable(renderer, { width: 24, height: 1, renderBefore: () => surface.render() })
  footer.add(new TextRenderable(renderer, { content: "footer", height: 1 }))
  renderer.root.add(footer)
  await renderOnce()
  assert.match(captureCharFrame(), /footer/)
  assert.doesNotMatch(captureCharFrame(), /detached/)
  surface.commitRows(0, 1)
  assert.match(externalOutput.takeText(), /detached/)
})

test("captured stdout allocation failure releases all provisional snapshots", async () => {
  const stdout = new RecordingStdout()
  const { externalOutput } = await setup({ stdout })
  const registered = new Set(Renderable.renderablesByNumber.keys())
  const create = OptimizedBuffer.create
  const created = []
  const spy = mock.method(OptimizedBuffer, "create", (...args) => {
    if (created.length === 2) throw new Error("allocation failed")
    const buffer = create.apply(OptimizedBuffer, args)
    created.push(buffer)
    return buffer
  })
  try { assert.throws(() => stdout.write("a\nb\nc\n"), /allocation failed/) }
  finally { spy.mock.restore() }
  assert.deepEqual(created.map(buffer => buffer._destroyed), [true, true])
  assert.deepEqual(new Set(Renderable.renderablesByNumber.keys()), registered)
  assert.deepEqual(externalOutput.take(), [])
  stdout.write("d\n")
  assert.equal(externalOutput.takeText(), "d")
})

for (const kind of ["writer", "geometry"]) test(`snapshot ${kind} failure releases provisional nodes`, async () => {
  const { renderer, externalOutput } = await setup()
  const registered = new Set(Renderable.renderablesByNumber.keys())
  let root
  assert.throws(() => renderer.writeToScrollback(({ renderContext }) => {
    root = new BoxRenderable(renderContext, { width: 12 })
    if (kind === "writer") throw new Error("writer failed")
    return { root, width: NaN, height: 1 }
  }), kind === "writer" ? /writer failed/ : /width/)
  assert.equal(root.isDestroyed, true)
  assert.deepEqual(new Set(Renderable.renderablesByNumber.keys()), registered)
  assert.deepEqual(externalOutput.take(), [])
  writeRow(renderer, "next")
  assert.equal(externalOutput.takeText(), "next")
  assert.deepEqual(new Set(Renderable.renderablesByNumber.keys()), registered)
})

for (const source of ["writer", "surface"]) test(`${source} coerces non-boolean flags`, async () => {
  const { renderer, externalOutput, renderOnce } = await setup()
  if (source === "writer") renderer.writeToScrollback(({ renderContext }) => ({
    root: new TextRenderable(renderContext, { content: "x", width: 1, height: 1 }),
    startOnNewLine: 0, trailingNewline: "yes",
  }))
  else {
    const surface = renderer.createScrollbackSurface()
    surface.root.add(new TextRenderable(surface.renderContext, { content: "x", width: 1, height: 1 }))
    surface.render()
    surface.commitRows(0, 1, { trailingNewline: 0 })
    surface.destroy()
  }
  const [commit] = externalOutput.take()
  assert.equal(commit.startOnNewLine, source === "surface")
  assert.equal(commit.trailingNewline, source === "writer")
  await renderOnce()
})

test("predicted tail includes every cell of a trailing wide character", async () => {
  const { renderer, stdout, frame } = await terminal()
  stdout.write("ab二")
  await frame()
  stdout.write("\nab二")
  renderer.writeToScrollback(({ renderContext, tailColumn }) => {
    assert.equal(tailColumn, 4)
    return { root: new TextRenderable(renderContext, { content: "x", width: 1, height: 1 }) }
  })
})
