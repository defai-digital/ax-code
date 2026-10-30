// Adapted from OpenTUI renderer.scrollback-surface.test.ts (MIT). See UPSTREAM.md.
import assert from "node:assert/strict"
import { test } from "node:test"
import { Renderable, TextRenderable, CodeRenderable, MarkdownRenderable, SyntaxStyle, RGBA } from "@defai-digital/ax-tui"
import { setRendererCapabilities } from "@defai-digital/ax-tui/testing"
import { setup, client } from "./split-footer-support.mjs"

const style = () => SyntaxStyle.fromStyles({ default: { fg: RGBA.fromValues(1, 1, 1, 1) } })

class CountingRenderable extends Renderable {
  renderCount = 0
  renderSelf() { this.renderCount++ }
}

test("commitRows reuses the rendered buffer and owns an immutable snapshot", async () => {
  const { renderer, externalOutput } = await setup()
  const surface = renderer.createScrollbackSurface()
  const counter = new CountingRenderable(surface.renderContext, { width: 5, height: 1 })
  const text = new TextRenderable(surface.renderContext, { content: "hello", width: 5, height: 1 })
  counter.add(text)
  surface.root.add(counter)
  surface.render()
  assert.equal(counter.renderCount, 1)
  surface.commitRows(0, surface.height)
  assert.equal(counter.renderCount, 1)
  text.content = "later"
  surface.render()
  surface.destroy()
  const commits = renderer.externalOutputQueue.claim()
  try {
    assert.equal(commits.length, 1)
    assert.match(new TextDecoder().decode(commits[0].snapshot.getRealCharBytes(true)), /hello/)
    assert.match(externalOutput.takeText(), /hello/)
  } finally { for (const commit of commits) commit.snapshot.destroy() }
})

for (const streaming of [false, true]) test(`settle waits for ${streaming ? "queued streaming" : "initial"} highlighting`, async () => {
  const { renderer, externalOutput } = await setup()
  const surface = renderer.createScrollbackSurface()
  const treeSitterClient = client()
  const syntaxStyle = style()
  try {
    const calls = []
    const highlight = treeSitterClient.highlightOnce.bind(treeSitterClient)
    treeSitterClient.highlightOnce = (content, filetype) => { calls.push(content); return highlight(content, filetype) }
    const code = new CodeRenderable(surface.renderContext, { content: "const x = 1", filetype: "typescript",
      syntaxStyle, treeSitterClient, drawUnstyledText: false, streaming, width: "100%" })
    surface.root.add(code)
    surface.render()
    if (streaming) code.content = "latest"
    const settling = surface.settle()
    assert.equal(code.isHighlighting, true)
    treeSitterClient.resolveAllHighlightOnce()
    await new Promise(resolve => setImmediate(resolve))
    if (streaming) {
      assert.deepEqual(calls, ["const x = 1", "latest"])
      treeSitterClient.resolveAllHighlightOnce()
    }
    await settling
    assert.equal(code.isHighlighting, false)
    surface.commitRows(code.y, code.y + code.height)
    assert.match(externalOutput.takeText(), streaming ? /latest/ : /const x = 1/)
  } finally { surface.destroy(); syntaxStyle.destroy() }
})

for (const custom of [false, true]) test(`Markdown stable blocks preserve ${custom ? "custom node margins" : "row boundaries"}`, async () => {
  const { renderer, externalOutput } = await setup()
  const surface = renderer.createScrollbackSurface()
  const syntaxStyle = style()
  try {
    const md = new MarkdownRenderable(surface.renderContext, { content: "# Title\n\nPara 1\n\n",
      syntaxStyle, streaming: true, internalBlockMode: "top-level", treeSitterClient: client({ autoResolveTimeout: 0 }),
      ...(custom ? { renderNode: (node, ctx) => node.type === "heading"
        ? new TextRenderable(surface.renderContext, { content: "CUSTOM", width: "100%" }) : ctx.defaultRender() } : {}),
    })
    surface.root.add(md)
    await surface.settle()
    md.content += "Para 2"
    await surface.settle()
    assert.equal(md._stableBlockCount, 1)
    const block = md._blockStates[0].renderable
    const end = md._blockStates[1].renderable.y
    surface.commitRows(block.y, end, { trailingNewline: false })
    const [commit] = externalOutput.take()
    assert.equal(commit.height, end - block.y)
    assert.match(commit.text, custom ? /CUSTOM/ : /Title/)
    assert.doesNotMatch(commit.text, /Para 1/)
  } finally { surface.destroy(); syntaxStyle.destroy() }
})

test("inline first-line offset survives Markdown block replacement", async () => {
  const { renderer, renderOnce } = await setup({ width: 10 })
  renderer.writeToScrollback(({ renderContext }) => ({ root: new TextRenderable(renderContext,
    { content: "12345", width: 5, height: 1 }), startOnNewLine: false, trailingNewline: false }))
  await renderOnce()
  const surface = renderer.createScrollbackSurface({ startOnNewLine: false })
  const syntaxStyle = style()
  try {
    const md = new MarkdownRenderable(surface.renderContext, { content: "abcdef", syntaxStyle,
      streaming: true, internalBlockMode: "top-level", treeSitterClient: client({ autoResolveTimeout: 0 }) })
    surface.root.add(md)
    await surface.settle()
    const initial = md._blockStates[0].renderable
    assert.equal(initial.height, 2)
    md.content = "# abcdef"
    await surface.settle()
    assert.notEqual(md._blockStates[0].renderable, initial)
    assert.equal(md._blockStates[0].renderable.height, 2)
  } finally { surface.destroy(); syntaxStyle.destroy() }
})

test("inline text wraps at the remaining first-line width", async () => {
  const { renderer, renderOnce, externalOutput } = await setup({ width: 10 })
  renderer.writeToScrollback(({ renderContext }) => ({ root: new TextRenderable(renderContext,
    { content: "12345", width: 5, height: 1 }), startOnNewLine: false, trailingNewline: false }))
  await renderOnce()
  externalOutput.clear()
  const surface = renderer.createScrollbackSurface({ startOnNewLine: false })
  surface.root.add(new TextRenderable(surface.renderContext, { content: "abcdef", width: "100%", wrapMode: "char" }))
  surface.render()
  assert.equal(surface.height, 2)
  surface.commitRows(0, surface.height)
  const [commit] = externalOutput.take()
  assert.deepEqual(commit.rows, ["abcde", "f"])
  assert.equal(commit.startOnNewLine, false)
})

test("default commits close rows; tall snapshots use their resolved height", async () => {
  const { renderer, externalOutput } = await setup({ width: 20, height: 6 })
  const surface = renderer.createScrollbackSurface()
  surface.root.add(new TextRenderable(surface.renderContext, { content: "closed-row", width: "100%" }))
  surface.render()
  surface.commitRows(0, 1)
  renderer.writeToScrollback(({ renderContext, tailColumn }) => {
    assert.equal(tailColumn, 0)
    return { root: new TextRenderable(renderContext, { position: "absolute", left: 0, top: 0,
      width: 1, height: "100%", content: "1\n2\n3\n4\n5\n6\n7\n8" }), width: 1, height: 8 }
  })
  const commits = externalOutput.take()
  assert.equal(commits[0].trailingNewline, true)
  assert.deepEqual(commits[1].rows, ["1", "2", "3", "4", "5", "6", "7", "8"])
  assert.ok(commits[1].height > renderer.height)
})

for (const change of ["resize", "width method"]) test(`reject stale geometry after ${change}`, async () => {
  const result = await setup({ width: 40 })
  const surface = result.renderer.createScrollbackSurface()
  surface.root.add(new TextRenderable(surface.renderContext, { content: "resize me", width: "100%" }))
  surface.render()
  if (change === "resize") result.resize(60, 16)
  else setRendererCapabilities(result.renderer, { unicode: "wcwidth" })
  assert.throws(() => surface.commitRows(0, surface.height), /after renderer geometry changes/)
  surface.render()
  surface.commitRows(0, surface.height)
  assert.equal(result.externalOutput.take()[0].width, result.renderer.width)
})

test("row bounds, empty commits, and destruction are guarded", async () => {
  const { renderer, externalOutput } = await setup()
  const surface = renderer.createScrollbackSurface()
  assert.throws(() => surface.commitRows(0, 1), /requires render/)
  surface.render()
  for (const range of [[-1, 1], [0, 2], [1, 0], [0, NaN], [0.5, 1]]) {
    assert.throws(() => surface.commitRows(...range))
  }
  surface.commitRows(0, 0)
  assert.deepEqual(externalOutput.take(), [])
  renderer.destroy()
  assert.equal(surface.isDestroyed, true)
  surface.destroy()
  assert.throws(() => surface.render(), /destroyed/)
  assert.throws(() => surface.commitRows(0, 1), /destroyed/)
})

test("settle ignores removed code and rejects promptly when the surface is destroyed", async () => {
  const { renderer } = await setup()
  const surface = renderer.createScrollbackSurface()
  const treeSitterClient = client()
  const syntaxStyle = style()
  try {
    const code = new CodeRenderable(surface.renderContext, { content: "const pending = true", filetype: "typescript",
      syntaxStyle, treeSitterClient, width: "100%" })
    surface.root.add(code)
    surface.render()
    assert.equal(code.isHighlighting, true)
    surface.root.remove(code.id)
    await surface.settle(0)
    assert.equal(code.isDestroyed, false)
    surface.root.add(code)
    const settling = surface.settle(10_000)
    surface.destroy()
    await assert.rejects(Promise.race([settling, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("destruction did not cancel settlement")), 100)
      timer.unref()
    })]), /ScrollbackSurface is destroyed/)
    treeSitterClient.resolveAllHighlightOnce()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(code.isDestroyed, true)
  } finally { surface.destroy(); syntaxStyle.destroy() }
})
