import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { describe, expect, test } from "vitest"
import {
  AX_CODE_TERMINAL_TITLE,
  AX_CODE_TERMINAL_TITLE_MAX_CHARS,
  axCodeEntryTerminalTitle,
  axCodeTerminalTitleSequence,
  claimAxCodeTerminalTitle,
  composeAxCodeTerminalTitle,
  sanitizeAxCodeTerminalTitle,
  shouldClaimAxCodeTerminalTitleAtEntry,
} from "../../src/util/terminal-title"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const TITLE_SEQUENCE = "\x1b]2;AX-Code\x07\x1b]1;AX-Code\x07"
const NO_ENV: NodeJS.ProcessEnv = {}

function sequence(title: string) {
  return `\x1b]2;${title}\x07\x1b]1;${title}\x07`
}

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

  test("sanitizes control characters out of OSC payloads", () => {
    // Controls become spaces and whitespace runs collapse, so a BEL or ESC in a
    // session title can neither end the OSC sequence nor leave a ragged title.
    expect(sanitizeAxCodeTerminalTitle("AX-Code\x07 |\x1b evil\n", NO_ENV)).toBe("AX-Code | evil")
    expect(axCodeTerminalTitleSequence("a\x9bb\x80c", NO_ENV)).toBe(sequence("a b c"))
  })

  test("strips bidi and invisible formatting characters", () => {
    // Trojan Source style controls could reorder or hide title text that comes
    // from model output or a project path.
    expect(sanitizeAxCodeTerminalTitle("Pro‮j⁦e‏c؜t​ ﻿T⁠itle", NO_ENV)).toBe("Project Title")
  })

  test("caps the whole title and keeps Unicode outside GNU Screen", () => {
    const long = "字".repeat(AX_CODE_TERMINAL_TITLE_MAX_CHARS + 10)
    const capped = sanitizeAxCodeTerminalTitle(long, NO_ENV)
    expect(Array.from(capped)).toHaveLength(AX_CODE_TERMINAL_TITLE_MAX_CHARS)
    expect(capped.endsWith("…")).toBe(true)
    expect(sanitizeAxCodeTerminalTitle("日本語 café", NO_ENV)).toBe("日本語 café")
  })

  test("falls back to printable ASCII under GNU Screen", () => {
    // Screen truncates Unicode in OSC titles to a byte, which can turn a
    // visible character into a control byte and spill the title into the terminal.
    expect(sanitizeAxCodeTerminalTitle("日本語 café | AX-Code", { STY: "1234.pts-0.host" })).toBe("??? caf? | AX-Code")
    // tmux also uses TERM=screen but never sets STY, so it keeps Unicode.
    expect(sanitizeAxCodeTerminalTitle("café", { TERM: "screen" })).toBe("café")
  })

  test("keeps truncated GNU Screen titles printable ASCII", () => {
    const env = { STY: "1234.pts-0.host" }
    const long = "x".repeat(200)
    const title = sanitizeAxCodeTerminalTitle(long, env)
    expect(title).toMatch(/^[\x20-\x7e]+$/)
    expect(Array.from(title)).toHaveLength(AX_CODE_TERMINAL_TITLE_MAX_CHARS)
    expect(composeAxCodeTerminalTitle({ project: long, activity: long, sessionTitle: long }, env)).toMatch(
      /^[\x20-\x7e]+$/,
    )
    expect(axCodeTerminalTitleSequence(long, env)).toBe(sequence(title))
  })

  test("composes brand, project, activity and session title in that order", () => {
    expect(composeAxCodeTerminalTitle({}, NO_ENV)).toBe("AX-Code")
    expect(composeAxCodeTerminalTitle({ project: "ax-code" }, NO_ENV)).toBe("AX-Code | ax-code")
    expect(composeAxCodeTerminalTitle({ project: "ax-code", activity: "Working" }, NO_ENV)).toBe(
      "AX-Code | ax-code | Working",
    )
    expect(composeAxCodeTerminalTitle({ project: "ax-code", sessionTitle: "Fix tab title in AkiTTY" }, NO_ENV)).toBe(
      "AX-Code | ax-code | Fix tab title in AkiTTY",
    )
    expect(
      composeAxCodeTerminalTitle(
        { project: "ax-code", activity: "Working", sessionTitle: "Fix tab title in AkiTTY" },
        NO_ENV,
      ),
    ).toBe("AX-Code | ax-code | Working | Fix tab title in AkiTTY")
  })

  test("marks pending attention in the activity slot", () => {
    expect(
      composeAxCodeTerminalTitle(
        { project: "ax-code", activity: "Approval needed", attention: true, sessionTitle: "Fix tab title" },
        NO_ENV,
      ),
    ).toBe("AX-Code | ax-code | [!] Approval needed | Fix tab title")
    // Attention without a label still shows the mark.
    expect(composeAxCodeTerminalTitle({ attention: true }, NO_ENV)).toBe("AX-Code | [!]")
    // Idle sessions carry no activity item at all.
    expect(composeAxCodeTerminalTitle({ activity: "", attention: false, sessionTitle: "x" }, NO_ENV)).toBe(
      "AX-Code | x",
    )
  })

  test("truncates each part on its own so a long session title cannot push out the project", () => {
    const title = composeAxCodeTerminalTitle(
      {
        project: "a-very-long-project-directory-name-that-keeps-going",
        activity: "Working",
        sessionTitle: "Investigate why the terminal tab title only shows the product name in AkiTTY sessions",
      },
      NO_ENV,
    )
    expect(title).toBe(
      "AX-Code | a-very-long-project-directory-n… | Working | Investigate why the terminal tab title only sho…",
    )
    expect(Array.from(title).length).toBeLessThanOrEqual(AX_CODE_TERMINAL_TITLE_MAX_CHARS)
  })

  test("sanitizes every part before composing", () => {
    expect(composeAxCodeTerminalTitle({ project: "ax\x07code", sessionTitle: "  tidy\n\ttitle ‮ " }, NO_ENV)).toBe(
      "AX-Code | ax code | tidy title",
    )
    // Whitespace-only parts count as missing.
    expect(composeAxCodeTerminalTitle({ project: " \t", sessionTitle: "​" }, NO_ENV)).toBe("AX-Code")
  })

  test("entry title names the working directory before any session exists", () => {
    expect(axCodeEntryTerminalTitle("/Users/me/code/ax-code", NO_ENV)).toBe("AX-Code | ax-code")
    expect(axCodeEntryTerminalTitle("/", NO_ENV)).toBe("AX-Code")
    expect(axCodeEntryTerminalTitle("", NO_ENV)).toBe("AX-Code")
    // Default: the current working directory of this process.
    expect(axCodeEntryTerminalTitle(undefined, NO_ENV)).toBe(`AX-Code | ${path.basename(process.cwd())}`)
  })

  test("claims the title on a TTY-like stream and skips non-TTY or disabled", () => {
    const ok = captureStream()
    expect(claimAxCodeTerminalTitle(ok.stream, NO_ENV)).toBe(true)
    expect(ok.writes).toEqual([sequence(axCodeEntryTerminalTitle(process.cwd(), NO_ENV))])

    const explicit = captureStream()
    expect(claimAxCodeTerminalTitle(explicit.stream, NO_ENV, "AX-Code")).toBe(true)
    expect(explicit.writes).toEqual([TITLE_SEQUENCE])

    const piped = captureStream()
    expect(claimAxCodeTerminalTitle({ ...piped.stream, isTTY: false }, NO_ENV)).toBe(false)
    expect(piped.writes).toEqual([])

    const disabled = captureStream()
    expect(claimAxCodeTerminalTitle(disabled.stream, { AX_CODE_DISABLE_TERMINAL_TITLE: "1" })).toBe(false)
    expect(disabled.writes).toEqual([])
  })

  test.each([false, undefined])("does not claim a stream whose isTTY is %s", (isTTY) => {
    const capture = captureStream()
    expect(claimAxCodeTerminalTitle({ ...capture.stream, isTTY }, NO_ENV)).toBe(false)
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

    // POSIX launchers brand argv as "AX-Code /dev/null [user args]". /dev/null is
    // the main-script slot, not a user path, so help/version still suppress the title.
    const branded = ["/cache/ax-code/libexec/runtime-x/bin/AX-Code", "/dev/null"]
    expect(shouldClaimAxCodeTerminalTitleAtEntry(branded, {})).toBe(true)
    expect(shouldClaimAxCodeTerminalTitleAtEntry([...branded, "--continue"], {})).toBe(true)
    expect(shouldClaimAxCodeTerminalTitleAtEntry([...branded, "--help"], {})).toBe(false)
    expect(shouldClaimAxCodeTerminalTitleAtEntry([...branded, "-v"], {})).toBe(false)
  })

  test("TUI entries claim the title before loading the CLI graph", async () => {
    const tuiEntry = await readFile(path.join(repoRoot, "packages/ax-code/src/index-node-tui.ts"), "utf8")
    const compiledEntry = await readFile(path.join(repoRoot, "packages/ax-code/src/index-compiled.ts"), "utf8")
    const runner = await readFile(path.join(repoRoot, "script/node-ffi-runner.mjs"), "utf8")

    expect(tuiEntry).toContain("restoreAxCodeLaunchNodeOptions()")
    expect(tuiEntry).toContain("shouldClaimAxCodeTerminalTitleAtEntry")
    expect(tuiEntry).toContain("claimAxCodeTerminalTitle()")
    expect(tuiEntry).toContain("claimAxCodeForegroundTtyJob()")
    expect(tuiEntry.indexOf("restoreAxCodeLaunchNodeOptions()")).toBeLessThan(
      tuiEntry.indexOf('await import("./cli/boot")'),
    )
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
