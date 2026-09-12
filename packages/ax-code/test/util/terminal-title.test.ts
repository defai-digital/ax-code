import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { describe, expect, test } from "vitest"
import {
  AX_CODE_TERMINAL_TITLE,
  AX_CODE_TITLE_SPINNER_FRAMES,
  axCodeTerminalTitleSequence,
  claimAxCodeTerminalTitle,
  composeAxCodeTerminalTitle,
  sanitizeAxCodeTerminalTitle,
  shouldClaimAxCodeTerminalTitleAtEntry,
} from "../../src/util/terminal-title"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const TITLE_SEQUENCE = "\x1b]2;AX-Code\x07\x1b]1;AX-Code\x07"

function captureStream(writes: string[] = []) {
  return {
    writes,
    stream: {
      writable: true,
      isTTY: true,
      write(chunk: string) {
        writes.push(chunk)
        return true
      },
    },
  }
}

describe("terminal title", () => {
  test("product token is the short AX-Code tab label", () => {
    expect(AX_CODE_TERMINAL_TITLE).toBe("AX-Code")
    expect(axCodeTerminalTitleSequence()).toBe(TITLE_SEQUENCE)
    expect(axCodeTerminalTitleSequence("AX-Code")).toBe(TITLE_SEQUENCE)
    // Apple Terminal.app clears the tab on OSC 0 and then shows the job name.
    expect(axCodeTerminalTitleSequence()).not.toContain("]0;")
  })

  test("busy titles cycle the AX-CODE dot-matrix morph before AX-Code", () => {
    expect(composeAxCodeTerminalTitle({ working: false })).toBe("AX-Code")
    expect(composeAxCodeTerminalTitle({ working: true, frame: 0 })).toBe("⡮⠭⢵ AX-Code") // A
    expect(AX_CODE_TITLE_SPINNER_FRAMES).toHaveLength(77)
    for (const frame of AX_CODE_TITLE_SPINNER_FRAMES) {
      expect([...frame]).toHaveLength(3)
    }
    // Every glyph of "AX-CODE" appears somewhere in the cycle.
    for (const glyph of ["⡮⠭⢵", "⡁⠶⢈", "⠠⠤⠄", "⢎⣉⡁", "⢎⣉⡱", "⣏⣉⡱", "⣯⣭⣍"]) {
      expect(AX_CODE_TITLE_SPINNER_FRAMES).toContain(glyph)
    }
  })

  test("holds each glyph and flips at most one dot per frame", () => {
    const frames = AX_CODE_TITLE_SPINNER_FRAMES
    for (let i = 0; i < frames.length; i++) {
      const current = frames[i] ?? ""
      const next = frames[(i + 1) % frames.length] ?? ""
      const changed = [0, 1, 2].filter((cell) => current.charCodeAt(cell) !== next.charCodeAt(cell))
      expect(changed.length).toBeLessThanOrEqual(1)
      if (changed.length === 1) {
        const xor = current.charCodeAt(changed[0] ?? 0) ^ next.charCodeAt(changed[0] ?? 0)
        // One braille dot == exactly one bit in the cell's 8-dot mask.
        expect(xor).toBeGreaterThan(0)
        expect(xor & (xor - 1)).toBe(0)
      }
    }
  })

  test("sanitizes control characters out of OSC payloads", () => {
    expect(sanitizeAxCodeTerminalTitle("AX-Code\x07 |\x1b evil\n")).toBe("AX-Code  |  evil ")
    expect(axCodeTerminalTitleSequence("a\x9bb\x80c")).toBe("\x1b]2;a b c\x07\x1b]1;a b c\x07")
  })

  test("claims the title on a TTY-like stream and skips non-TTY or disabled", () => {
    const ok = captureStream()
    expect(claimAxCodeTerminalTitle(ok.stream, {})).toBe(true)
    expect(ok.writes).toEqual([TITLE_SEQUENCE])

    const piped = captureStream()
    expect(claimAxCodeTerminalTitle({ ...piped.stream, isTTY: false }, {})).toBe(false)
    expect(piped.writes).toEqual([])

    const disabled = captureStream()
    expect(claimAxCodeTerminalTitle(disabled.stream, { AX_CODE_DISABLE_TERMINAL_TITLE: "1" })).toBe(false)
    expect(disabled.writes).toEqual([])
  })

  test.each([false, undefined])("does not claim a stream whose isTTY is %s", (isTTY) => {
    const capture = captureStream()
    expect(claimAxCodeTerminalTitle({ ...capture.stream, isTTY }, {})).toBe(false)
    expect(capture.writes).toEqual([])
  })

  test("keeps actual piped Node stdout parseable without terminal control sequences", () => {
    const module = pathToFileURL(path.join(repoRoot, "packages/ax-code/src/util/terminal-title.ts")).href
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `import { claimAxCodeTerminalTitle } from ${JSON.stringify(module)}; claimAxCodeTerminalTitle(process.stdout, {}); process.stdout.write('{"ok":true}');`,
      ],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 10_000 },
    )
    expect(child.status, child.stderr).toBe(0)
    expect(child.stdout).toBe('{"ok":true}')
  })

  test("claims at entry for TUI launches, not for help/version or the disable flag", () => {
    const node = ["/usr/bin/node", "/repo/packages/ax-code/src/index-node-tui.ts"]
    const bundled = ["/usr/local/bin/ax-code"]

    expect(shouldClaimAxCodeTerminalTitleAtEntry(node, {})).toBe(true)
    expect(shouldClaimAxCodeTerminalTitleAtEntry([...node, "--continue"], {})).toBe(true)
    expect(shouldClaimAxCodeTerminalTitleAtEntry([...node, "--fork", "--session", "ses_1"], {})).toBe(true)
    expect(shouldClaimAxCodeTerminalTitleAtEntry([...node, "."], {})).toBe(true)
    expect(shouldClaimAxCodeTerminalTitleAtEntry(bundled, {})).toBe(true)
    expect(shouldClaimAxCodeTerminalTitleAtEntry([...bundled, "run", "hello"], {})).toBe(true)

    expect(shouldClaimAxCodeTerminalTitleAtEntry([...node, "--help"], {})).toBe(false)
    expect(shouldClaimAxCodeTerminalTitleAtEntry([...bundled, "-v"], {})).toBe(false)
    expect(shouldClaimAxCodeTerminalTitleAtEntry(node, { AX_CODE_DISABLE_TERMINAL_TITLE: "true" })).toBe(false)
  })

  test("TUI entries claim the title before loading the CLI graph", async () => {
    const tuiEntry = await readFile(path.join(repoRoot, "packages/ax-code/src/index-node-tui.ts"), "utf8")
    const compiledEntry = await readFile(path.join(repoRoot, "packages/ax-code/src/index-compiled.ts"), "utf8")
    const runner = await readFile(path.join(repoRoot, "script/node-ffi-runner.mjs"), "utf8")

    expect(tuiEntry).toContain("shouldClaimAxCodeTerminalTitleAtEntry")
    expect(tuiEntry).toContain("claimAxCodeTerminalTitle()")
    expect(tuiEntry).toContain("claimAxCodeForegroundTtyJob()")
    expect(tuiEntry.indexOf("claimAxCodeTerminalTitle()")).toBeLessThan(tuiEntry.indexOf('await import("./cli/boot")'))
    expect(tuiEntry.indexOf("claimAxCodeForegroundTtyJob()")).toBeLessThan(
      tuiEntry.indexOf('await import("./cli/boot")'),
    )

    expect(compiledEntry).toContain("shouldClaimAxCodeTerminalTitleAtEntry")
    expect(compiledEntry).toContain("claimAxCodeTerminalTitle()")
    expect(compiledEntry).toContain("claimAxCodeForegroundTtyJob()")
    expect(compiledEntry.indexOf("claimAxCodeTerminalTitle()")).toBeLessThan(compiledEntry.indexOf("hooks()"))

    expect(runner).toContain("axCodeJobTitleOsc")
    expect(runner).toContain("resolveBrandedNodePath")
    expect(runner).toContain("brandedSpawnOptions")
  })
})
