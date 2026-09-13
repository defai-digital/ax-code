/**
 * User-facing terminal window/tab title (OSC 2 followed by OSC 1).
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

// Busy-tab activity glyph: a 6-column by 4-row dot matrix (three full 8-dot
// braille cells). The pattern cycles through the letters of "AX-CODE" — one
// glyph at a time, held for a few frames — and morphs between them one dot
// flip per frame, so a busy session quietly spells out the brand in the tab
// and in the footer. Unlike Codex's perimeter 2x3 spinner.
const TITLE_GLYPH_ROWS = 4
const TITLE_GLYPH_COLUMNS = 6

// Glyphs drawn as #/. row-major in the 6x4 matrix. Four dot rows is the most
// that fits a single terminal row (a braille cell is 2x4), so rounded letters
// share strokes rather than getting a taller grid.
const TITLE_GLYPH_A = [".####.", "#....#", "######", "#....#"]
const TITLE_GLYPH_X = ["#....#", "..##..", "..##..", "#....#"]
const TITLE_GLYPH_HYPHEN = ["......", "......", ".####.", "......"]
const TITLE_GLYPH_C = [".####.", "#.....", "#.....", ".####."]
const TITLE_GLYPH_O = [".####.", "#....#", "#....#", ".####."]
const TITLE_GLYPH_D = ["#####.", "#....#", "#....#", "#####."]
const TITLE_GLYPH_E = ["######", "#.....", "#####.", "######"]

// "AX-CODE", one glyph per position, in reading order.
const TITLE_GLYPH_WORD = [
  TITLE_GLYPH_A,
  TITLE_GLYPH_X,
  TITLE_GLYPH_HYPHEN,
  TITLE_GLYPH_C,
  TITLE_GLYPH_O,
  TITLE_GLYPH_D,
  TITLE_GLYPH_E,
]

// Frames each glyph is held before the next morph begins.
const TITLE_GLYPH_DWELL_FRAMES = 3

// Braille dot bit for a (row, column-within-a-2x4-cell) coordinate.
function brailleDotBit(row: number, column: number): number {
  if (row === 3) return column === 0 ? 0x40 : 0x80
  return (column === 0 ? 0x01 : 0x08) << row
}

function titleGlyphDots(rows: readonly string[]): Set<number> {
  const dots = new Set<number>()
  rows.forEach((row, r) => {
    for (let c = 0; c < TITLE_GLYPH_COLUMNS; c++) {
      if (row.charAt(c) === "#") dots.add(r * TITLE_GLYPH_COLUMNS + c)
    }
  })
  return dots
}

function encodeTitleGlyph(dots: ReadonlySet<number>): string {
  let glyph = ""
  for (let cell = 0; cell < TITLE_GLYPH_COLUMNS / 2; cell++) {
    let mask = 0
    for (let r = 0; r < TITLE_GLYPH_ROWS; r++) {
      for (let c = 0; c < 2; c++) {
        if (dots.has(r * TITLE_GLYPH_COLUMNS + cell * 2 + c)) mask |= brailleDotBit(r, c)
      }
    }
    glyph += String.fromCharCode(0x2800 + mask)
  }
  return glyph
}

// Frame path: hold each glyph, then morph to the next one dot at a time.
// Consecutive frames differ by at most one dot, so the spelling reads as one
// travelling change rather than a redraw. The last morph lands back on the
// first glyph, so the cycle repeats seamlessly.
function titleGlyphMorphFrames(): string[] {
  const glyphs = TITLE_GLYPH_WORD.map(titleGlyphDots)
  const frames: string[] = []
  for (let i = 0; i < glyphs.length; i++) {
    const current = glyphs[i]!
    const next = glyphs[(i + 1) % glyphs.length]!
    for (let hold = 0; hold < TITLE_GLYPH_DWELL_FRAMES; hold++) frames.push(encodeTitleGlyph(current))
    const morph = new Set(current)
    for (const dot of [...current].filter((dot) => !next.has(dot))) {
      morph.delete(dot)
      frames.push(encodeTitleGlyph(morph))
    }
    for (const dot of [...next].filter((dot) => !current.has(dot))) {
      morph.add(dot)
      frames.push(encodeTitleGlyph(morph))
    }
  }
  return frames
}

export const AX_CODE_TITLE_SPINNER_FRAMES = titleGlyphMorphFrames()

// 77 frames (7 glyphs x 3 dwell + 56 morphs) spell AX-CODE in ~5.4s.
export const AX_CODE_TITLE_SPINNER_INTERVAL_MS = 70

export function composeAxCodeTerminalTitle(input: { working: boolean; frame?: number }) {
  if (!input.working) return AX_CODE_TERMINAL_TITLE
  const frames = AX_CODE_TITLE_SPINNER_FRAMES
  const glyph = frames[(input.frame ?? 0) % frames.length]
  return `${glyph} ${AX_CODE_TERMINAL_TITLE}`
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
export function sanitizeAxCodeTerminalTitle(title: string) {
  return title.replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
}

export function axCodeTerminalTitleSequence(title: string = AX_CODE_TERMINAL_TITLE) {
  const sanitized = sanitizeAxCodeTerminalTitle(title)
  // OSC 1 = icon/tab, OSC 2 = window. Do not use OSC 0: Apple Terminal.app
  // treats OSC 0 as "set window title and clear tab title", after which the
  // tab falls back to the job name ("node" for source-mode launches).
  // Finish every window-title update with an explicit tab title, including
  // the idle/clear frame, so the final request always names the tab itself.
  return `\x1b]2;${sanitized}\x07\x1b]1;${sanitized}\x07`
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
  // Node leaves isTTY undefined on pipes and redirected files.
  if (stream.isTTY !== true) return false
  if (stream.writable === false || stream.destroyed) return false
  try {
    stream.write(axCodeTerminalTitleSequence(title))
    return true
  } catch {
    return false
  }
}
