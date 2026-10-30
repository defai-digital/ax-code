import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { transformSolidSource, resolveNodeSolidRuntimeImport } from "../solid/scripts/solid-transform.js"

const root = fileURLToPath(new URL("../", import.meta.url))
const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

test.skipIf(!supportsFfi)(
  "owned renderer mounts reactive Solid TSX, cleans up, and highlights with bundled assets",
  async () => {
    await mkdir(path.join(root, ".internal"), { recursive: true })
    const fixture = await mkdtemp(path.join(root, ".internal/source-renderer-"))
    try {
      const source = `
import assert from "node:assert/strict"
import { once } from "node:events"
import { createSignal, onCleanup } from "solid-js"
import { testRender, insertNode } from "@defai-digital/ax-tui/solid"
import { TreeSitterClient, resolveRenderLib, TextNodeRenderable, TextAttributes } from "@defai-digital/ax-tui"
import { Node as YogaNode } from "@defai-digital/ax-tui/yoga"

const ownNode = YogaNode.createForAxTui()
const compatibilityNode = YogaNode.createForOpenTUI()
ownNode.free()
compatibilityNode.free()
const native = resolveRenderLib()
const compatibilityPointer = native.yogaNodeCreateForOpenTUI()
native.yogaNodeFree(compatibilityPointer)

let setCount
let cleaned = 0
const setup = await testRender(() => {
  const [count, update] = createSignal(1)
  setCount = update
  onCleanup(() => { cleaned++ })
  return <box width={36} height={4} flexDirection="column"><text>Count: {count()}</text><text>Local native renderer</text></box>
}, { width: 36, height: 4, useKittyKeyboard: null })
try {
  await setup.renderOnce()
  assert.ok(setup.captureCharFrame().includes("Count: 1"))
  setCount(2)
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  assert.ok(frame.includes("Count: 2"), frame)
  assert.ok(frame.includes("Local native renderer"), frame)
  assert.ok(!frame.includes("Count: 1"), frame)
} finally {
  setup.renderer.destroy()
}
assert.equal(cleaned, 1)

let setStyle
let span
let bold
const styled = await testRender(() => {
  const [style, update] = createSignal({ bold: true, fg: "red", bg: "blue" })
  setStyle = update
  return <text fg="green"><span ref={span} style={style()}>span</span><b ref={bold} style={style()}>bold</b></text>
}, { width: 20, height: 2, useKittyKeyboard: null })
try {
  await styled.renderOnce()
  assert.equal(span.attributes, TextAttributes.BOLD)
  assert.ok(span.fg)
  setStyle({ italic: true })
  await styled.renderOnce()
  assert.equal(span.attributes, TextAttributes.ITALIC)
  assert.equal(bold.attributes, TextAttributes.BOLD | TextAttributes.ITALIC)
  assert.equal(span.fg, undefined)
  assert.equal(span.bg, undefined)
  setStyle(undefined)
  await styled.renderOnce()
  assert.equal(span.attributes, 0)
  assert.equal(bold.attributes, TextAttributes.BOLD)
} finally {
  styled.renderer.destroy()
}

const parent = new TextNodeRenderable({ id: "parent" })
const children = ["a", "b", "c"].map(id => new TextNodeRenderable({ id }))
parent.add(children[0])
parent.add(children[1])
insertNode(parent, children[2], new TextNodeRenderable({ id: "stale" }))
assert.deepEqual(parent.getChildren().map(child => child.id), ["a", "b", "c"])

const client = new TreeSitterClient({ dataPath: process.argv[2] })
try {
  const highlighted = await client.highlightOnce("const value: number = 42", "typescript")
  assert.equal(highlighted.error, undefined)
  assert.ok(highlighted.highlights?.length > 0, JSON.stringify(highlighted))
  const nextHighlights = async (action) => {
    const response = once(client, "highlights:response", { signal: AbortSignal.timeout(3000) })
    await action()
    return response
  }
  const original = "const value = 42"
  const initial = await nextHighlights(() => client.createBuffer(1, original, "typescript"))
  assert.ok(initial[2].length > 0)
  const reset = await nextHighlights(() => client.resetBuffer(1, 2, " "))
  assert.deepEqual(reset, [1, 2, []])
  await nextHighlights(() => client.resetBuffer(1, 3, original))
  const edited = await nextHighlights(() => client.updateBuffer(1, [{
    startIndex: 0, oldEndIndex: original.length, newEndIndex: 1,
    startPosition: { row: 0, column: 0 },
    oldEndPosition: { row: 0, column: original.length },
    newEndPosition: { row: 0, column: 1 },
  }], " ", 4))
  assert.deepEqual(edited, [1, 4, []])
  await client.removeBuffer(1)
} finally {
  await client.destroy()
}
console.log("Source renderer integration passed")
`
      const driver = path.join(fixture, "driver.mjs")
      await writeFile(
        driver,
        await transformSolidSource(source, {
          filename: "source-renderer.tsx",
          resolvePath: resolveNodeSolidRuntimeImport,
        }),
      )
      const result = spawnSync(
        process.execPath,
        ["--experimental-ffi", "--disable-warning=ExperimentalWarning", driver, path.join(fixture, "parsers")],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 20_000,
          env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" },
        },
      )
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      expect(result.stdout).toContain("Source renderer integration passed")
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  },
  30_000,
)
