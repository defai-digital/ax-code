/**
 * User-facing terminal window/tab title (OSC 2 followed by OSC 1).
 *
 * Distinct from the machine process title in process-title.ts ("ax-code"):
 * that string is for ps/pgrep/tmux automatic-rename and Windows SetConsoleTitle.
 *
 * The tab follows Ghostty's rule for titles (say where and what, most specific
 * part last, because Ghostty and AkiTTY truncate the head of a long tab title)
 * and the item list Codex and Grok build theirs from (ADR-276):
 *
 *   AX-Code | <project directory> | <activity> | <session title>
 *
 * "AX-Code" always leads so the tab never shows the Node launcher ("node") or
 * a long argv. Items without a value are omitted. Entry (before the CLI graph
 * loads) claims "AX-Code | <cwd basename>"; the TUI then rewrites the title
 * only when a part changes. The tab never animates: Ghostty debounces title
 * writes by 75 ms, and the footer busy indicator (component/footer-animation)
 * and AkiTTY's OSC 771 sprite carry the motion. Do not re-add a per-frame tab
 * title.
 */

import path from "node:path"
import { titleSequence } from "@ax-code/akitty-sdk"

export const AX_CODE_TERMINAL_TITLE = "AX-Code"
export const AX_CODE_TERMINAL_TITLE_SEPARATOR = " | "
// Pending approval or question. ASCII so GNU Screen and plain tab bars keep it.
export const AX_CODE_TERMINAL_TITLE_ATTENTION_MARK = "[!]"
// AkiTTY stores 128 characters; most tab bars show far fewer.
export const AX_CODE_TERMINAL_TITLE_MAX_CHARS = 120
// Per-item caps (Codex: cwd 32, thread title 48; Grok: cwd 30, session 40).
export const AX_CODE_TERMINAL_TITLE_PART_MAX_CHARS = Object.freeze({
  project: 32,
  activity: 32,
  sessionTitle: 48,
})

const HELP_OR_VERSION = new Set(["-h", "--help", "-v", "--version"])

export type AxCodeTerminalTitleParts = Readonly<{
  /** Project directory basename. */
  project?: string
  /** Localized activity label (working, retrying, approval needed); omitted when idle. */
  activity?: string
  /** A permission or question is pending; prefixes the activity with the attention mark. */
  attention?: boolean
  /** Session title when it is not the default placeholder. */
  sessionTitle?: string
}>

function isTerminalTitleDisabled(env: NodeJS.ProcessEnv = process.env) {
  const value = env["AX_CODE_DISABLE_TERMINAL_TITLE"]
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on"
}

function executableBasename(argv0: string | undefined) {
  const value = argv0 ?? ""
  const parts = value.replaceAll("\\", "/").split("/")
  return parts[parts.length - 1] ?? ""
}

function userArgv(argv: string[]) {
  // Node: argv[0]=node, argv[1]=script, user args from 2.
  // POSIX branded short-argv: argv[0]=AX-Code, argv[1]=/dev/null, user args from 2.
  // Bundled/SEA: argv[0]=ax-code, user args from 1.
  const exe = executableBasename(argv[0])
  const lower = exe.toLowerCase()
  if (lower === "node" || lower === "node.exe") return argv.slice(2)
  if ((exe === "AX-Code" || exe === "AX-Code.exe") && argv[1] === "/dev/null") return argv.slice(2)
  return argv.slice(1)
}

/**
 * True unless help/version is requested or AX_CODE_DISABLE_TERMINAL_TITLE is
 * set. Subcommands keep the same short product token; do not try to tell
 * flags from positionals here (`--session <id>` is a TUI launch).
 */
export function shouldClaimAxCodeTerminalTitleAtEntry(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (isTerminalTitleDisabled(env)) return false
  const args = userArgv(argv)
  if (args.some((arg) => HELP_OR_VERSION.has(arg))) return false
  return true
}

// Control chars (BEL terminates the OSC sequence, ESC would break out of it)
// must never reach the terminal from a title payload.
const CONTROL_RE = /[\x00-\x1f\x7f-\x9f]/g
// Invisible formatting and bidi controls (the Trojan Source family) can
// reorder or hide title text that comes from model output or a project path.
// Same set Codex strips before OSC output.
const INVISIBLE_FORMAT_RE = /[­͏؜᠎​-‏‪-‮⁠-⁯︀-️﻿￹-￻\u{1bca0}-\u{1bca3}\u{e0100}-\u{e01ef}]/gu

/** GNU Screen is the output hop: STY is set only by Screen itself (tmux shares TERM=screen). */
export function isGnuScreenTerminalTitleTarget(env: NodeJS.ProcessEnv = process.env) {
  const sty = env["STY"]
  return typeof sty === "string" && sty.length > 0
}

function truncateTerminalTitlePart(value: string, max: number) {
  const chars = Array.from(value)
  if (chars.length <= max) return value
  return `${chars.slice(0, Math.max(0, max - 1)).join("")}…`
}

/**
 * Normalize untrusted title text into one bounded display line: control
 * characters become spaces, invisible formatting is removed, whitespace runs
 * collapse, and the result is capped at AX_CODE_TERMINAL_TITLE_MAX_CHARS.
 * GNU Screen truncates Unicode in OSC titles to a byte, which can turn a
 * visible character into a control byte and spill the title into the
 * terminal, so under Screen every non-ASCII character becomes "?".
 */
export function sanitizeAxCodeTerminalTitle(title: string, env: NodeJS.ProcessEnv = process.env) {
  let clean = title.replace(INVISIBLE_FORMAT_RE, "").replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim()
  // Truncation adds an ellipsis, which must also pass through Screen's ASCII fallback.
  clean = truncateTerminalTitlePart(clean, AX_CODE_TERMINAL_TITLE_MAX_CHARS)
  if (isGnuScreenTerminalTitleTarget(env)) {
    clean = Array.from(clean, (ch) => (ch.charCodeAt(0) < 0x80 ? ch : "?")).join("")
  }
  return clean
}

/**
 * "AX-Code | <project> | <activity> | <session title>", omitting empty items.
 * Every part is sanitized and truncated on its own so one long session title
 * cannot push the project or activity out of the title.
 */
export function composeAxCodeTerminalTitle(
  parts: AxCodeTerminalTitleParts = {},
  env: NodeJS.ProcessEnv = process.env,
): string {
  const part = (value: string | undefined, max: number) => {
    const clean = value ? sanitizeAxCodeTerminalTitle(value, env) : ""
    return clean ? truncateTerminalTitlePart(clean, max) : undefined
  }
  const activity = part(parts.activity, AX_CODE_TERMINAL_TITLE_PART_MAX_CHARS.activity)
  const items = [
    AX_CODE_TERMINAL_TITLE,
    part(parts.project, AX_CODE_TERMINAL_TITLE_PART_MAX_CHARS.project),
    parts.attention
      ? activity
        ? `${AX_CODE_TERMINAL_TITLE_ATTENTION_MARK} ${activity}`
        : AX_CODE_TERMINAL_TITLE_ATTENTION_MARK
      : activity,
    part(parts.sessionTitle, AX_CODE_TERMINAL_TITLE_PART_MAX_CHARS.sessionTitle),
  ].filter((item): item is string => typeof item === "string" && item.length > 0)
  return sanitizeAxCodeTerminalTitle(items.join(AX_CODE_TERMINAL_TITLE_SEPARATOR), env)
}

function currentDirectory() {
  // process.cwd() throws once the directory has been deleted under us.
  try {
    return process.cwd()
  } catch {
    return ""
  }
}

/** Title claimed at entry, before any session exists: "AX-Code | <cwd basename>". */
export function axCodeEntryTerminalTitle(cwd: string = currentDirectory(), env: NodeJS.ProcessEnv = process.env) {
  return composeAxCodeTerminalTitle({ project: cwd ? path.basename(cwd) : undefined }, env)
}

export function axCodeTerminalTitleSequence(
  title: string = AX_CODE_TERMINAL_TITLE,
  env: NodeJS.ProcessEnv = process.env,
) {
  // OSC 1 = icon/tab, OSC 2 = window. Do not use OSC 0: Apple Terminal.app
  // treats OSC 0 as "set window title and clear tab title", after which the
  // tab falls back to the job name ("node" for source-mode launches).
  // Finish every window-title update with an explicit tab title, including
  // the idle/clear frame, so the final request always names the tab itself.
  return titleSequence(sanitizeAxCodeTerminalTitle(title, env))
}

export function axCodeTerminalTitleClearSequence() {
  return axCodeTerminalTitleSequence("")
}

type TitleStream = {
  write: (chunk: string) => boolean
  writable?: boolean
  destroyed?: boolean
  isTTY?: boolean
}

export function claimAxCodeTerminalTitle(
  stream: TitleStream = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
  title: string = axCodeEntryTerminalTitle(currentDirectory(), env),
) {
  if (isTerminalTitleDisabled(env)) return false
  // Node leaves isTTY undefined on pipes and redirected files.
  if (stream.isTTY !== true) return false
  if (stream.writable === false || stream.destroyed) return false
  try {
    stream.write(axCodeTerminalTitleSequence(title, env))
    return true
  } catch {
    return false
  }
}
