import { test, expect } from "vitest"
import { createTestRenderer } from "@ax-code/opentui-core/testing"
import { TextareaRenderable } from "@ax-code/opentui-core"

// Regression coverage for the prompt's Enter handling.
//
// The prompt textarea is configured with `interceptEnter`, mapping the Enter
// family of keys to the textarea's no-op "submit" action so they never insert a
// newline; the real submission then runs from the prompt's global key handler
// (`isPromptSubmitKey`). Before the fix, only `return`/`linefeed` were covered,
// so the numeric-keypad Enter (`kpenter`, reported as a distinct key under the
// kitty keyboard protocol) fell through to OpenTUI's default `kpenter -> newline`
// binding: pressing it inserted a blank line and never submitted.

// Mirrors the intercept bindings produced by
// useTextareaKeybindings({ submit: false, interceptEnter: true }).
const interceptKeyBindings = [
  { name: "return", action: "submit" },
  { name: "linefeed", action: "submit" },
  { name: "kpenter", action: "submit" },
  // input_newline defaults — none of these is a bare Enter key.
  { name: "return", shift: true, action: "newline" },
  { name: "return", ctrl: true, action: "newline" },
  { name: "return", meta: true, action: "newline" },
  { name: "j", ctrl: true, action: "newline" },
] as const

// Mirrors isPromptSubmitKey() for an unmodified key.
function isPromptSubmitKey(name: string) {
  return name === "return" || name === "linefeed" || name === "kpenter"
}

async function setup() {
  const t = await createTestRenderer({ width: 40, height: 12, kittyKeyboard: true })
  const ta = new TextareaRenderable(t.renderer as any, { keyBindings: interceptKeyBindings as any })
  t.renderer.root.add(ta)
  let submits = 0
  t.renderer.keyInput.on("keypress", (e: any) => {
    if (e.ctrl || e.meta || e.shift || e.super || e.hyper) return
    if (!isPromptSubmitKey(e.name)) return
    e.preventDefault()
    e.stopPropagation()
    submits++
  })
  ta.focus()
  await t.flush()
  await t.mockInput.typeText("hello")
  await t.flush()
  return { t, ta, getSubmits: () => submits }
}

// Sends a bare keypad-Enter via the kitty keyboard protocol (CSI 57414 u).
function pressKeypadEnter(t: Awaited<ReturnType<typeof setup>>["t"]) {
  t.renderer.stdin.emit("data", Buffer.from("\x1b[57414u"))
}

test("keypad Enter submits instead of inserting a blank line", async () => {
  const { t, ta, getSubmits } = await setup()
  pressKeypadEnter(t)
  await t.flush()
  expect(ta.plainText).toBe("hello")
  expect(getSubmits()).toBe(1)
})

test("keypad Enter still submits when the draft already has trailing blank lines", async () => {
  const { t, ta, getSubmits } = await setup()
  t.mockInput.pressEnter({ shift: true } as any) // add a trailing newline (input_newline)
  await t.flush()
  expect(ta.plainText).toBe("hello\n")
  pressKeypadEnter(t)
  await t.flush()
  expect(ta.plainText).toBe("hello\n")
  expect(getSubmits()).toBe(1)
})

test("main Enter (return) keeps submitting without inserting a newline", async () => {
  const { t, ta, getSubmits } = await setup()
  t.mockInput.pressEnter()
  await t.flush()
  expect(ta.plainText).toBe("hello")
  expect(getSubmits()).toBe(1)
})
