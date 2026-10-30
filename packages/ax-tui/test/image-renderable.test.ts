import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

function scenario(source: string, config = "{}"): void {
  const result = spawnSync(process.execPath, ["--experimental-ffi", "--disable-warning=ExperimentalWarning",
    "--input-type=module", "-e", `
import assert from "node:assert/strict"
import { Writable } from "node:stream"
import { crc32, deflateSync } from "node:zlib"
import { BoxRenderable, ImageRenderable, Renderable, ScrollBoxRenderable, RGBA } from "@defai-digital/ax-tui"
import { createTestRenderer, setRendererCapabilities } from "@defai-digital/ax-tui/testing"
const output = []
const stdout = new Writable({ write(chunk, _encoding, callback) { output.push(Buffer.from(chunk)); callback() } })
stdout.columns = 20; stdout.rows = 10; stdout.isTTY = true
const setup = await createTestRenderer({ width: 20, height: 10, useKittyKeyboard: null, ${config.slice(1, -1)} })
const { renderer } = setup
const rgba = (color = [255, 0, 0, 255]) => ({ width: 2, height: 2, data: Uint8Array.from([...color, ...color, ...color, ...color]) })
try { ${source} } finally { renderer.destroy() }
assert.equal(Renderable.renderablesByNumber.size, 0)
assert.equal(renderer.listenerCount("frame"), 0)
assert.equal(renderer.listenerCount("capabilities"), 0)
process.stdout.write("AX_IMAGE_SCENARIO_COMPLETE")
`], { encoding: "utf8", timeout: 20_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } })
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout, result.stderr).toContain("AX_IMAGE_SCENARIO_COMPLETE")
}

test.skipIf(!supportsFfi)("alt text is sanitized and length-bounded", () => {
  scenario(`
const image = new ImageRenderable(renderer, {
  width: 6,
  height: 2,
  alt: "\\u001b[31m" + "x".repeat(5000) + "\\u0007\\u0000tail",
})
renderer.root.add(image)
await setup.flush()
assert.ok(image.alt.length <= 1024, String(image.alt.length))
assert.ok(!image.alt.includes("\\u001b"), "escape sequence survived sanitization")
assert.ok(!image.alt.includes("\\u0007"), "BEL survived sanitization")
assert.ok(!image.alt.includes("\\u0000"), "NUL survived sanitization")
`)
})

test.skipIf(!supportsFfi)("images fit, crop and resize through native cell buffers without changing surrounding content", () => {
  scenario(`
const parent = new BoxRenderable(renderer, { width: 6, height: 3, overflow: "hidden" })
const image = new ImageRenderable(renderer, { width: 8, height: 4, source: rgba(), protocol: "blocks" })
parent.add(image); renderer.root.add(parent)
await image.loadPromise; await setup.flush()
const frame = setup.captureCharFrame().split("\\n")
assert.ok(frame.some(line => line.includes("▀")), frame.join("\\n"))
assert.ok(frame.every(line => !line.slice(6).includes("▀")))
assert.ok(frame.slice(3).every(line => !line.includes("▀")))
image.fit = "cover"; image.width = 3; image.height = 2
await setup.flush()
assert.ok(setup.captureCharFrame().includes("▀"))
image.source = undefined; image.alt = "No image"
await setup.flush()
assert.ok(!setup.captureCharFrame().includes("▀"))
image.width = 6; await setup.flush()
assert.ok(setup.captureCharFrame().includes("No ima"))
`)
})

test.skipIf(!supportsFfi)("images cancel stale loaders and retain the current source through reentrant abort listeners", () => {
  scenario(`
let resolveOld, aborted = false
const image = new ImageRenderable(renderer, { width: 8, height: 3,
  source: signal => { signal.addEventListener("abort", () => { aborted = true }); return new Promise(resolve => resolveOld = resolve) } })
renderer.root.add(image)
await Promise.resolve()
const old = image.loadPromise
image.source = rgba([0, 255, 0, 255]); await image.loadPromise
resolveOld(rgba()); await old
assert.equal(aborted, true); assert.equal(image.loadError, null)
await setup.flush()
const colors = setup.captureSpans().lines.flatMap(line => line.spans).filter(span => span.text.includes("▀"))
assert.ok(colors.some(span => span.fg.toInts()[1] === 255))
const replacement = rgba([0, 0, 255, 255])
image.source = signal => { signal.addEventListener("abort", () => { image.source = replacement }); return new Promise(() => {}) }
await Promise.resolve()
image.source = undefined
await image.loadPromise
assert.equal(image.source, replacement)
await setup.flush()
assert.ok(setup.captureSpans().lines.flatMap(line => line.spans).some(span => span.text.includes("▀") && span.fg.toInts()[2] === 255))
let resolveDestroyed
image.source = () => new Promise(resolve => resolveDestroyed = resolve)
await Promise.resolve()
const pending = image.loadPromise
image.destroy(); resolveDestroyed(rgba()); await pending
assert.equal(image.isDestroyed, true)
`)
})

test.skipIf(!supportsFfi)("image load errors expose a rejected promise and readable fallback without unhandled rejections", () => {
  scenario(`
let failures = 0, unhandled = 0
const listener = () => unhandled++
process.on("unhandledRejection", listener)
const image = new ImageRenderable(renderer, { width: 12, height: 2, source: new Uint8Array([1, 2, 3]),
  alt: "Broken image", onError() { failures++ } })
renderer.root.add(image)
await assert.rejects(image.loadPromise, /PNG/)
await setup.flush()
assert.equal(failures, 1)
assert.ok(setup.captureCharFrame().includes("Broken image"))
await new Promise(resolve => setImmediate(resolve))
assert.equal(unhandled, 0)
process.off("unhandledRejection", listener)
assert.throws(() => new ImageRenderable(renderer, { cellAspectRatio: NaN }), RangeError)
`)
})

test.skipIf(!supportsFfi)("PNG Buffer inputs are snapshotted before deferred decoding", () => {
  scenario(`
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data])
  const size = Buffer.alloc(4), crc = Buffer.alloc(4)
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([size, body, crc])
}
const header = Buffer.alloc(13)
header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
  chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255]))), chunk("IEND", Buffer.alloc(0))])
const image = new ImageRenderable(renderer, { width: 1, height: 1, source: png, protocol: "blocks" })
renderer.root.add(image)
png.fill(0)
await image.loadPromise; await setup.flush()
assert.equal(image.loadError, null)
assert.ok(setup.captureCharFrame().includes("▀"))
`)
})

test.skipIf(!supportsFfi)("superseded or destroyed images never start deferred loaders", () => {
  scenario(`
let calls = 0
const loader = async () => { calls++; return rgba() }
const image = new ImageRenderable(renderer, { source: loader })
renderer.root.add(image)
const superseded = image.loadPromise
image.source = rgba()
await superseded; await image.loadPromise
assert.equal(calls, 0)
image.source = loader
const destroyed = image.loadPromise
image.destroy()
await destroyed
assert.equal(calls, 0)
`)
})

test.skipIf(!supportsFfi)("block previews composite upper and lower pixel alpha independently", () => {
  scenario(`
const image = new ImageRenderable(renderer, { width: 1, height: 1, protocol: "blocks", backgroundColor: "black",
  source: { width: 1, height: 2, data: Uint8Array.from([255, 0, 0, 128, 0, 0, 255, 255]) } })
renderer.root.add(image); await image.loadPromise; await setup.flush()
const span = setup.captureSpans().lines[0].spans.find(span => span.text.includes("▀"))
assert.ok(span)
assert.deepEqual(span.fg.toInts(), [128, 0, 0, 255])
assert.deepEqual(span.bg.toInts(), [0, 0, 255, 255])
`)
})

test.skipIf(!supportsFfi)("Kitty placeholders retain graphemes, clip correctly, upload once and delete only owned IDs", () => {
  scenario(`
setRendererCapabilities(renderer, { kitty_graphics: true, rgb: true,
  terminal: { name: "kitty", version: "0.40.1", from_xtversion: true } })
const parent = new BoxRenderable(renderer, { width: 4, height: 2, overflow: "hidden" })
const image = new ImageRenderable(renderer, { width: 8, height: 4, source: rgba(), protocol: "auto" })
parent.add(image); renderer.root.add(parent)
await image.loadPromise; await setup.flush()
assert.equal(image.effectiveProtocol, "kitty")
const frame = setup.captureCharFrame()
assert.ok(frame.includes("\\u{10eeee}\\u0305\\u0305"), frame)
const bytes = Buffer.concat(output).toString("utf8")
const upload = /a=t,f=32,o=z,t=d,s=2,v=2,i=(\\d+)/.exec(bytes)
assert.ok(upload, bytes)
const id = Number(upload[1])
assert.ok(bytes.indexOf("a=t,") < bytes.indexOf("\\u{10eeee}"))
const uploadCount = (bytes.match(/a=t,f=32/g) || []).length
assert.equal(uploadCount, 1)
await setup.renderOnce(); await renderer.idle()
assert.equal((Buffer.concat(output).toString().match(/a=t,f=32/g) || []).length, 1)
const firstRow = setup.captureSpans().lines[0].spans
const imageSpan = firstRow.find(span => span.text.includes("\\u{10eeee}"))
assert.ok(imageSpan)
assert.equal(imageSpan.width, 4)
assert.deepEqual(imageSpan.fg.toInts().slice(0, 3), [(id >>> 16) & 255, (id >>> 8) & 255, id & 255])
renderer.suspend(); renderer.resume(); await setup.flush()
const resumedIds = [...Buffer.concat(output).toString().matchAll(/a=t,f=32,o=z,t=d,s=2,v=2,i=(\\d+)/g)]
assert.equal(resumedIds.length, 2)
assert.notEqual(resumedIds[1][1], resumedIds[0][1])
parent.opacity = 0.5; await setup.flush(); assert.equal(image.effectiveProtocol, "blocks")
assert.ok(!setup.captureCharFrame().includes("\\u{10eeee}"))
parent.opacity = 1; await setup.flush()
image.width = 3; await setup.flush()
assert.ok(Buffer.concat(output).toString().includes("a=d,d=I,i=" + id))
image.destroy(); await setup.flush()
assert.ok(!setup.captureCharFrame().includes("\\u{10eeee}"))
assert.ok(!Buffer.concat(output).toString().includes("a=d,d=A"))
`, "{ stdout, bufferedOutput: 'stdout' }")
})
