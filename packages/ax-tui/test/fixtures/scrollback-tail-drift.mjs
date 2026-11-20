import assert from "node:assert/strict"
import { test } from "node:test"
import { TextRenderable } from "@defai-digital/ax-tui"
import { setup, RecordingStdout } from "./split-footer-support.mjs"

test("commitRows rejects a surface whose pending tail drifted via stdout", async () => {
  const stdout = new RecordingStdout(10, 10)
  const { renderer, renderOnce, externalOutput } = await setup({ width: 10, stdout })
  renderer.writeToScrollback(({ renderContext }) => ({ root: new TextRenderable(renderContext,
    { content: "12345", width: 5, height: 1 }), startOnNewLine: false, trailingNewline: false }))
  await renderOnce()
  externalOutput.clear()
  const surface = renderer.createScrollbackSurface({ startOnNewLine: false })
  surface.root.add(new TextRenderable(surface.renderContext, { content: "abcdef", width: "100%", wrapMode: "char" }))
  surface.render()
  surface.commitRows(0, surface.height)
  assert.deepEqual(externalOutput.take()[0].rows, ["abcde", "f"])

  // Intervening captured stdout moves the pending tail column; the surface's
  // inline assumption is stale and committing would misplace its first row.
  stdout.write("xy")
  surface.render()
  assert.throws(() => surface.commitRows(0, surface.height), /intervening output changes the pending tail column/)

  // The intervening stdout stays queued ahead of any later surface commit.
  const [intervening] = externalOutput.take()
  assert.deepEqual(intervening.rows, ["xy"])

  // A fresh surface re-baselines on the drifted tail and commits again.
  const fresh = renderer.createScrollbackSurface({ startOnNewLine: false })
  fresh.root.add(new TextRenderable(fresh.renderContext, { content: "Z", width: "100%" }))
  fresh.render()
  fresh.commitRows(0, fresh.height)
  const [commit] = externalOutput.take()
  assert.deepEqual(commit.rows, ["Z"])
  assert.equal(commit.startOnNewLine, false)
  fresh.destroy()
  surface.destroy()
})