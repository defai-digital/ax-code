import { describe, expect, test } from "vitest"
import { detectNerdFontTerminal, resolveNerdFontEnabled } from "@/cli/cmd/tui/ui/glyphs"

// Guards the wiring restored in autocomplete.tsx (finding #31): the glyph
// consumer must pass `kv` WITHOUT a default and a `detected` value so
// terminal auto-detection (priority 3) is reachable. The previous
// `kv.get(KEY, false)` made kv always-defined, shadowing detection.
describe("nerd font terminal auto-detection priority", () => {
  test("detected wins when env and kv are both unset", () => {
    expect(resolveNerdFontEnabled({ env: undefined, kv: undefined, detected: true })).toBe(true)
  })

  test("explicit kv=false suppresses detection", () => {
    // This is what the OLD buggy default (kv.get(KEY, false)) produced,
    // and why detection never fired.
    expect(resolveNerdFontEnabled({ env: undefined, kv: false, detected: true })).toBe(false)
  })

  test("env override beats both kv and detection", () => {
    expect(resolveNerdFontEnabled({ env: false, kv: true, detected: true })).toBe(false)
    expect(resolveNerdFontEnabled({ env: true, kv: false, detected: false })).toBe(true)
  })

  test("falls back to false when nothing is set", () => {
    expect(resolveNerdFontEnabled({ env: undefined, kv: undefined, detected: undefined })).toBe(false)
  })
})

describe("detectNerdFontTerminal", () => {
  test("kitty term is detected", () => {
    expect(detectNerdFontTerminal({ term: "xterm-kitty" })).toBe(true)
  })

  test("WezTerm and ghostty term programs are detected", () => {
    expect(detectNerdFontTerminal({ termProgram: "WezTerm" })).toBe(true)
    expect(detectNerdFontTerminal({ termProgram: "ghostty" })).toBe(true)
  })

  test("unknown terminals are not detected", () => {
    expect(detectNerdFontTerminal({ termProgram: "iTerm.app", term: "xterm-256color" })).toBe(false)
    expect(detectNerdFontTerminal({})).toBe(false)
  })
})
