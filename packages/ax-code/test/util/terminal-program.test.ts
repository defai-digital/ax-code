import { describe, expect, test } from "vitest"
import { isGhosttyTerminal, resolveTuiAdvancedTerminal } from "../../src/util/terminal-program"

describe("Ghostty terminal identity", () => {
  test("detects TERM_PROGRAM and xterm-ghostty", () => {
    expect(isGhosttyTerminal({ TERM_PROGRAM: "ghostty" })).toBe(true)
    expect(isGhosttyTerminal({ TERM: "xterm-ghostty" })).toBe(true)
    expect(isGhosttyTerminal({ TERM_PROGRAM: "iTerm.app", TERM: "xterm-256color" })).toBe(false)
    expect(isGhosttyTerminal({})).toBe(false)
  })
})

describe("advanced TUI profile resolution", () => {
  test("explicit env wins over the Ghostty allowlist", () => {
    expect(resolveTuiAdvancedTerminal({ AX_CODE_TUI_ADVANCED_TERMINAL: "1" })).toBe(true)
    expect(resolveTuiAdvancedTerminal({ AX_CODE_TUI_ADVANCED_TERMINAL: "0", TERM_PROGRAM: "ghostty" })).toBe(false)
    expect(resolveTuiAdvancedTerminal({ AX_CODE_TUI_ADVANCED_TERMINAL: "false", TERM: "xterm-ghostty" })).toBe(false)
  })

  test("auto-enables only for Ghostty when the env is unset", () => {
    expect(resolveTuiAdvancedTerminal({ TERM_PROGRAM: "ghostty" })).toBe(true)
    expect(resolveTuiAdvancedTerminal({ TERM: "xterm-ghostty" })).toBe(true)
    expect(resolveTuiAdvancedTerminal({ TERM_PROGRAM: "WezTerm" })).toBe(false)
    expect(resolveTuiAdvancedTerminal({ TERM_PROGRAM: "iTerm.app" })).toBe(false)
    expect(resolveTuiAdvancedTerminal({})).toBe(false)
  })
})
