/**
 * User-facing terminal tab/window title (OSC 0).
 *
 * Distinct from the machine process title in process-title.ts ("ax-code"):
 * that string is for ps/pgrep/tmux automatic-rename and Windows SetConsoleTitle.
 * The tab the user reads is this short product token. Grok falls back to "grok"
 * and Kimi to "Kimi Code"; AX Code keeps a single static "AX-Code" so the tab
 * never shows the Node launcher ("node") or a long argv / session-title string.
 *
 * Written at TUI entry (before the CLI module graph loads) and again from the
 * TUI once it mounts, so the tab is claimed within milliseconds of exec.
 */

export const AX_CODE_TERMINAL_TITLE = "AX-Code"

// Busy-tab activity glyph. Codex prefixes a 10-frame braille spinner
// (`⠋⠙⠹⠸…`) at 100ms; AX Code keeps the product name first and uses a
// slower 4-frame orbit so truncated tabs still read "AX-Code".
export const AX_CODE_TITLE_SPINNER_FRAMES = ["◜", "◝", "◞", "◟"] as const
export const AX_CODE_TITLE_SPINNER_INTERVAL_MS = 180

export function composeAxCodeTerminalTitle(input: { working: boolean; frame?: number }) {
  if (!input.working) return AX_CODE_TERMINAL_TITLE
  const frames = AX_CODE_TITLE_SPINNER_FRAMES
  const glyph = frames[(input.frame ?? 0) % frames.length]
  return `${AX_CODE_TERMINAL_TITLE} ${glyph}`
}

const HELP_OR_VERSION = new Set(["-h", "--help", "-v", "--version"])

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
  // Bundled/SEA: argv[0]=ax-code, user args from 1.
  const exe = executableBasename(argv[0]).toLowerCase()
  if (exe === "node" || exe === "node.exe") return argv.slice(2)
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
export function sanitizeAxCodeTerminalTitle(title: string) {
  return title.replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
}

export function axCodeTerminalTitleSequence(title: string = AX_CODE_TERMINAL_TITLE) {
  const sanitized = sanitizeAxCodeTerminalTitle(title)
  // OSC 1 = icon/tab, OSC 2 = window. Do not use OSC 0: Apple Terminal.app
  // treats OSC 0 as "set window title and clear tab title", after which the
  // tab falls back to the job name ("node" for source-mode launches).
  return `\x1b]1;${sanitized}\x07\x1b]2;${sanitized}\x07`
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
  title: string = AX_CODE_TERMINAL_TITLE,
) {
  if (isTerminalTitleDisabled(env)) return false
  if (stream.isTTY === false) return false
  if (stream.writable === false || stream.destroyed) return false
  try {
    stream.write(axCodeTerminalTitleSequence(title))
    return true
  } catch {
    return false
  }
}
