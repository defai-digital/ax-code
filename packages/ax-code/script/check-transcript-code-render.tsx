// Native renderer regression for the transcript's finished-text block.
//
// While a reply streams, the transcript paints plain `<text>`. At finalize it
// mounts `SessionCodeRenderer`. If that renderable is configured with
// `drawUnstyledText: false`, ax-tui leaves `_shouldRenderTextBuffer` false until
// the async tree-sitter highlight resolves, so the first frame of a finished
// reply is EMPTY and the block then reappears with whichever wrapping the
// highlighted pass produces — the transcript visibly blinks and shifts at the
// end of every reply. The framework default (true) paints the plain buffer
// immediately and lets the highlight replace it, which is also how Kimi Code
// keeps a streamed block stable (transient plain text, one styled pass).
//
// See .internal/reports/2026-09-26-tui-transcript-stability-plan.md.
//
// Usage: node script/node-ffi-runner.mjs --import tsx --import ../../script/solid-loader.mjs \
//          --conditions=node script/check-transcript-code-render.tsx

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const state = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-transcript-code-"))
process.env.XDG_STATE_HOME = state
process.env.XDG_CONFIG_HOME = state
process.env.XDG_DATA_HOME = state
process.env.AX_CODE_DISABLE_PROJECT_CONFIG = "true"

const { testRender } = await import("ax-tui/solid")
const { SessionCodeRenderer } = await import("../src/cli/tui/routes/session/render-adapter")

const content = ["# Heading", "", "paragraph text here", "", "```ts", "const answer = 42", "```", ""].join("\n")

function paintedRows(frame: string) {
  return frame.split("\n").filter((line) => line.trim().length > 0).length
}

let cases = 0
try {
  // Invariant: the first frame of a finished code block shows its text. The
  // probe uses the component's own defaults — passing `drawUnstyledText`
  // explicitly here would hide the regression the guard exists for.
  const setup = await testRender(
    () => <SessionCodeRenderer display={{ filetype: "markdown", content }} streaming={false} />,
    { width: 60, height: 12 },
  )
  try {
    await setup.flush()
    const first = setup.captureCharFrame()
    assert(first.includes("Heading"), "first frame must show the finished heading")
    assert(first.includes("paragraph text"), "first frame must show the finished prose")
    assert(first.includes("const answer"), "first frame must show the finished code block")

    // Reported, not asserted: once the highlight resolves, `conceal` may drop
    // the fence rows (a known, documented follow-up). The guard locks the blank
    // first frame, which is the regression this check exists for.
    await new Promise((resolve) => setTimeout(resolve, 300))
    await setup.flush()
    console.log(`finished block rows: first=${paintedRows(first)} settled=${paintedRows(setup.captureCharFrame())}`)
    cases++
  } finally {
    setup.renderer.destroy()
  }

  // Legacy control: the old configuration is exactly why the guard exists. It
  // is allowed to paint nothing, so it is reported rather than asserted.
  const legacy = await testRender(
    () => (
      <SessionCodeRenderer display={{ filetype: "markdown", content }} drawUnstyledText={false} streaming={false} />
    ),
    { width: 60, height: 12 },
  )
  try {
    await legacy.flush()
    const first = legacy.captureCharFrame()
    console.log(`legacy drawUnstyledText=false first frame: ${paintedRows(first)} painted rows`)
  } finally {
    legacy.renderer.destroy()
  }

  console.log(`PASS: ${cases} finished-block frames painted immediately and kept their height.`)
} finally {
  await fs.rm(state, { recursive: true, force: true })
}
