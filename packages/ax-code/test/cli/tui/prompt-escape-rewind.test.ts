import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import {
  DOUBLE_ESCAPE_REWIND_MS,
  escapeRewindDisarmKey,
  promptEscapeRewindIntent,
} from "../../../src/cli/tui/component/prompt/view-model"

const IDLE_SESSION = {
  keyName: "escape",
  hasDraft: false,
  onSessionRoute: true,
  sessionIdle: true,
} as const

describe("promptEscapeRewindIntent", () => {
  test("arms on the first idle escape without consuming it", () => {
    expect(
      promptEscapeRewindIntent({
        ...IDLE_SESSION,
        now: 1_000,
      }),
    ).toEqual({
      action: "arm",
      nextIdleEscapeAt: 1_000,
    })
  })

  test("fires rewind on a second idle escape within the window", () => {
    expect(
      promptEscapeRewindIntent({
        ...IDLE_SESSION,
        previousIdleEscapeAt: 1_000,
        now: 1_000 + DOUBLE_ESCAPE_REWIND_MS,
      }),
    ).toEqual({ action: "rewind" })
  })

  test("re-arms when the second escape arrives after the window expires", () => {
    expect(
      promptEscapeRewindIntent({
        ...IDLE_SESSION,
        previousIdleEscapeAt: 1_000,
        now: 1_001 + DOUBLE_ESCAPE_REWIND_MS,
      }),
    ).toEqual({
      action: "arm",
      nextIdleEscapeAt: 1_001 + DOUBLE_ESCAPE_REWIND_MS,
    })
  })

  test("passes through when a draft is present", () => {
    expect(
      promptEscapeRewindIntent({
        ...IDLE_SESSION,
        hasDraft: true,
        previousIdleEscapeAt: 1_000,
        now: 1_100,
      }),
    ).toEqual({ action: "passthrough" })
  })

  test("passes through while the session is busy", () => {
    expect(
      promptEscapeRewindIntent({
        ...IDLE_SESSION,
        sessionIdle: false,
        previousIdleEscapeAt: 1_000,
        now: 1_100,
      }),
    ).toEqual({ action: "passthrough" })
  })

  test("passes through off the session route", () => {
    expect(
      promptEscapeRewindIntent({
        ...IDLE_SESSION,
        onSessionRoute: false,
        previousIdleEscapeAt: 1_000,
        now: 1_100,
      }),
    ).toEqual({ action: "passthrough" })
  })

  test("resets the armed state on non-escape keys", () => {
    expect(
      promptEscapeRewindIntent({
        ...IDLE_SESSION,
        keyName: "a",
        previousIdleEscapeAt: 1_000,
        now: 1_100,
      }),
    ).toEqual({ action: "passthrough" })
  })
})

describe("escapeRewindDisarmKey", () => {
  test("only escape keeps the rewind window armed", () => {
    expect(escapeRewindDisarmKey("escape")).toBe(false)
    expect(escapeRewindDisarmKey("return")).toBe(true)
    expect(escapeRewindDisarmKey("a")).toBe(true)
    expect(escapeRewindDisarmKey("!")).toBe(true)
    expect(escapeRewindDisarmKey(undefined)).toBe(true)
  })

  // Regression: an armed rewind window survived keys that the prompt handler
  // consumes before reaching the escape-intent chain (e.g. Enter on an empty
  // prompt returns early in submit handling), so Esc → Enter → Esc within the
  // window opened the rollback dialog even though the escapes were not
  // consecutive. The disarm must run before any early-return consumer.
  test("prompt handler disarms the rewind window before any early-return consumption", async () => {
    const prompt = await fs.readFile(
      path.resolve(import.meta.dirname, "../../../src/cli/tui/component/prompt/index.tsx"),
      "utf8",
    )
    const disarm = prompt.indexOf("escapeRewindDisarmKey(e.name)")
    expect(disarm).toBeGreaterThan(-1)
    expect(disarm).toBeLessThan(prompt.indexOf("const pendingIntent = pendingSubmitKeyIntent({"))
    expect(disarm).toBeLessThan(prompt.indexOf("promptEscapeRewindIntent({"))
  })
})

describe("double-Esc draft-clear disarm", () => {
  // Regression: the draft-clear arm (lastDraftEscapeAt) was only written by the
  // escape-intent chain, so keys consumed before it (submit/cancel/block/paste)
  // left a stale arm: Esc -> Enter(submit) -> Esc(cancel) -> Esc within the
  // window cleared the whole draft even though the escapes were not
  // consecutive. Both escape arms must be disarmed by any non-escape key,
  // including submit keys the global handler consumes with stopPropagation
  // (which skips the textarea's own onKeyDown disarm).
  test("onKeyDown disarms the draft-clear arm alongside the rewind arm before early returns", async () => {
    const prompt = await fs.readFile(
      path.resolve(import.meta.dirname, "../../../src/cli/tui/component/prompt/index.tsx"),
      "utf8",
    )
    const disarm = prompt.indexOf("if (escapeRewindDisarmKey(e.name)) {")
    expect(disarm).toBeGreaterThan(-1)
    const block = prompt.slice(disarm, prompt.indexOf("}", disarm))
    expect(block).toContain("lastIdleEscapeAt = undefined")
    expect(block).toContain("lastDraftEscapeAt = undefined")
    expect(disarm).toBeLessThan(prompt.indexOf("const pendingIntent = pendingSubmitKeyIntent({"))
    expect(disarm).toBeLessThan(prompt.indexOf("promptEscapeClearIntent({"))
  })

  test("global submit handler disarms the draft-clear arm it would otherwise skip", async () => {
    const prompt = await fs.readFile(
      path.resolve(import.meta.dirname, "../../../src/cli/tui/component/prompt/index.tsx"),
      "utf8",
    )
    const start = prompt.indexOf("  useKeyboard((evt) => {")
    const end = prompt.indexOf("  const fileStyleId", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const handler = prompt.slice(start, end)
    expect(handler).toContain("lastDraftEscapeAt = undefined")
    expect(handler).toContain("lastIdleEscapeAt = undefined")
  })
})
