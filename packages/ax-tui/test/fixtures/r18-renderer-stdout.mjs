import assert from "node:assert/strict"
import { test } from "node:test"
import { CliRenderEvents } from "@defai-digital/ax-tui"
import { setup, terminal, RecordingStdout } from "./split-footer-support.mjs"

test("a tab after a full-width row wraps and keeps its tab-stop indentation", async () => {
  const stdout = new RecordingStdout(9, 10)
  const { renderer } = await setup({ width: 9, stdout })
  const written = []
  renderer.on(CliRenderEvents.EXTERNAL_OUTPUT, ({ snapshot, rowColumns, trailingNewline }) => {
    const row = new TextDecoder().decode(snapshot.getRealCharBytes(true)).trimEnd()
    written.push(`${row}:${rowColumns}${trailingNewline ? "\n" : ""}`)
  })
  stdout.write("x".repeat(9) + "\tY\n")
  assert.deepEqual(written, ["xxxxxxxxx:9", "        Y:9\n"])
})

test("destroy flushes writes made while suspended as text, not snapshot placeholders", async () => {
  const { renderer, stdout } = await terminal()
  renderer.suspend()
  stdout.write("during suspend 0\nduring suspend 1\n")
  const feed = renderer._feed
  renderer.destroy()
  await feed?.idle()
  const text = stdout.text()
  assert.ok(text.includes("during suspend 0"))
  assert.ok(text.includes("during suspend 1"))
  assert.ok(!text.includes("[snapshot"))
})
