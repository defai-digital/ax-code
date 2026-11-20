import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression drivers for renderable lifecycle fixes. Each scenario runs in a
// Node child process with FFI enabled because the renderer needs native buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

const PREAMBLE = `
import assert from "node:assert/strict"
import { createTestRenderer, MockTreeSitterClient } from "@defai-digital/ax-tui/testing"
import {
  ASCIIFontRenderable,
  BoxRenderable,
  CodeRenderable,
  OptimizedBuffer,
  StyledText,
  SyntaxStyle,
  TextNodeRenderable,
  TextRenderable,
  h,
} from "@defai-digital/ax-tui"
`

test.skipIf(!supportsFfi)("code clears the highlighting flag when a stale highlight resolves", () => {
  runDriver(`
${PREAMBLE}
const treeSitterClient = new MockTreeSitterClient()
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const code = new CodeRenderable(setup.renderer, {
    content: "abc",
    filetype: "markdown",
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
  })
  setup.renderer.root.add(code)
  await setup.renderOnce()
  assert.equal(code.isHighlighting, true)

  // Empty content invalidates the in-flight snapshot without starting a new
  // highlight; the stale resolve must still clear the flag.
  code.content = ""
  await setup.renderOnce()
  treeSitterClient.resolveAllHighlightOnce()
  await code.highlightingDone
  await setup.renderOnce()
  assert.equal(code.isHighlighting, false)
  assert.equal(code.isHighlightPending, false)
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("code-stale-highlight-flag ok")
`)
})

test.skipIf(!supportsFfi)("code does not reapply initialStyledText after content changes", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const code = new CodeRenderable(setup.renderer, {
    content: "AAAA",
    syntaxStyle: SyntaxStyle.create(),
    drawUnstyledText: true,
    initialStyledText: new StyledText([{ __isChunk: true, text: "AAAA" }]),
  })
  setup.renderer.root.add(code)
  await setup.renderOnce()
  assert.ok(setup.captureCharFrame().includes("AAAA"))

  code.content = "BBBB"
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  assert.ok(frame.includes("BBBB"), frame)
  assert.ok(!frame.includes("AAAA"), frame)
} finally {
  setup.renderer.destroy()
}
console.log("code-initial-styled-text ok")
`)
})

test.skipIf(!supportsFfi)("ascii font keeps a 1x1 floor for empty text", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  // The reported width is floored at 1, so the layout width must match it or
  // the next sibling slides into the cell the font still claims.
  const row = new BoxRenderable(setup.renderer, { flexDirection: "row" })
  const font = new ASCIIFontRenderable(setup.renderer, { text: "HI", font: "tiny" })
  const sibling = new BoxRenderable(setup.renderer, { width: 3, height: 1 })
  row.add(font)
  row.add(sibling)
  setup.renderer.root.add(row)
  await setup.renderOnce()
  assert.equal(sibling.x, font.width)

  font.text = ""
  await setup.renderOnce()
  assert.equal(font.width, 1)
  assert.ok(font.height >= 1)
  assert.equal(sibling.x, 1)

  font.text = "AB"
  await setup.renderOnce()
  assert.ok(font.width > 1)
  assert.equal(sibling.x, font.width)
  font.destroy()
} finally {
  setup.renderer.destroy()
}
console.log("ascii-font-empty ok")
`)
})

test.skipIf(!supportsFfi)("destroyed text buffer renderables skip rendering", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const code = new CodeRenderable(setup.renderer, { content: "hello", syntaxStyle: SyntaxStyle.create() })
  setup.renderer.root.add(code)
  await setup.renderOnce()
  code.destroy()

  const buffer = OptimizedBuffer.create(10, 3, "unicode")
  try {
    assert.doesNotThrow(() => code.render(buffer, 0))
  } finally {
    buffer.destroy()
  }
} finally {
  setup.renderer.destroy()
}
console.log("destroyed-render ok")
`)
})

test.skipIf(!supportsFfi)("text node children setter and text destroy detach parents", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const text = new TextRenderable(setup.renderer, { content: "hi" })
  const first = new TextNodeRenderable({})
  const second = new TextNodeRenderable({})
  text.textNode.add(first)
  assert.equal(first.parent, text.textNode)

  text.textNode.children = [second]
  assert.equal(first.parent, null)
  assert.equal(second.parent, text.textNode)

  text.destroy()
  assert.equal(second.parent, null)
} finally {
  setup.renderer.destroy()
}
console.log("text-node-parents ok")
`)
})

test.skipIf(!supportsFfi)("code rehighlights when filetype changes while a highlight is pending", () => {
  runDriver(`
${PREAMBLE}
class TrackingClient extends MockTreeSitterClient {
  calls = []
  async highlightOnce(content, filetype) {
    this.calls.push(filetype)
    return super.highlightOnce(content, filetype)
  }
}
const treeSitterClient = new TrackingClient()
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const code = new CodeRenderable(setup.renderer, {
    content: "abc",
    filetype: "markdown",
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
  })
  setup.renderer.root.add(code)
  await setup.renderOnce()
  assert.equal(code.isHighlighting, true)
  assert.deepEqual(treeSitterClient.calls, ["markdown"])

  // Changing an option must invalidate the in-flight snapshot so the stale
  // resolve schedules a fresh highlight with the new filetype.
  code.filetype = "python"
  treeSitterClient.resolveAllHighlightOnce()
  await code.highlightingDone
  await setup.renderOnce()
  assert.deepEqual(treeSitterClient.calls, ["markdown", "python"])

  treeSitterClient.resolveAllHighlightOnce()
  await code.highlightingDone
  await setup.renderOnce()
  assert.equal(code.isHighlighting, false)
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("code-filetype-rehighlight ok")
`)
})

test.skipIf(!supportsFfi)("vnode method chaining returns the proxy", () => {
  runDriver(`
${PREAMBLE}
const vnode = h(BoxRenderable, {})
const chained = vnode.focus().blur()
assert.equal(chained, vnode)
assert.deepEqual(
  vnode.__pendingCalls.map(call => call.method),
  ["focus", "blur"],
)
console.log("vnode-chaining ok")
`)
})
test.skipIf(!supportsFfi)("select scrolls to the initial selectedIndex with fixed numeric height", () => {
  runDriver(`
${PREAMBLE}
import { SelectRenderable } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 40, height: 12 })
try {
  const options = Array.from({ length: 20 }, (_, i) => ({ name: \`item-\${String(i).padStart(2, "0")}\`, description: "" }))
  const select = new SelectRenderable(setup.renderer, {
    width: 40,
    height: 10,
    options,
    selectedIndex: 15,
    showDescription: false,
  })
  setup.renderer.root.add(select)
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  assert.ok(frame.includes("item-15"), frame)
  assert.ok(!frame.includes("item-00"), frame)
} finally {
  setup.renderer.destroy()
}
console.log("select-initial-scroll ok")
`)
})

test.skipIf(!supportsFfi)("box honors explicit border false alongside border styling options", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 20, height: 6 })
try {
  const box = new BoxRenderable(setup.renderer, { width: 10, height: 5, border: false, borderColor: "#ff0000" })
  setup.renderer.root.add(box)
  await setup.renderOnce()
  assert.equal(box.border, false)
  assert.ok(!setup.captureCharFrame().includes("┌"), setup.captureCharFrame())

  // Omitting border entirely still auto-enables it when styling is supplied.
  const auto = new BoxRenderable(setup.renderer, { width: 10, height: 5, borderColor: "#ff0000" })
  assert.equal(auto.border, true)
} finally {
  setup.renderer.destroy()
}
console.log("box-explicit-border-false ok")
`)
})

test.skipIf(!supportsFfi)("time-to-first-draw clamps precision into the valid toFixed range", () => {
  runDriver(`
${PREAMBLE}
import { TimeToFirstDrawRenderable } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 40, height: 3 })
try {
  const timer = new TimeToFirstDrawRenderable(setup.renderer, { precision: 101 })
  setup.renderer.root.add(timer)
  await setup.renderOnce()
  assert.ok(setup.captureCharFrame().includes("Time to first draw"), setup.captureCharFrame())
  timer.decimals = 101
  await setup.renderOnce()
  timer.decimals = -5
  timer.textLabel = "ttfd"
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  assert.ok(frame.includes("ttfd:"), frame)
  assert.ok(frame.includes("ms"), frame)
} finally {
  setup.renderer.destroy()
}
console.log("ttfd-precision-clamp ok")
`)
})

test.skipIf(!supportsFfi)("time-to-first-draw centers wide-character labels by display width", () => {
  runDriver(`
${PREAMBLE}
import { TimeToFirstDrawRenderable } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 40, height: 3 })
try {
  const timer = new TimeToFirstDrawRenderable(setup.renderer, { label: "時間", precision: 2 })
  setup.renderer.root.add(timer)
  await setup.renderOnce()
  const row = setup.captureCharFrame().split("\\n").find((r) => r.includes("時"))
  assert.ok(row, "label row missing")
  const start = row.indexOf("時")
  const text = row.slice(start).trimEnd()
  const displayWidth = text.length + 2
  assert.equal(start, Math.floor((40 - displayWidth) / 2), JSON.stringify({ row, start, displayWidth }))
} finally {
  setup.renderer.destroy()
}
console.log("ttfd-cjk-centering ok")
`)
})

test.skipIf(!supportsFfi)("box border setters keep explicit border false and apply custom border chars", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 20, height: 20 })
try {
  const explicit = new BoxRenderable(setup.renderer, { width: 10, height: 5, border: false, borderColor: "#ff0000" })
  const toggled = new BoxRenderable(setup.renderer, { width: 10, height: 5 })
  const custom = new BoxRenderable(setup.renderer, { width: 10, height: 5 })
  setup.renderer.root.add(explicit)
  setup.renderer.root.add(toggled)
  setup.renderer.root.add(custom)
  await setup.renderOnce()

  explicit.borderColor = "#00ff00"
  await setup.renderOnce()
  assert.equal(explicit.border, false)

  toggled.border = false
  toggled.borderColor = "#00ff00"
  await setup.renderOnce()
  assert.equal(toggled.border, false)

  custom.customBorderChars = {
    topLeft: "1", topRight: "2", bottomLeft: "3", bottomRight: "4",
    horizontal: "5", vertical: "6", topT: "7", bottomT: "8", leftT: "9", rightT: "0", cross: "x",
  }
  await setup.renderOnce()
  assert.equal(custom.border, true)
  const frame = setup.captureCharFrame()
  assert.ok(!frame.includes("┌"), frame)
  assert.ok(frame.includes("1"), frame)
  assert.ok(frame.includes("5"), frame)
} finally {
  setup.renderer.destroy()
}
console.log("box-border-setters ok")
`)
})

test.skipIf(!supportsFfi)("select with height one renders its selected item instead of nothing", () => {
  runDriver(`
${PREAMBLE}
import { SelectRenderable } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 40, height: 5 })
try {
  const select = new SelectRenderable(setup.renderer, {
    width: 40,
    height: 1,
    showDescription: true,
    options: [{ name: "only-item", description: "desc" }],
  })
  setup.renderer.root.add(select)
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  assert.ok(frame.includes("only-item"), frame)
  assert.ok(!frame.includes("desc"), frame)
} finally {
  setup.renderer.destroy()
}
console.log("select-height-one ok")
`)
})

test.skipIf(!supportsFfi)("test recorder captures attribute buffers as Uint32Array", () => {
  runDriver(`
${PREAMBLE}
import { TestRecorder } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const recorder = new TestRecorder(setup.renderer, { recordBuffers: { attributes: true } })
  const text = new TextRenderable(setup.renderer, { width: 20, height: 3 })
  const linked = new TextNodeRenderable({ link: { url: "https://example.com" } })
  linked.add("link text")
  text.add(linked)
  setup.renderer.root.add(text)
  recorder.rec()
  await setup.renderOnce()
  recorder.stop()
  const frames = recorder.recordedFrames
  assert.ok(frames.length > 0, "no frames recorded")
  const attributes = frames[frames.length - 1].buffers.attributes
  assert.ok(attributes instanceof Uint32Array, "attributes buffer type: " + Object.prototype.toString.call(attributes))
  assert.equal(attributes.length, 100)
  assert.ok([...attributes].some((v) => v > 255), "no wide attribute values captured")
} finally {
  setup.renderer.destroy()
}
console.log("recorder-attributes ok")
`)
})

test.skipIf(!supportsFfi)("native span feed handler errors surface asynchronously, not into the native callback", () => {
  runDriver(`
${PREAMBLE}
import { NativeSpanFeed } from "@defai-digital/ax-tui"
let caught = null
const onUncaught = (err) => { caught = err }
process.on("uncaughtException", onUncaught)
const feed = NativeSpanFeed.create()
try {
  feed.onError(() => { throw new Error("handler boom") })
  let syncThrow = null
  try {
    feed.eventHandler(6, 7, 0)
  } catch (err) {
    syncThrow = err
  }
  assert.equal(syncThrow, null, "handler error escaped synchronously into the native callback")
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.ok(caught, "handler error never surfaced")
  assert.equal(caught.message, "handler boom")
} finally {
  feed.close()
  process.off("uncaughtException", onUncaught)
}
console.log("span-feed-handler-error ok")
`)
})


test.skipIf(!supportsFfi)("slider clamps constructor value and viewport and re-clamps when the range shrinks", () => {
  runDriver(`
${PREAMBLE}
import { SliderRenderable } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 20, height: 6 })
try {
  const over = new SliderRenderable(setup.renderer, {
    orientation: "horizontal",
    width: 10,
    height: 1,
    min: 0,
    max: 10,
    value: 50,
    viewPortSize: 50,
  })
  assert.equal(over.value, 10)
  assert.equal(over.viewPortSize, 10)
  const under = new SliderRenderable(setup.renderer, {
    orientation: "horizontal",
    width: 10,
    height: 1,
    min: 5,
    max: 10,
    value: -3,
  })
  assert.equal(under.value, 5)
  const nan = new SliderRenderable(setup.renderer, {
    orientation: "horizontal",
    width: 10,
    height: 1,
    min: 2,
    max: 8,
    value: NaN,
  })
  assert.equal(nan.value, 2)
  const ranged = new SliderRenderable(setup.renderer, {
    orientation: "horizontal",
    width: 10,
    height: 1,
    min: 0,
    max: 10,
    value: 5,
    viewPortSize: 5,
  })
  ranged.min = 6
  assert.equal(ranged.value, 6)
  assert.equal(ranged.viewPortSize, 4)
  setup.renderer.root.add(over)
  setup.renderer.root.add(under)
  setup.renderer.root.add(nan)
  setup.renderer.root.add(ranged)
  await setup.renderOnce()
} finally {
  setup.renderer.destroy()
}
console.log("slider-clamp ok")
`)
})

test.skipIf(!supportsFfi)("box reassigning the same border style still clears custom border characters", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 12, height: 6 })
try {
  const box = new BoxRenderable(setup.renderer, { width: 10, height: 5, border: true })
  setup.renderer.root.add(box)
  const chars = {
    topLeft: "A",
    topRight: "B",
    bottomLeft: "C",
    bottomRight: "D",
    horizontal: "-",
    vertical: "|",
    topT: "T",
    bottomT: "U",
    leftT: "L",
    rightT: "R",
    cross: "+",
  }
  box.customBorderChars = chars
  assert.equal(box.customBorderChars, chars)
  await setup.renderOnce()
  assert.ok(setup.captureCharFrame().includes("A"))
  box.borderStyle = "single"
  assert.equal(box.customBorderChars, undefined)
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  assert.ok(frame.includes("┌"), frame)
  assert.ok(!frame.includes("A"), frame)
} finally {
  setup.renderer.destroy()
}
console.log("box-border-style-reset ok")
`)
})

test.skipIf(!supportsFfi)("select scroll indicator stays inside a one-line viewport", () => {
  runDriver(`
${PREAMBLE}
import { SelectRenderable } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 12, height: 2 })
try {
  const select = new SelectRenderable(setup.renderer, {
    width: 12,
    height: 1,
    options: [
      { name: "aa", description: "" },
      { name: "bb", description: "" },
      { name: "cc", description: "" },
    ],
    selectedIndex: 2,
    showScrollIndicator: true,
    showDescription: false,
  })
  setup.renderer.root.add(select)
  await setup.renderOnce()
  assert.ok(setup.captureCharFrame().includes("█"), setup.captureCharFrame())
  select.height = 2
  await setup.renderOnce()
  assert.ok(setup.captureCharFrame().includes("█"), setup.captureCharFrame())
} finally {
  setup.renderer.destroy()
}
console.log("select-indicator ok")
`)
})

test.skipIf(!supportsFfi)("static position survives renderable and yoga validation", () => {
  runDriver(`
${PREAMBLE}
import { parsePositionType } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 20, height: 6 })
try {
  const stat = new BoxRenderable(setup.renderer, {
    width: 4,
    height: 2,
    border: false,
    position: "static",
    left: 5,
    top: 2,
  })
  const rel = new BoxRenderable(setup.renderer, { width: 4, height: 2, position: "relative", left: 5 })
  setup.renderer.root.add(stat)
  setup.renderer.root.add(rel)
  await setup.renderOnce()
  assert.equal(stat["_positionType"], "static")
  assert.equal(stat.screenX, 0)
  assert.equal(stat.screenY, 0)
  assert.equal(rel.screenX, 5)
  stat.position = "relative"
  stat.position = "static"
  assert.equal(stat["_positionType"], "static")
  assert.notEqual(parsePositionType("static"), parsePositionType("relative"))
  assert.equal(parsePositionType("garbage"), parsePositionType("relative"))
  assert.equal(parsePositionType(null), parsePositionType("relative"))
} finally {
  setup.renderer.destroy()
}
console.log("static-position ok")
`)
})

test.skipIf(!supportsFfi)("native span feed error dispatch uses a listener snapshot", () => {
  runDriver(`
${PREAMBLE}
import { NativeSpanFeed } from "@defai-digital/ax-tui"
const feed = NativeSpanFeed.create()
try {
  const seen = []
  feed.onError((code) => {
    seen.push("first:" + code)
    feed.onError((c) => seen.push("second:" + c))
  })
  feed.eventHandler(6, 7, 0)
  assert.deepEqual(seen, ["first:7"])
  feed.eventHandler(6, 8, 0)
  assert.deepEqual(seen, ["first:7", "first:8", "second:8"])
} finally {
  feed.close()
}
console.log("span-feed-error-snapshot ok")
`)
})

test.skipIf(!supportsFfi)("native span feed data dispatch uses a listener snapshot", () => {
  runDriver(`
${PREAMBLE}
import { NativeSpanFeed, resolveRenderLib } from "@defai-digital/ax-tui"
const feed = NativeSpanFeed.create()
try {
  const seen = []
  feed.onData(() => {
    seen.push("first")
    feed.onData(() => seen.push("second"))
  })
  const lib = resolveRenderLib()
  lib.streamWrite(feed.streamPtr, "hello")
  lib.streamCommit(feed.streamPtr)
  await feed.idle()
  assert.deepEqual(seen, ["first"])
  lib.streamWrite(feed.streamPtr, "world")
  lib.streamCommit(feed.streamPtr)
  await feed.idle()
  assert.deepEqual(seen, ["first", "first", "second"])
} finally {
  feed.close()
}
console.log("span-feed-data-snapshot ok")
`)
})

test.skipIf(!supportsFfi)("slot constructor failure does not leak a renderable registration", () => {
  runDriver(`
${PREAMBLE}
import { Renderable, SlotRenderable, createCoreSlotRegistry } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const registry = createCoreSlotRegistry(setup.renderer, {})
  const before = Renderable.renderablesByNumber.size
  let threw = false
  try {
    new SlotRenderable(setup.renderer, {
      registry,
      name: "probe",
      fallback: () => {
        throw new Error("fallback boom")
      },
    })
  } catch {
    threw = true
  }
  assert.equal(threw, true)
  assert.equal(Renderable.renderablesByNumber.size, before)
} finally {
  setup.renderer.destroy()
}
console.log("slot-ctor-leak ok")
`)
})

test.skipIf(!supportsFfi)("forwardEnvKeys skips prototype-named keys instead of forwarding functions", () => {
  runDriver(`
${PREAMBLE}
import { resolveRenderLib } from "@defai-digital/ax-tui"
const lib = resolveRenderLib()
const original = lib.setTerminalEnvVar
const hadOwn = Object.hasOwn(lib, "setTerminalEnvVar")
const forwarded = []
lib.setTerminalEnvVar = (ptr, key, value) => {
  forwarded.push([key, value])
  return original.call(lib, ptr, key, value)
}
process.env.AX_TUI_TEST_FORWARDED = "yes"
try {
  const setup = await createTestRenderer({
    width: 20,
    height: 5,
    forwardEnvKeys: ["toString", "hasOwnProperty", "AX_TUI_TEST_FORWARDED"],
  })
  setup.renderer.destroy()
  assert.deepEqual(forwarded, [["AX_TUI_TEST_FORWARDED", "yes"]])
} finally {
  if (hadOwn) lib.setTerminalEnvVar = original
  else delete lib.setTerminalEnvVar
  delete process.env.AX_TUI_TEST_FORWARDED
}
console.log("forward-env-prototype ok")
`)
})


test.skipIf(!supportsFfi)("code option setters schedule a render on an idle renderer", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const code = new CodeRenderable(setup.renderer, { content: "abc", drawUnstyledText: true })
  setup.renderer.root.add(code)
  const settle = async () => {
    for (let i = 0; i < 50; i++) {
      await setup.renderOnce()
      await setup.waitForVisualIdle()
      if (!setup.renderer.getSchedulerState().hasScheduledRender) return
    }
    throw new Error("renderer never became idle")
  }
  await settle()
  const mutations = [
    () => { code.conceal = false },
    () => { code.syntaxStyle = SyntaxStyle.create() },
    () => { code.baseHighlight = "comment" },
    () => { code.drawUnstyledText = false },
    () => { code.streaming = true },
    () => { code.onHighlight = () => {} },
    () => { code.onChunks = () => {} },
  ]
  for (const mutate of mutations) {
    assert.equal(setup.renderer.getSchedulerState().hasScheduledRender, false)
    mutate()
    assert.equal(setup.renderer.getSchedulerState().hasScheduledRender, true, "setter did not schedule a render")
    await settle()
  }
} finally {
  setup.renderer.destroy()
}
console.log("code-setter-render ok")
`)
})

test.skipIf(!supportsFfi)("code streaming empty replacement clears the buffer", () => {
  runDriver(`
${PREAMBLE}
const treeSitterClient = new MockTreeSitterClient()
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const code = new CodeRenderable(setup.renderer, {
    content: "abc",
    filetype: "markdown",
    streaming: true,
    drawUnstyledText: false,
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
  })
  setup.renderer.root.add(code)
  await setup.renderOnce()
  code.content = ""
  assert.equal(code.plainText, "")
  await setup.renderOnce()
  treeSitterClient.resolveAllHighlightOnce()
  await code.highlightingDone
  await setup.renderOnce()
  assert.equal(code.plainText, "")
  assert.ok(!setup.captureCharFrame().includes("abc"))
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("code-streaming-clear ok")
`)
})

test.skipIf(!supportsFfi)("code filetype drop surfaces the latest streamed content", () => {
  runDriver(`
${PREAMBLE}
const treeSitterClient = new MockTreeSitterClient()
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const code = new CodeRenderable(setup.renderer, {
    content: "aaa",
    filetype: "markdown",
    streaming: true,
    drawUnstyledText: false,
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
  })
  setup.renderer.root.add(code)
  await setup.renderOnce()
  code.content = "bbb"
  code.filetype = undefined
  await setup.renderOnce()
  assert.equal(code.plainText, "bbb")
  assert.ok(setup.captureCharFrame().includes("bbb"))
  treeSitterClient.resolveAllHighlightOnce()
  await code.highlightingDone
  await setup.renderOnce()
  assert.equal(code.plainText, "bbb")
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("code-filetype-drop ok")
`)
})

test.skipIf(!supportsFfi)("text clear re-enables child node rendering", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const text = new TextRenderable(setup.renderer, { content: "manual", width: 20, height: 3 })
  setup.renderer.root.add(text)
  await setup.renderOnce()
  assert.ok(setup.captureCharFrame().includes("manual"))
  text.clear()
  await setup.renderOnce()
  const child = new TextNodeRenderable({})
  child.add("child-text")
  text.add(child)
  await setup.renderOnce()
  assert.ok(setup.captureCharFrame().includes("child-text"))
} finally {
  setup.renderer.destroy()
}
console.log("text-clear-children ok")
`)
})

test.skipIf(!supportsFfi)("slot constructor failure after onActivate still runs onDeactivate", () => {
  runDriver(`
${PREAMBLE}
import { SlotRenderable, createCoreSlotRegistry, registerCorePlugin } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const registry = createCoreSlotRegistry(setup.renderer, {})
  const calls = []
  registerCorePlugin(registry, {
    id: "probe-plugin",
    slots: {
      probe: {
        render: () => new TextRenderable(setup.renderer, { content: "plugin" }),
        onActivate: () => calls.push("activate"),
        onDeactivate: () => calls.push("deactivate"),
      },
    },
  })
  let threw = false
  try {
    new SlotRenderable(setup.renderer, {
      registry,
      name: "probe",
      fallback: () => {
        throw new Error("fallback boom")
      },
    })
  } catch {
    threw = true
  }
  assert.equal(threw, true)
  assert.deepEqual(calls, ["activate", "deactivate"])
} finally {
  setup.renderer.destroy()
}
console.log("slot-ctor-cleanup ok")
`)
})

test.skipIf(!supportsFfi)("native span feed error handler throw does not block remaining handlers", () => {
  runDriver(`
${PREAMBLE}
import { NativeSpanFeed } from "@defai-digital/ax-tui"
let caught = null
const onUncaught = (err) => { caught = err }
process.on("uncaughtException", onUncaught)
const feed = NativeSpanFeed.create()
try {
  const seen = []
  feed.onError((code) => {
    seen.push("first:" + code)
    throw new Error("handler boom")
  })
  feed.onError((code) => seen.push("second:" + code))
  let syncThrow = null
  try {
    feed.eventHandler(6, 7, 0)
  } catch (err) {
    syncThrow = err
  }
  assert.equal(syncThrow, null)
  assert.deepEqual(seen, ["first:7", "second:7"])
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.ok(caught)
  assert.equal(caught.message, "handler boom")
} finally {
  feed.close()
  process.off("uncaughtException", onUncaught)
}
console.log("span-feed-error-throw ok")
`)
})

test.skipIf(!supportsFfi)("pushOpacity clamps NaN to zero", () => {
  runDriver(`
${PREAMBLE}
const buffer = OptimizedBuffer.create(10, 3, "unicode")
try {
  buffer.pushOpacity(NaN)
  assert.equal(buffer.getCurrentOpacity(), 0)
  buffer.popOpacity()
  buffer.pushOpacity(2)
  assert.equal(buffer.getCurrentOpacity(), 1)
  buffer.popOpacity()
  buffer.pushOpacity(0.5)
  assert.equal(buffer.getCurrentOpacity(), 0.5)
  buffer.popOpacity()
} finally {
  buffer.destroy()
}
console.log("push-opacity-nan ok")
`)
})

test.skipIf(!supportsFfi)("slot reactivates a plugin after a failed refresh deactivated it", () => {
  runDriver(`
${PREAMBLE}
import { SlotRenderable, createCoreSlotRegistry, registerCorePlugin } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const registry = createCoreSlotRegistry(setup.renderer, {})
  const calls = []
  const plugin = {
    id: "probe-plugin",
    slots: {
      probe: {
        render: () => new TextRenderable(setup.renderer, { content: "plugin" }),
        onActivate: () => calls.push("activate"),
        onDeactivate: () => calls.push("deactivate"),
      },
    },
  }
  const unregister = registerCorePlugin(registry, plugin)
  let fallbackCalls = 0
  const slot = new SlotRenderable(setup.renderer, {
    registry,
    name: "probe",
    mode: "single_winner",
    fallback: () => {
      fallbackCalls++
      throw new Error("fallback boom")
    },
  })
  setup.renderer.root.add(slot)
  assert.deepEqual(calls, ["activate"])

  // The registry swallows refresh listener errors, so the failed fallback
  // deactivates the plugin without throwing out of unregister().
  unregister()
  assert.equal(fallbackCalls, 1)
  assert.deepEqual(calls, ["activate", "deactivate"])

  // Re-registering must run onActivate again; a stale active-id entry used to
  // skip activation and leave the slot without a live plugin node.
  registerCorePlugin(registry, plugin)
  assert.deepEqual(calls, ["activate", "deactivate", "activate"])
} finally {
  setup.renderer.destroy()
}
console.log("slot-reactivate-after-failed-refresh ok")
`)
})

test.skipIf(!supportsFfi)("text no-op content assignment keeps child node rendering live", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const text = new TextRenderable(setup.renderer, { width: 20, height: 3 })
  setup.renderer.root.add(text)
  text.add("hello")
  await setup.renderOnce()
  assert.ok(setup.captureCharFrame().includes("hello"))

  text.content = text.content
  text.add(" world")
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  assert.ok(frame.includes("hello"), frame)
  assert.ok(frame.includes("world"), frame)
} finally {
  setup.renderer.destroy()
}
console.log("text-noop-content-children ok")
`)
})

test.skipIf(!supportsFfi)("native span feed surfaces falsy handler throws", () => {
  runDriver(`
${PREAMBLE}
import { NativeSpanFeed, resolveRenderLib } from "@defai-digital/ax-tui"
const sentinel = { sentinel: true }

for (const value of [0, "", false, null]) {
  const feed = NativeSpanFeed.create()
  let saw = false
  let captured = sentinel
  const onUncaught = (err) => {
    saw = true
    captured = err
  }
  process.on("uncaughtException", onUncaught)
  try {
    feed.onError(() => {
      throw value
    })
    let syncThrow = sentinel
    try {
      feed.eventHandler(6, 7, 0)
    } catch (err) {
      syncThrow = err
    }
    assert.equal(syncThrow, sentinel)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(saw, true, "falsy throw was dropped: " + String(value))
    assert.equal(captured, value)
  } finally {
    feed.close()
    process.off("uncaughtException", onUncaught)
  }
}

const dataFeed = NativeSpanFeed.create()
let dataSaw = false
let dataCaptured = sentinel
const onDataUncaught = (err) => {
  dataSaw = true
  dataCaptured = err
}
process.on("uncaughtException", onDataUncaught)
try {
  dataFeed.onData(() => {
    throw ""
  })
  const lib = resolveRenderLib()
  lib.streamWrite(dataFeed.streamPtr, "hello")
  lib.streamCommit(dataFeed.streamPtr)
  await dataFeed.idle()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(dataSaw, true, "data handler throw was dropped")
  assert.equal(dataCaptured, "")
} finally {
  dataFeed.close()
  process.off("uncaughtException", onDataUncaught)
}

const drainFeed = NativeSpanFeed.create()
try {
  drainFeed.onError(() => {
    throw null
  })
  drainFeed.eventHandler(6, 7, 0)
  let syncThrow = sentinel
  try {
    drainFeed.drainAll()
  } catch (err) {
    syncThrow = err
  }
  assert.equal(syncThrow, null, "drainAll dropped a thrown null")
  // The queued microtask must observe the consumed error and stay silent.
  await new Promise((resolve) => setTimeout(resolve, 20))
} finally {
  drainFeed.close()
}
console.log("span-feed-falsy-throws ok")
`)
})

test.skipIf(!supportsFfi)("text node replace rejects out-of-bounds indices", () => {
  runDriver(`
${PREAMBLE}
const node = new TextNodeRenderable({})
node.add("a")
node.add("b")
for (const index of [2, 5, -1, NaN, 1.5]) {
  assert.throws(() => node.replace("x", index), /out of bounds/)
  assert.equal(node._children.length, 2)
}
node.replace("c", 1)
assert.equal(node._children[1], "c")
assert.equal(node._children.length, 2)
console.log("text-node-replace-bounds ok")
`)
})

test.skipIf(!supportsFfi)("code clears the highlighting flag when destroyed mid-highlight", () => {
  runDriver(`
${PREAMBLE}
const treeSitterClient = new MockTreeSitterClient()
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const code = new CodeRenderable(setup.renderer, {
    content: "abc",
    filetype: "markdown",
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
  })
  setup.renderer.root.add(code)
  await setup.renderOnce()
  assert.equal(code.isHighlighting, true)

  code.destroy()
  treeSitterClient.resolveAllHighlightOnce()
  await code.highlightingDone
  assert.equal(code.isHighlighting, false)
  assert.equal(code.isHighlightPending, false)
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("code-destroy-highlight-flag ok")
`)
})

test.skipIf(!supportsFfi)("text value-equal content assignment keeps later child appends visible", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const text = new TextRenderable(setup.renderer, { width: 20, height: 3 })
  setup.renderer.root.add(text)
  text.add("hello")
  await setup.renderOnce()
  assert.ok(setup.captureCharFrame().includes("hello"))

  // Assigning a fresh string with the same value must not switch the text
  // into manual-content mode and hide later child appends.
  text.content = "hello"
  text.add(" world")
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  assert.ok(frame.includes("hello"), frame)
  assert.ok(frame.includes("world"), frame)

  text.content = "goodbye"
  await setup.renderOnce()
  const replaced = setup.captureCharFrame()
  assert.ok(replaced.includes("goodbye"), replaced)
  assert.ok(!replaced.includes("world"), replaced)
} finally {
  setup.renderer.destroy()
}
console.log("text-value-equal-content ok")
`)
})

test.skipIf(!supportsFfi)("slot destroy inside onDeactivate fires each lifecycle hook once", () => {
  runDriver(`
${PREAMBLE}
import { SlotRenderable, createCoreSlotRegistry, registerCorePlugin } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const registry = createCoreSlotRegistry(setup.renderer, {})
  const calls = []
  let slot
  const plugin = {
    id: "probe-plugin",
    slots: {
      probe: {
        render: () => new TextRenderable(setup.renderer, { content: "plugin" }),
        onActivate: () => calls.push("activate"),
        onDeactivate: () => {
          calls.push("deactivate")
          slot.destroy()
        },
        onDispose: () => calls.push("dispose"),
      },
    },
  }
  const unregister = registerCorePlugin(registry, plugin)
  slot = new SlotRenderable(setup.renderer, { registry, name: "probe", mode: "single_winner" })
  setup.renderer.root.add(slot)
  assert.deepEqual(calls, ["activate"])

  unregister()
  assert.deepEqual(calls, ["activate", "deactivate", "dispose"])

  // The destroyed slot must not react to later registry changes.
  registerCorePlugin(registry, plugin)
  assert.deepEqual(calls, ["activate", "deactivate", "dispose"])
} finally {
  setup.renderer.destroy()
}
console.log("slot-destroy-during-deactivate ok")
`)
})

test.skipIf(!supportsFfi)("slot destroy inside onActivate still runs the paired deactivate and dispose", () => {
  runDriver(`
${PREAMBLE}
import { SlotRenderable, createCoreSlotRegistry, registerCorePlugin } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const registry = createCoreSlotRegistry(setup.renderer, {})
  const calls = []
  const slot = new SlotRenderable(setup.renderer, { registry, name: "probe", mode: "single_winner" })
  setup.renderer.root.add(slot)
  assert.deepEqual(calls, [])

  registerCorePlugin(registry, {
    id: "first-plugin",
    slots: {
      probe: {
        render: () => new TextRenderable(setup.renderer, { content: "first" }),
        onActivate: () => {
          calls.push("activate:first")
          slot.destroy()
        },
        onDeactivate: () => calls.push("deactivate:first"),
        onDispose: () => calls.push("dispose:first"),
      },
    },
  })
  assert.deepEqual(calls, ["activate:first", "deactivate:first", "dispose:first"])
  assert.equal(slot.getChildren().length, 0)

  registerCorePlugin(registry, {
    id: "second-plugin",
    slots: {
      probe: {
        render: () => new TextRenderable(setup.renderer, { content: "second" }),
        onActivate: () => calls.push("activate:second"),
      },
    },
  })
  assert.deepEqual(calls, ["activate:first", "deactivate:first", "dispose:first"])
} finally {
  setup.renderer.destroy()
}
console.log("slot-destroy-during-activate ok")
`)
})

test.skipIf(!supportsFfi)("native span feed surfaces async handler rejections and stays idle", () => {
  runDriver(`
${PREAMBLE}
import { NativeSpanFeed, resolveRenderLib } from "@defai-digital/ax-tui"
const lib = resolveRenderLib()
const sentinel = { sentinel: true }
for (const value of [new Error("async boom"), 0]) {
  const feed = NativeSpanFeed.create()
  let captured = sentinel
  const onUncaught = (err) => {
    captured = err
  }
  process.on("uncaughtException", onUncaught)
  try {
    feed.onData(async () => {
      throw value
    })
    lib.streamWrite(feed.streamPtr, "hello")
    lib.streamCommit(feed.streamPtr)
    await feed.idle()
    assert.equal(feed.isBackpressured(), false)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(captured, value)
  } finally {
    feed.close()
    process.off("uncaughtException", onUncaught)
  }
}
console.log("span-feed-async-rejection ok")
`)
})

test.skipIf(!supportsFfi)("native span feed onData returns a disposer and drains past a failing batch", () => {
  runDriver(`
${PREAMBLE}
import { NativeSpanFeed, resolveRenderLib } from "@defai-digital/ax-tui"
const lib = resolveRenderLib()
const feed = NativeSpanFeed.create()
let calls = 0
let captured = null
const onUncaught = (err) => {
  captured = err
}
process.on("uncaughtException", onUncaught)
try {
  for (let i = 0; i < 300; i++) {
    lib.streamWrite(feed.streamPtr, "x")
    lib.streamCommit(feed.streamPtr)
  }
  let syncThrow = null
  let off
  try {
    off = feed.onData(() => {
      calls++
      throw new Error("boom")
    })
  } catch (err) {
    syncThrow = err
  }
  assert.equal(syncThrow, null)
  assert.equal(typeof off, "function")
  assert.equal(calls, 300)

  off()
  lib.streamWrite(feed.streamPtr, "y")
  lib.streamCommit(feed.streamPtr)
  assert.equal(calls, 300)

  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.ok(captured instanceof Error)
  assert.equal(captured.message, "boom")
} finally {
  feed.close()
  process.off("uncaughtException", onUncaught)
}
console.log("span-feed-ondata-disposer ok")
`)
})

test.skipIf(!supportsFfi)("native span feed idle resolves only after a sync onData drain failure is surfaced", () => {
  runDriver(`
${PREAMBLE}
import { NativeSpanFeed, resolveRenderLib } from "@defai-digital/ax-tui"
const lib = resolveRenderLib()
const feed = NativeSpanFeed.create()
let captured = null
const onUncaught = (err) => {
  captured = err
}
process.on("uncaughtException", onUncaught)
try {
  // Queue data with no handler so onData() drives the drain synchronously.
  lib.streamWrite(feed.streamPtr, "hello")
  lib.streamCommit(feed.streamPtr)
  const done = feed.idle()
  // Register the idle reaction before onData: the bug resolves idle inside the
  // drain, so this reaction runs before the queued handler-error microtask.
  const checked = done.then(() => {
    assert.ok(captured instanceof Error)
    assert.equal(captured.message, "boom")
  })
  feed.onData(() => {
    throw new Error("boom")
  })
  await checked
} finally {
  feed.close()
  process.off("uncaughtException", onUncaught)
}
console.log("span-feed-idle-after-sync-failure ok")
`)
})

test.skipIf(!supportsFfi)("native span feed idle stays pending across later batches after a sync drain failure", () => {
  runDriver(`
${PREAMBLE}
import { NativeSpanFeed, resolveRenderLib } from "@defai-digital/ax-tui"
const lib = resolveRenderLib()
const feed = NativeSpanFeed.create()
let calls = 0
let captured = null
const onUncaught = (err) => {
  captured = err
}
process.on("uncaughtException", onUncaught)
try {
  for (let i = 0; i < 300; i++) {
    lib.streamWrite(feed.streamPtr, "x")
    lib.streamCommit(feed.streamPtr)
  }
  const done = feed.idle()
  // Register the idle reaction before onData so it observes the buggy early
  // resolve from the first failing batch, before the error microtask runs.
  const checked = done.then(() => {
    assert.equal(calls, 300)
    assert.ok(captured instanceof Error)
    assert.equal(captured.message, "boom")
  })
  feed.onData(() => {
    calls++
    if (calls === 1) throw new Error("boom")
  })
  await checked
} finally {
  feed.close()
  process.off("uncaughtException", onUncaught)
}
console.log("span-feed-idle-across-batches ok")
`)
})

test.skipIf(!supportsFfi)("slot refresh survives a plugin registering another plugin during onActivate", () => {
  runDriver(`
${PREAMBLE}
import { SlotRenderable, createCoreSlotRegistry, registerCorePlugin } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const registry = createCoreSlotRegistry(setup.renderer, {})
  const calls = []
  let secondNode
  const second = {
    id: "second",
    slots: {
      probe: {
        render: () => {
          secondNode = new TextRenderable(setup.renderer, { content: "second" })
          return secondNode
        },
        onActivate: () => calls.push("second:activate"),
        onDeactivate: () => calls.push("second:deactivate"),
      },
    },
  }
  registerCorePlugin(registry, {
    id: "first",
    slots: {
      probe: {
        render: () => new TextRenderable(setup.renderer, { content: "first" }),
        onActivate: () => {
          calls.push("first:activate")
          registerCorePlugin(registry, second)
        },
        onDeactivate: () => calls.push("first:deactivate"),
      },
    },
  })
  const slot = new SlotRenderable(setup.renderer, { registry, name: "probe" })
  setup.renderer.root.add(slot)
  assert.deepEqual(calls, ["first:activate", "second:activate"])
  assert.ok(secondNode)
  // The outer refresh used to resume with a stale snapshot and unmount the
  // node the inner refresh had just mounted, wiping its activation record.
  assert.equal(secondNode.parent, slot)
  assert.equal(slot.getChildren().length, 2)

  slot.destroy()
  assert.deepEqual(calls, ["first:activate", "second:activate", "first:deactivate", "second:deactivate"])
} finally {
  setup.renderer.destroy()
}
console.log("slot-reentrant-register ok")
`)
})

test.skipIf(!supportsFfi)("registry rejects a re-entrant duplicate id during setup", () => {
  runDriver(`
${PREAMBLE}
import { createCoreSlotRegistry, registerCorePlugin } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const registry = createCoreSlotRegistry(setup.renderer, {})
  let setupCalls = 0
  let reentrantThrew = false
  const plugin = {
    id: "dup",
    setup: () => {
      setupCalls++
      if (setupCalls === 1) {
        try {
          registerCorePlugin(registry, plugin)
        } catch {
          reentrantThrew = true
        }
      }
    },
    slots: {
      probe: {
        render: () => new TextRenderable(setup.renderer, { content: "dup" }),
      },
    },
  }
  registerCorePlugin(registry, plugin)
  // The duplicate check only inspected pushed entries, so a setup hook could
  // register the same id again and leave two entries behind.
  assert.equal(reentrantThrew, true)
  assert.equal(registry.resolveEntries("probe").length, 1)
  assert.equal(registry.unregister("dup"), true)
  assert.equal(registry.resolveEntries("probe").length, 0)
} finally {
  setup.renderer.destroy()
}
console.log("registry-reentrant-duplicate ok")
`)
})