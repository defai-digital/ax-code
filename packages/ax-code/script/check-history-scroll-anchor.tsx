// Real-renderer check for "Load earlier messages" scroll restoration.
//
// The session route keeps the anchored row on screen after older messages
// prepend. Unit tests fake the scrollport; this mounts an ax-tui scrollbox
// (stickyScroll, stickyStart "bottom", same as routes/session/index.tsx) at
// 80x20 and checks two cases:
//
//   1. A middle anchor: the row that was at the top of the viewport is at the
//      top again after 40 rows are prepended to 60.
//   2. A bottom anchor: sticky scroll still shows the last row after the prepend.
//
// Exit 0 on success, 1 with a frame dump on failure.
//
// Usage: pnpm --dir packages/ax-code run check:history-scroll-anchor

import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// ---------------------------------------------------------------------------
// Environment isolation (before any app module loads), mirroring
// check-product-frames.tsx / check-transcript-frame-time.tsx.

// The prepared native cache (CI's verified offline download) is kept; every
// other inherited AX_CODE_* / OPENCODE_* variable is dropped.
const KEEP_ENV = new Set(["AX_CODE_TUI_NATIVE_CACHE_DIR", "AX_CODE_TUI_NATIVE_OFFLINE"])
for (const key of Object.keys(process.env)) {
  if (KEEP_ENV.has(key)) continue
  if (key.startsWith("AX_CODE_") || key.startsWith("OPENCODE_")) delete process.env[key]
}
const state = await fsp.mkdtemp(path.join(os.tmpdir(), "ax-code-history-scroll-anchor-"))
process.env.AX_CODE_TEST_HOME = state
process.env.XDG_CONFIG_HOME = path.join(state, "config")
process.env.XDG_DATA_HOME = path.join(state, "data")
process.env.XDG_STATE_HOME = path.join(state, "state")
process.env.XDG_CACHE_HOME = path.join(state, "cache")
process.env.AX_CODE_DISABLE_PROJECT_CONFIG = "true"
process.env.TZ = "UTC"
process.env.TERM = "xterm-256color"
process.env.COLORTERM = "truecolor"
delete process.env.TERM_PROGRAM
delete process.env.NO_COLOR
delete process.env.FORCE_COLOR

const { testRender } = await import("ax-tui/solid")
const { createSignal, For } = await import("solid-js")
const { captureScrollAnchor, restoreScrollAfterPrepend } = await import(
  "../src/cli/tui/routes/session/history-scroll-anchor"
)

import type { ScrollBoxRenderable } from "ax-tui"
import type { TestRendererSetup } from "ax-tui/testing"

const WIDTH = 80
const HEIGHT = 20
const INITIAL = 60
const PREPEND = 40

function fail(message: string): never {
  throw new Error(message)
}

function rowLabel(prefix: string, index: number) {
  return `${prefix}${index.toString().padStart(3, "0")}`
}

function makeRows(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => rowLabel(prefix, index))
}

/** First non-blank character row. The scrollbar is hidden so this is the transcript line. */
function firstVisibleLine(frame: string) {
  const line = frame.split("\n").find((entry) => entry.trim().length > 0) ?? ""
  return line.trimEnd()
}

function lastVisibleLine(frame: string) {
  const lines = frame.split("\n").filter((entry) => entry.trim().length > 0)
  return lines.at(-1)?.trimEnd() ?? ""
}

async function paint(setup: TestRendererSetup) {
  await setup.flush()
  await setup.renderOnce()
}

function pollingScheduler(setup: TestRendererSetup) {
  let pending = 0
  let failure: unknown
  const waiters: Array<() => void> = []
  const settle = () => {
    if (pending === 0) {
      for (const waiter of waiters.splice(0)) waiter()
    }
  }
  const schedule = (fn: () => void, delayMs: number) => {
    let settled = false
    pending++
    const finish = () => {
      if (settled) return
      settled = true
      pending--
      settle()
    }
    const timer = setTimeout(() => {
      void (async () => {
        try {
          await setup.renderOnce()
          fn()
        } catch (error) {
          failure = error
        } finally {
          finish()
        }
      })()
    }, delayMs)
    return () => {
      clearTimeout(timer)
      finish()
    }
  }
  const idle = () =>
    new Promise<void>((resolve, reject) => {
      const done = () => {
        if (failure) reject(failure)
        else resolve()
      }
      if (pending === 0) done()
      else waiters.push(done)
    })
  return { schedule, idle }
}

async function restore(
  setup: TestRendererSetup,
  scroll: ScrollBoxRenderable,
  anchor: ReturnType<typeof captureScrollAnchor>,
) {
  const scheduler = pollingScheduler(setup)
  restoreScrollAfterPrepend({
    scroll,
    anchor,
    isCurrent: () => true,
    schedule: scheduler.schedule,
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      scheduler.idle().then(() => "idle" as const),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), 3000)
      }),
    ])
    if (result === "timeout") fail("restore polling did not finish")
  } finally {
    if (timer) clearTimeout(timer)
  }
  await paint(setup)
}

function Transcript(props: { rows: string[]; onScroll: (scroll: ScrollBoxRenderable) => void }) {
  return (
    <box width="100%" height="100%" flexDirection="column">
      <scrollbox
        ref={props.onScroll}
        stickyScroll={true}
        stickyStart="bottom"
        flexGrow={1}
        minWidth={0}
        scrollbarOptions={{ visible: false }}
      >
        <For each={props.rows}>
          {(row) => (
            <text wrapMode="none" height={1} flexShrink={0}>
              {row}
            </text>
          )}
        </For>
      </scrollbox>
    </box>
  )
}

async function mount(rows: () => string[]) {
  let scroll: ScrollBoxRenderable | undefined
  const setup = await testRender(() => <Transcript rows={rows()} onScroll={(value) => (scroll = value)} />, {
    width: WIDTH,
    height: HEIGHT,
  })
  if (!scroll) {
    setup.renderer.destroy()
    fail("scrollbox did not mount")
  }
  return { setup, scroll }
}

let failed = false
try {
  const initial = makeRows("row", INITIAL)
  const last = initial.at(-1)!
  const [rows, setRows] = createSignal(initial)
  const middle = await mount(rows)
  try {
    await paint(middle.setup)
    const maxTop = Math.max(0, middle.scroll.scrollHeight - middle.scroll.viewport.height)
    if (maxTop < 4 || !middle.setup.captureCharFrame().includes(last)) {
      fail(
        `transcript did not overflow before the middle anchor\nscrollHeight=${middle.scroll.scrollHeight} viewport=${middle.scroll.viewport.height}\n${middle.setup.captureCharFrame()}`,
      )
    }
    middle.scroll.scrollTo(Math.floor(maxTop / 2))
    await paint(middle.setup)
    const anchor = captureScrollAnchor(middle.scroll)
    const before = firstVisibleLine(middle.setup.captureCharFrame())
    if (anchor.atBottom || !before.includes("row") || before.includes(last)) {
      fail(
        `middle anchor was not parked off the bottom\natBottom=${anchor.atBottom} top=${anchor.top} line=${before}\n${middle.setup.captureCharFrame()}`,
      )
    }
    setRows((current) => [...makeRows("pre", PREPEND), ...current])
    await restore(middle.setup, middle.scroll, anchor)
    const after = firstVisibleLine(middle.setup.captureCharFrame())
    if (middle.scroll.scrollHeight <= anchor.height) {
      fail(
        `prepend did not grow the transcript: before ${anchor.height} after ${middle.scroll.scrollHeight}\n${middle.setup.captureCharFrame()}`,
      )
    }
    if (after !== before) {
      fail(
        `middle restore lost the top row\nbefore: ${before}\nafter:  ${after}\nscrollTop=${middle.scroll.scrollTop} scrollHeight=${middle.scroll.scrollHeight}\n${middle.setup.captureCharFrame()}`,
      )
    }
    console.log(`middle anchor kept ${before.trim()} at the top`)
  } finally {
    middle.setup.renderer.destroy()
  }

  const [bottomRows, setBottomRows] = createSignal(initial)
  const bottom = await mount(bottomRows)
  try {
    await paint(bottom.setup)
    const maxTop = Math.max(0, bottom.scroll.scrollHeight - bottom.scroll.viewport.height)
    bottom.scroll.scrollTo(maxTop)
    await paint(bottom.setup)
    const anchor = captureScrollAnchor(bottom.scroll)
    if (!anchor.atBottom || !bottom.setup.captureCharFrame().includes(last)) {
      fail(
        `bottom anchor was not pinned\natBottom=${anchor.atBottom} top=${anchor.top} height=${anchor.height}\n${bottom.setup.captureCharFrame()}`,
      )
    }
    setBottomRows((current) => [...makeRows("pre", PREPEND), ...current])
    await restore(bottom.setup, bottom.scroll, anchor)
    const frame = bottom.setup.captureCharFrame()
    const bottomLine = lastVisibleLine(frame)
    if (bottom.scroll.scrollHeight <= anchor.height) {
      fail(`prepend did not grow the bottom-pinned transcript\n${frame}`)
    }
    if (!bottomLine.includes(last)) {
      fail(
        `sticky bottom lost the last row ${last}\nbottom: ${bottomLine}\nscrollTop=${bottom.scroll.scrollTop} scrollHeight=${bottom.scroll.scrollHeight}\n${frame}`,
      )
    }
    console.log(`sticky bottom kept ${last} on the last visible row`)
  } finally {
    bottom.setup.renderer.destroy()
  }
} catch (error) {
  failed = true
  console.error(error instanceof Error ? error.message : error)
} finally {
  await fsp.rm(state, { recursive: true, force: true })
}

if (failed) process.exit(1)
console.log("history scroll anchor: middle restore and sticky bottom passed")
process.exit(0)
