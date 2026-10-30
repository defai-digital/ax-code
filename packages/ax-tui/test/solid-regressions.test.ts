import { build } from "esbuild"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { resolveNodeSolidRuntimeImport, transformSolidSource } from "../solid/source/scripts/solid-transform.js"

const root = fileURLToPath(new URL("../", import.meta.url))
const solidEntry = path.join(root, "solid/source/index.ts")
const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

test.skipIf(!supportsFfi)("application hooks and image props stop with their Solid owner", async () => {
  await runSolidScenario(`
import assert from "node:assert/strict"
import { createSignal, onMount, Show } from "solid-js"
import { testRender, useCommands, useCommandPalette, useFocusManager } from "@defai-digital/ax-tui/solid"
import { getCommandRegistry, getFocusManager } from "@defai-digital/ax-tui"

const [visible, setVisible] = createSignal(true)
const [pixels, setPixels] = createSignal({ width: 1, height: 1, data: Uint8Array.from([255, 0, 0, 255]) })
let image, input, commands, palettes, focus
function Controls() {
  commands = useCommands()
  palettes = useCommandPalette()
  focus = useFocusManager()
  commands.register({ id: "owned", title: "Owned command", run() {} })
  onMount(() => focus.registerScope(input.parent))
  return <box width="100%" height="100%">
    <input ref={node => input = node} value="Field" />
    <image ref={node => image = node} source={pixels()} width={6} height={3} protocol="blocks" />
  </box>
}
const setup = await testRender(() => <Show when={visible()}><Controls /></Show>, {
  width: 32, height: 12, useKittyKeyboard: null,
})
const { renderer } = setup
try {
  await image.loadPromise
  await setup.flush()
  input.focus()
  assert.ok(setup.captureCharFrame().includes("▀"))
  setPixels({ width: 1, height: 1, data: Uint8Array.from([0, 255, 0, 255]) })
  await image.loadPromise
  await setup.flush()
  assert.ok(setup.captureSpans().lines.flatMap(line => line.spans).some(span => span.text.includes("▀") && span.fg.toInts()[1] === 255))
  const palette = palettes.show()
  await setup.flush()
  assert.equal(palette.selectedId, "owned")
  setVisible(false)
  await setup.flush()
  assert.equal(await palette.result, null)
  assert.equal(image.isDestroyed, true)
  assert.equal(getCommandRegistry(renderer).search().length, 0)
  assert.equal(getFocusManager(renderer).focusNext(), false)
  assert.throws(() => commands.register({ id: "late", title: "Late", run() {} }), /disposed/)
  assert.throws(() => palettes.show(), /disposed/)
  assert.throws(() => focus.registerScope(renderer.root), /disposed/)
} finally { renderer.destroy() }
process.stdout.write("AX_SOLID_APPLICATION_COMPLETE")
`)
})

async function runSolidScenario(source: string): Promise<void> {
  await mkdir(path.join(root, ".internal"), { recursive: true })
  const fixture = await mkdtemp(path.join(root, ".internal/solid-regressions-"))
  const driver = path.join(fixture, "driver.mjs")
  try {
    await build({
      stdin: {
        contents: await transformSolidSource(source, {
          filename: "solid-regressions.tsx",
          moduleName: solidEntry,
          resolvePath: (specifier) =>
            specifier === "@defai-digital/ax-tui/solid" ? solidEntry : resolveNodeSolidRuntimeImport(specifier),
        }),
        resolveDir: root,
        sourcefile: "solid-regressions.tsx",
        loader: "js",
      },
      outfile: driver,
      bundle: true,
      packages: "external",
      platform: "node",
      format: "esm",
      logLevel: "silent",
      plugins: [
        {
          name: "solid-regressions-source",
          setup(builder) {
            builder.onResolve({ filter: /^solid-js(?:\/store)?$/ }, ({ path: specifier }) => ({
              path: resolveNodeSolidRuntimeImport(specifier)!,
              external: true,
            }))
            builder.onLoad({ filter: /\.tsx$/ }, async ({ path: filename }) => ({
              contents: await transformSolidSource(await readFile(filename, "utf8"), { filename }),
              loader: "js",
            }))
          },
        },
      ],
    })
    const result = spawnSync(
      process.execPath,
      ["--experimental-ffi", "--disable-warning=ExperimentalWarning", driver],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 20_000,
        env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" },
      },
    )
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
}

test.skipIf(!supportsFfi)(
  "nullish text/content props render as empty strings, not literal null/undefined",
  async () => {
    await runSolidScenario(`
import assert from "node:assert/strict"
import { testRender } from "@defai-digital/ax-tui/solid"

const setup = await testRender(() => <text content={undefined} />, { width: 12, height: 1, useKittyKeyboard: null })
try {
  await setup.renderOnce()
  assert.equal(setup.captureCharFrame().trim(), "")
} finally {
  setup.renderer.destroy()
}

let codeRef
const code = await testRender(() => <ascii_font ref={codeRef} text={null} />, { width: 12, height: 4, useKittyKeyboard: null })
try {
  await code.renderOnce()
  assert.equal(code.captureCharFrame().trim(), "")
} finally {
  code.renderer.destroy()
}
`)
  },
)

test.skipIf(!supportsFfi)(
  "layout style subkeys removed from a later style object restore their defaults",
  async () => {
    await runSolidScenario(`
import assert from "node:assert/strict"
import { createSignal } from "solid-js"
import { testRender } from "@defai-digital/ax-tui/solid"

let boxRef
const [style, setStyle] = createSignal({ width: 6, zIndex: 2 })
const setup = await testRender(() => <box ref={boxRef} style={style()} />, {
  width: 20,
  height: 2,
  useKittyKeyboard: null,
})
try {
  await setup.renderOnce()
  assert.equal(boxRef.width, 6)
  assert.equal(boxRef.zIndex, 2)

  // width disappears, zIndex changes: width must fall back to "auto"
  // (filling the 20-col parent) instead of sticking at 6.
  setStyle({ zIndex: 3 })
  await setup.renderOnce()
  assert.equal(boxRef.zIndex, 3)
  assert.equal(boxRef.width, 20)

  // Clearing the whole style restores the captured pre-style zIndex.
  setStyle(undefined)
  await setup.renderOnce()
  assert.equal(boxRef.zIndex, 0)
} finally {
  setup.renderer.destroy()
}
`)
  },
)

test.skipIf(!supportsFfi)("spread props that disappear are unset instead of sticking", async () => {
  await runSolidScenario(`
import assert from "node:assert/strict"
import { createSignal } from "solid-js"
import { testRender } from "@defai-digital/ax-tui/solid"

let boxRef
const [props, setProps] = createSignal({ zIndex: 3, title: "hello" })
const setup = await testRender(() => <box ref={boxRef} {...props()} />, {
  width: 20,
  height: 2,
  useKittyKeyboard: null,
})
try {
  await setup.renderOnce()
  assert.equal(boxRef.zIndex, 3)
  assert.equal(boxRef.title, "hello")

  setProps({})
  await setup.renderOnce()
  // The generic unset assigns undefined, which setters treat as "back to
  // default" (zIndex has no explicit default translation, so it reads back
  // as undefined rather than its effective 0).
  assert.equal(boxRef.zIndex, undefined)
  assert.equal(boxRef.title, undefined)
} finally {
  setup.renderer.destroy()
}
`)
})

test.skipIf(!supportsFfi)(
  "changing id after insertion does not desync removal into a ghost node",
  async () => {
    await runSolidScenario(`
import assert from "node:assert/strict"
import { createSignal, Show } from "solid-js"
import { testRender } from "@defai-digital/ax-tui/solid"

let parentRef
const [id, setId] = createSignal("a")
const [show, setShow] = createSignal(true)
const setup = await testRender(
  () => (
    <box ref={parentRef}>
      <Show when={show()}>
        <box id={id()} width={2} height={1} />
      </Show>
      <text>marker</text>
    </box>
  ),
  { width: 20, height: 2, useKittyKeyboard: null },
)
try {
  await setup.renderOnce()
  assert.equal(parentRef.getChildren().length, 2)

  // Post-insert id changes are ignored; removal must still find the node.
  setId("b")
  await setup.renderOnce()
  setShow(false)
  await setup.renderOnce()
  // <Show> leaves its internal slot node behind; the inner box must be gone.
  const remaining = parentRef.getChildren().filter((child) => !child.id.startsWith("slot-"))
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].id, "text-1")
} finally {
  setup.renderer.destroy()
}
`)
  },
)

test.skipIf(!supportsFfi)("unmounting a Portal destroys its container subtree", async () => {
  await runSolidScenario(`
import assert from "node:assert/strict"
import { createSignal, Show } from "solid-js"
import { testRender, Portal } from "@defai-digital/ax-tui/solid"

let portalRef
const [show, setShow] = createSignal(true)
const setup = await testRender(
  () => (
    <box>
      <Show when={show()}>
        <Portal ref={portalRef}>
          <text>portal</text>
        </Portal>
      </Show>
    </box>
  ),
  { width: 20, height: 2, useKittyKeyboard: null },
)
try {
  await setup.renderOnce()
  assert.ok(portalRef)
  assert.equal(portalRef.isDestroyed, false)

  setShow(false)
  await setup.renderOnce()
  assert.equal(portalRef.isDestroyed, true)
} finally {
  setup.renderer.destroy()
}
`)
})


test.skipIf(!supportsFfi)("moving a Portal to a new mount keeps its content alive", async () => {
  await runSolidScenario(`
import assert from "node:assert/strict"
import { createSignal } from "solid-js"
import { testRender, Portal } from "@defai-digital/ax-tui/solid"

let hostA
let hostB
const [secondHost, setSecondHost] = createSignal(false)
const setup = await testRender(
  () => (
    <box>
      <box ref={hostA} width={20} height={1} />
      <box ref={hostB} width={20} height={1} />
      <Portal mount={secondHost() ? hostB : hostA}>
        <text>portaled</text>
      </Portal>
    </box>
  ),
  { width: 20, height: 3, useKittyKeyboard: null },
)
try {
  await setup.renderOnce()
  assert.ok(setup.captureCharFrame().includes("portaled"), "initial mount did not render")

  // The old container is destroyed on cleanup; the new mount must receive
  // freshly created content, not the destroyed subtree.
  setSecondHost(true)
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  assert.ok(frame.includes("portaled"), "portal content lost after mount change:\\n" + frame)
  assert.equal(hostB.getChildren().length, 1)
} finally {
  setup.renderer.destroy()
}
`)
})

test.skipIf(!supportsFfi)("falsy JSX children do not wipe a diff's internal panes", async () => {
  await runSolidScenario(`
import assert from "node:assert/strict"
import { createSignal } from "solid-js"
import { testRender } from "@defai-digital/ax-tui/solid"

const sampleDiff = [
  "--- a/file.txt",
  "+++ b/file.txt",
  "@@ -1,3 +1,3 @@",
  " line1",
  "-old line2",
  "+new line2",
  " line3",
].join("\\n")

const [show, setShow] = createSignal(true)
const setup = await testRender(
  () => (
    <diff diff={sampleDiff} width={60} height={8}>
      {show() ? <text content="overlay" /> : null}
    </diff>
  ),
  { width: 60, height: 8, useKittyKeyboard: null },
)
try {
  await setup.renderOnce()
  const before = setup.captureCharFrame()
  assert.ok(before.includes("old line2"), "diff did not render initially:\\n" + before)

  setShow(false)
  await setup.renderOnce()
  const after = setup.captureCharFrame()
  assert.ok(after.includes("old line2"), "diff internals wiped by falsy child:\\n" + after)
} finally {
  setup.renderer.destroy()
}
`)
})

test.skipIf(!supportsFfi)("falsy JSX children clear a line_number target without throwing", async () => {
  await runSolidScenario(`
import assert from "node:assert/strict"
import { createSignal } from "solid-js"
import { testRender } from "@defai-digital/ax-tui/solid"

const [show, setShow] = createSignal(true)
const setup = await testRender(
  () => (
    <line_number width={60} height={6}>
      {show() ? <code content={"line1\\nline2"} filetype="text" /> : null}
    </line_number>
  ),
  { width: 60, height: 6, useKittyKeyboard: null },
)
try {
  await setup.renderOnce()
  const before = setup.captureCharFrame()
  assert.ok(before.includes("line1"), "line_number target did not render:\\n" + before)

  // Must not throw "Cannot remove target/gutter directly" from the update batch.
  setShow(false)
  await setup.renderOnce()
  const after = setup.captureCharFrame()
  assert.ok(!after.includes("line1"), "target still rendered after children went falsy:\\n" + after)
} finally {
  setup.renderer.destroy()
}
`)
})

test.skipIf(!supportsFfi)("clearing a diff removes the previously rendered panes", async () => {
  await runSolidScenario(`
import assert from "node:assert/strict"
import { createSignal } from "solid-js"
import { testRender } from "@defai-digital/ax-tui/solid"

const sampleDiff = [
  "--- a/file.txt",
  "+++ b/file.txt",
  "@@ -1,3 +1,3 @@",
  " line1",
  "-old line2",
  "+new line2",
  " line3",
].join("\\n")

const [diff, setDiff] = createSignal(sampleDiff)
const setup = await testRender(
  () => <diff diff={diff()} width={60} height={8} />,
  { width: 60, height: 8, useKittyKeyboard: null },
)
try {
  await setup.renderOnce()
  assert.ok(setup.captureCharFrame().includes("old line2"), "diff did not render initially")

  setDiff("")
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  assert.ok(!frame.includes("old line2"), "stale diff panes remain after clearing:\\n" + frame)
} finally {
  setup.renderer.destroy()
}
`)
})

test.skipIf(!supportsFfi)("anchored text inserts keep raw string children in place", async () => {
  await runSolidScenario(`
import assert from "node:assert/strict"
import { createSignal, For } from "solid-js"
import { testRender } from "@defai-digital/ax-tui/solid"

let textRef
const [items, setItems] = createSignal(["A", "B"])
const setup = await testRender(
  () => (
    <text ref={textRef}>
      <For each={items()}>{(item) => <span>{item}</span>}</For>
    </text>
  ),
  { width: 20, height: 2, useKittyKeyboard: null },
)
try {
  await setup.renderOnce()

  // Mix an imperative raw string child in front of the JSX-managed nodes.
  textRef.add("hdr", 0)
  await setup.renderOnce()
  assert.equal(setup.captureCharFrame().trim().split("\\n")[0], "hdrAB")

  // Prepending makes the reconciler insert before the "A" anchor; the raw
  // string must stay ahead of both.
  setItems(["X", "A", "B"])
  await setup.renderOnce()
  const line = setup.captureCharFrame().trim().split("\\n")[0]
  assert.equal(line, "hdrXAB", "anchored insert crossed the raw string child: " + line)
} finally {
  setup.renderer.destroy()
}
`)
})
