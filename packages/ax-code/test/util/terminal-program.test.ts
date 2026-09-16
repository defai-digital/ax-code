import { describe, expect, test } from "vitest"
import { isGhosttyTerminal, isWindowsTerminal, resolveTuiAdvancedTerminal } from "../../src/util/terminal-program"

const directHosts: [string, NodeJS.ProcessEnv][] = [
  ["Ghostty program", { TERM_PROGRAM: "ghostty", TERM: "xterm-ghostty" }],
  ["Ghostty terminfo", { TERM: "xterm-ghostty" }],
  ["Windows Terminal PowerShell", { WT_SESSION: "terminal-session" }],
  ["Windows Terminal WSL", { WT_SESSION: "terminal-session", WSL_DISTRO_NAME: "Ubuntu", TERM: "xterm-256color" }],
  ["GNOME Terminal", { VTE_VERSION: "7802", TERM: "xterm-256color", COLORTERM: "truecolor" }],
  ["VTE xterm", { VTE_VERSION: "7600", TERM: "xterm" }],
]

describe("Ghostty terminal identity", () => {
  test("detects TERM_PROGRAM and xterm-ghostty", () => {
    expect(isGhosttyTerminal({ TERM_PROGRAM: "ghostty" })).toBe(true)
    expect(isGhosttyTerminal({ TERM: "xterm-ghostty" })).toBe(true)
    expect(isGhosttyTerminal({ TERM_PROGRAM: "iTerm.app", TERM: "xterm-256color" })).toBe(false)
    expect(isGhosttyTerminal({})).toBe(false)
  })
})

describe("advanced TUI profile resolution", () => {
  test.each(directHosts)("auto-enables a direct %s session", (_name, env) => {
    expect(resolveTuiAdvancedTerminal(env)).toBe(true)
    for (const value of ["0", "false", "off", " NO "]) {
      expect(resolveTuiAdvancedTerminal({ ...env, AX_CODE_TUI_ADVANCED_TERMINAL: value })).toBe(false)
    }
  })

  test.each(["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY", "MOSH_CONNECTION", "TMUX", "TMUX_PANE", "STY", "ZELLIJ"])(
    "does not trust inherited host identity through %s",
    (name) => {
      for (const [, env] of directHosts) {
        expect(resolveTuiAdvancedTerminal({ ...env, [name]: "active" })).toBe(false)
        expect(resolveTuiAdvancedTerminal({ ...env, [name]: "" })).toBe(true)
        for (const value of ["1", "true", "on", " YES "]) {
          expect(resolveTuiAdvancedTerminal({ ...env, [name]: "active", AX_CODE_TUI_ADVANCED_TERMINAL: value })).toBe(
            true,
          )
        }
      }
    },
  )

  test.each(["dumb", "linux", "vt100", "screen", "screen-256color", "screen.xterm-256color", "tmux-256color"])(
    "keeps TERM=%s compatible even with inherited host markers",
    (term) => {
      for (const [, env] of directHosts) {
        expect(resolveTuiAdvancedTerminal({ ...env, TERM: term })).toBe(false)
      }
    },
  )

  test.each(["vscode", "Apple_Terminal", "WezTerm", "iTerm.app", "tmux", "screen", "zellij", "unknown"])(
    "gives the current TERM_PROGRAM=%s priority over inherited markers",
    (termProgram) => {
      for (const [, env] of directHosts) {
        expect(resolveTuiAdvancedTerminal({ ...env, TERM_PROGRAM: termProgram })).toBe(false)
      }
    },
  )

  test("does not infer terminal identity from the OS, shell, or color depth", () => {
    for (const env of [
      {},
      { OS: "Windows_NT" },
      { WSL_DISTRO_NAME: "Ubuntu", TERM: "xterm-256color" },
      { SHELL: "/bin/bash", COLORTERM: "truecolor" },
      { TERM: "xterm-256color", COLORTERM: "24bit" },
      { WT_SESSION: "   " },
      { GNOME_TERMINAL_SCREEN: "/org/gnome/Terminal/screen/test" },
    ]) {
      expect(resolveTuiAdvancedTerminal(env)).toBe(false)
      expect(resolveTuiAdvancedTerminal({ ...env, AX_CODE_TUI_ADVANCED_TERMINAL: "1" })).toBe(true)
    }
  })

  test.each(["", "0", "-1", "7802beta", "0x1e7a", "7.8", "1e4", " 7802 ", "99999999999999999"])(
    "rejects invalid VTE_VERSION=%j",
    (version) => {
      expect(resolveTuiAdvancedTerminal({ VTE_VERSION: version, TERM: "xterm-256color" })).toBe(false)
    },
  )

  test("requires a matching VTE terminal type", () => {
    expect(resolveTuiAdvancedTerminal({ VTE_VERSION: "7802" })).toBe(false)
    expect(resolveTuiAdvancedTerminal({ VTE_VERSION: "7802", TERM: "ansi" })).toBe(false)
  })

  test("unset, empty, and unrecognized overrides retain automatic detection", () => {
    for (const value of [undefined, "", "auto", "invalid"]) {
      expect(resolveTuiAdvancedTerminal({ WT_SESSION: "session", AX_CODE_TUI_ADVANCED_TERMINAL: value })).toBe(true)
      expect(resolveTuiAdvancedTerminal({ TERM_PROGRAM: "Apple_Terminal", AX_CODE_TUI_ADVANCED_TERMINAL: value })).toBe(
        false,
      )
    }
  })
})

describe("Windows Terminal identity for color detection", () => {
  test("recognizes direct Windows and WSL sessions independently of profile overrides", () => {
    expect(isWindowsTerminal({ WT_SESSION: "session" })).toBe(true)
    expect(
      isWindowsTerminal({ WT_SESSION: "session", TERM: "xterm-256color", AX_CODE_TUI_ADVANCED_TERMINAL: "0" }),
    ).toBe(true)
    expect(isWindowsTerminal({})).toBe(false)
    expect(isWindowsTerminal({ WT_SESSION: " " })).toBe(false)
  })

  test("rejects inherited markers in nested, remote, and limited terminals", () => {
    for (const overrides of [
      { TERM_PROGRAM: "vscode" },
      { SSH_TTY: "/dev/pts/1" },
      { TMUX: "session" },
      { TERM: "dumb" },
    ]) {
      expect(isWindowsTerminal({ WT_SESSION: "session", ...overrides })).toBe(false)
    }
  })
})
