// Golden-frame parity gate (ADR-046 Phase 0).
//
// Renders representative scenes through the REAL OpenTUI native pipeline
// (node:ffi -> native render core) with the headless test renderer, then
// byte-compares serialized frames (character grid + styled spans + cursor)
// against committed goldens. Today this guards Node runtime bumps and
// upstream @opentui/core-<platform> bumps; once the Rust render core lands
// (AX_CODE_NATIVE_RENDER) the same goldens are the parity oracle between the
// Zig and Rust backends.
//
// Scenes deliberately concentrate on the parity risk areas called out in
// ADR-046: yoga flex layout, styled text attributes, CJK/emoji width and
// wrapping, border charsets, the edit-buffer path (input/textarea), select
// lists, and scrollbox overflow.
//
// Usage:
//   pnpm check:golden-frames                 # compare against goldens
//   pnpm check:golden-frames --update        # regenerate goldens
//   pnpm check:golden-frames --scene=<name>  # limit to one scene

import fs from "node:fs"
import path from "node:path"
import {
  BoxRenderable,
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextRenderable,
  TextareaRenderable,
  TextAttributes,
  bold,
  italic,
  underline,
  t,
  type RGBA,
  type CapturedFrame,
} from "@ax-code/opentui-core"
import { createTestRenderer, type TestRendererSetup } from "@ax-code/opentui-core/testing"
import { readText, writeText } from "./fs-compat"

const SNAPSHOT_DIR = path.resolve(import.meta.dirname, "../test/cli/tui/__snapshots__/golden-frames")

type Renderer = TestRendererSetup["renderer"]

interface Scene {
  name: string
  width: number
  height: number
  build: (renderer: Renderer) => void | Promise<void>
}

const SCENES: Scene[] = [
  {
    // Nested flex layout: column/row nesting, grow ratios, gap, padding —
    // exercises the yoga subsystem end to end.
    name: "yoga-flex-layout",
    width: 48,
    height: 14,
    build(renderer) {
      const root = new BoxRenderable(renderer, { width: "100%", height: "100%", flexDirection: "column" })
      const header = new BoxRenderable(renderer, {
        height: 3,
        border: true,
        borderStyle: "rounded",
        title: "ax-code",
        titleAlignment: "center",
      })
      const body = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: "row", gap: 1, padding: 1 })
      const side = new BoxRenderable(renderer, { flexGrow: 1, border: true, backgroundColor: "#1e2939" })
      const main = new BoxRenderable(renderer, {
        flexGrow: 2,
        border: true,
        borderStyle: "double",
        title: "main",
        backgroundColor: "#312e51",
      })
      side.add(new TextRenderable(renderer, { content: "side" }))
      main.add(new TextRenderable(renderer, { content: "content" }))
      body.add(side)
      body.add(main)
      root.add(header)
      root.add(body)
      renderer.root.add(root)
    },
  },
  {
    // fg/bg colors and every attribute path we ship: option-level attributes
    // plus styled-text template composition.
    name: "styled-text-attributes",
    width: 44,
    height: 8,
    build(renderer) {
      const root = new BoxRenderable(renderer, { width: "100%", height: "100%", flexDirection: "column" })
      root.add(new TextRenderable(renderer, { content: "plain default text" }))
      root.add(new TextRenderable(renderer, { content: "colored fg/bg", fg: "#e5c07b", bg: "#282c34" }))
      root.add(new TextRenderable(renderer, { content: "bold attribute", attributes: TextAttributes.BOLD }))
      root.add(
        new TextRenderable(renderer, {
          content: "dim + underline",
          attributes: TextAttributes.DIM | TextAttributes.UNDERLINE,
        }),
      )
      root.add(
        new TextRenderable(renderer, { content: t`mix ${bold("bold")} ${italic("italic")} ${underline("under")}` }),
      )
      renderer.root.add(root)
    },
  },
  {
    // Word wrapping across mixed-width content — the exact class of geometry
    // that broke on the node:ffi u32 marshalling change.
    name: "text-wrap-cjk-emoji",
    width: 26,
    height: 10,
    build(renderer) {
      const box = new BoxRenderable(renderer, { width: 22, height: "100%", border: true, title: "wrap" })
      box.add(
        new TextRenderable(renderer, {
          wrapMode: "word",
          content: "The quick 棕色狐狸 jumps over 懶狗 🚀 mixed 寬度 wrapping test",
        }),
      )
      renderer.root.add(box)
    },
  },
  {
    // Border charsets and titles.
    name: "border-styles",
    width: 48,
    height: 6,
    build(renderer) {
      const row = new BoxRenderable(renderer, { width: "100%", height: "100%", flexDirection: "row", gap: 1 })
      for (const borderStyle of ["single", "double", "rounded", "heavy"] as const) {
        row.add(new BoxRenderable(renderer, { flexGrow: 1, border: true, borderStyle, title: borderStyle }))
      }
      renderer.root.add(row)
    },
  },
  {
    // Single-line edit buffer with a CJK value and a focused cursor.
    name: "input-cursor",
    width: 32,
    height: 5,
    build(renderer) {
      const box = new BoxRenderable(renderer, { width: "100%", height: "100%", border: true, title: "input" })
      const input = new InputRenderable(renderer, { value: "hello 世界", width: "100%" })
      box.add(input)
      renderer.root.add(box)
      input.focus()
    },
  },
  {
    // Multi-line edit buffer (rope) with mixed-width lines.
    name: "textarea-multiline",
    width: 32,
    height: 8,
    build(renderer) {
      const box = new BoxRenderable(renderer, { width: "100%", height: "100%", border: true })
      const textarea = new TextareaRenderable(renderer, {
        width: "100%",
        height: "100%",
        initialValue: "first line\n第二行中文字\nthird 🚀 line",
      })
      box.add(textarea)
      renderer.root.add(box)
      textarea.focus()
    },
  },
  {
    // Select list with descriptions and a non-default selection.
    name: "select-list",
    width: 34,
    height: 9,
    build(renderer) {
      const select = new SelectRenderable(renderer, {
        width: "100%",
        height: "100%",
        showDescription: true,
        selectedIndex: 1,
        options: [
          { name: "alpha", description: "first option" },
          { name: "beta", description: "second option" },
          { name: "gamma 選項", description: "third 寬字 option" },
          { name: "delta", description: "fourth option" },
        ],
      })
      renderer.root.add(select)
    },
  },
  {
    // Overflowing scrollbox: viewport clipping + scrollbar rendering.
    name: "scrollbox-overflow",
    width: 30,
    height: 8,
    build(renderer) {
      const scroll = new ScrollBoxRenderable(renderer, { width: "100%", height: "100%" })
      for (let i = 1; i <= 20; i++) {
        scroll.add(new TextRenderable(renderer, { content: `line ${String(i).padStart(2, "0")} of twenty` }))
      }
      renderer.root.add(scroll)
    },
  },
]

function hex(color: RGBA): string {
  const u8 = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0")
  return `#${u8(color.r)}${u8(color.g)}${u8(color.b)}${color.a < 1 ? u8(color.a) : ""}`
}

function serializeSpans(frame: CapturedFrame) {
  return {
    cols: frame.cols,
    rows: frame.rows,
    cursor: frame.cursor,
    lines: frame.lines.map((line) => ({
      spans: line.spans.map((span) => ({
        text: span.text,
        fg: hex(span.fg),
        bg: hex(span.bg),
        attributes: span.attributes,
        width: span.width,
      })),
    })),
  }
}

async function renderScene(scene: Scene): Promise<string> {
  const setup = await createTestRenderer({ width: scene.width, height: scene.height })
  try {
    await scene.build(setup.renderer)
    // Two passes: the first computes layout/wrapping, the second settles any
    // measure-func driven reflow so the capture is deterministic.
    await setup.renderOnce()
    await setup.renderOnce()
    const golden = {
      scene: scene.name,
      width: scene.width,
      height: scene.height,
      chars: setup.captureCharFrame().split("\n"),
      frame: serializeSpans(setup.captureSpans()),
    }
    return JSON.stringify(golden, null, 2) + "\n"
  } finally {
    setup.renderer.destroy()
  }
}

function printCharDiff(name: string, expected: string, actual: string) {
  const expectedChars = (JSON.parse(expected).chars ?? []) as string[]
  const actualChars = (JSON.parse(actual).chars ?? []) as string[]
  const rows = Math.max(expectedChars.length, actualChars.length)
  let shown = 0
  for (let row = 0; row < rows && shown < 6; row++) {
    if ((expectedChars[row] ?? "") === (actualChars[row] ?? "")) continue
    console.error(`  row ${row}:`)
    console.error(`    golden |${expectedChars[row] ?? "<missing>"}|`)
    console.error(`    actual |${actualChars[row] ?? "<missing>"}|`)
    shown++
  }
  if (shown === 0)
    console.error(`  (character grids match — the difference is in span styles or cursor; diff ${name}.json)`)
}

const update = process.argv.includes("--update")
const sceneFilter = process.argv.find((a) => a.startsWith("--scene="))?.slice("--scene=".length)
const selected = sceneFilter ? SCENES.filter((s) => s.name === sceneFilter) : SCENES
if (selected.length === 0) {
  console.error(`Unknown scene: ${sceneFilter}. Scenes: ${SCENES.map((s) => s.name).join(", ")}`)
  process.exit(1)
}

fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
let failures = 0

for (const scene of selected) {
  const goldenPath = path.join(SNAPSHOT_DIR, `${scene.name}.json`)
  const actual = await renderScene(scene)
  if (update) {
    await writeText(goldenPath, actual)
    console.log(`updated ${scene.name}`)
    continue
  }
  if (!fs.existsSync(goldenPath)) {
    console.error(`✗ ${scene.name}: golden missing — run \`pnpm check:golden-frames --update\``)
    failures++
    continue
  }
  const expected = await readText(goldenPath)
  // Compare canonicalized JSON, not raw bytes: a repo-wide prettier run may
  // rewrap short arrays in the golden files without changing frame content.
  if (JSON.stringify(JSON.parse(expected)) === JSON.stringify(JSON.parse(actual))) {
    console.log(`✓ ${scene.name}`)
  } else {
    console.error(`✗ ${scene.name}: frame drift`)
    printCharDiff(scene.name, expected, actual)
    failures++
  }
}

// Stray goldens (scene renamed/removed) fail the gate too, so coverage cannot
// silently shrink.
if (!sceneFilter) {
  const known = new Set(SCENES.map((s) => `${s.name}.json`))
  for (const file of fs.readdirSync(SNAPSHOT_DIR)) {
    if (!file.endsWith(".json") || known.has(file)) continue
    if (update) {
      fs.rmSync(path.join(SNAPSHOT_DIR, file))
      console.log(`removed stray golden ${file}`)
    } else {
      console.error(`✗ stray golden with no scene: ${file} (run --update to remove)`)
      failures++
    }
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} golden-frame failure(s). If the drift is intentional, run \`pnpm check:golden-frames --update\`.`,
  )
  process.exit(1)
}
console.log(
  update
    ? `\n${selected.length} golden(s) written to ${path.relative(process.cwd(), SNAPSHOT_DIR)}`
    : "\nall golden frames match",
)
process.exit(0)
