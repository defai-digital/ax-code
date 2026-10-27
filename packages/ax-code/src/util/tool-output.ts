// Shared tool-output shaping helpers used by both the terminal TUI
// (src/cli/tui/routes/session) and the non-interactive `ax-code run`
// renderer (src/cli/cmd/run.ts). Keep this module dependency-free so the
// run path does not pull TUI-only imports.

// Parse a unified-diff string and return hunk/added/removed counts.
// Returns undefined when the input is empty or contains no hunks so
// callers can `<Show when={summary()}>` without rendering a noisy chip
// on binary/empty patches. File headers (`---` / `+++`) are excluded from
// the +/− tallies only outside a hunk: inside a hunk those prefixes are
// content (removing the SQL comment `-- note` renders as `--- note`).
// Hunk extent comes from the `@@ -a,b +c,d @@` line counts (b and d
// default to 1 when omitted); `\ No newline at end of file` consumes
// nothing.
export type DiffSummary = { hunks: number; added: number; removed: number }
export const diffSummary = (diff?: string): DiffSummary | undefined => {
  if (!diff) return undefined
  let hunks = 0
  let added = 0
  let removed = 0
  let oldRemaining = 0
  let newRemaining = 0
  const parseCount = (raw: string | undefined, fallback: number) => (raw === undefined ? fallback : Number(raw))
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      hunks++
      const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line)
      // Omitted counts default to 1 (`@@ -1 +1 @@`); an unparsed header
      // leaves the extent empty so later ---/+++ lines stay file headers.
      oldRemaining = header ? parseCount(header[1], 1) : 0
      newRemaining = header ? parseCount(header[2], 1) : 0
      continue
    }
    const inHunk = oldRemaining > 0 || newRemaining > 0
    if (inHunk) {
      if (line.startsWith("\\")) continue
      if (line.startsWith("+")) {
        added++
        if (newRemaining > 0) newRemaining--
        continue
      }
      if (line.startsWith("-")) {
        removed++
        if (oldRemaining > 0) oldRemaining--
        continue
      }
      // Context line (or its empty stand-in): feeds both sides.
      if (oldRemaining > 0) oldRemaining--
      if (newRemaining > 0) newRemaining--
      continue
    }
    if (line.startsWith("+++") || line.startsWith("---")) continue
    else if (line.startsWith("+")) added++
    else if (line.startsWith("-")) removed++
  }
  // A context-only or empty patch (hunk headers but no +/- content) carries
  // no signal worth surfacing — suppress so we don't render "1 hunks · +0 −0".
  if (added === 0 && removed === 0) return undefined
  return { hunks, added, removed }
}

export const formatDiffSummary = (summary: DiffSummary) =>
  `${summary.hunks} ${summary.hunks === 1 ? "hunk" : "hunks"} · +${summary.added} −${summary.removed}`

// Hard cap for expanded tool-output rendering. Write input content is not
// server-truncated, so a multi-MB write would otherwise split and render in
// full and stall the transcript. `total` always reports the full line count
// so callers can show a "… truncated, N lines total" affordance.
export const EXPANDED_OUTPUT_MAX_LINES = 500

export const capLines = (
  lines: string[],
  max = EXPANDED_OUTPUT_MAX_LINES,
): { text: string; total: number; truncated: boolean } => {
  const total = lines.length
  if (total <= max) return { text: lines.join("\n"), total, truncated: false }
  return { text: lines.slice(0, max).join("\n"), total, truncated: true }
}

// Concise preview cap for the non-interactive `ax-code run` renderer. Command
// output and error text surface the tail (failures cluster at the end), not
// the head, so a passing prelude never hides a failing epilogue.
export const CLI_CONCISE_MAX_LINES = 50

export const tailLines = (
  text: string,
  max = CLI_CONCISE_MAX_LINES,
): { text: string; total: number; truncated: boolean } => {
  const lines = text.split("\n")
  // A trailing newline produces a phantom "" element; drop it so it neither
  // counts toward the budget nor displaces a real line from the preview.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop()
  const total = lines.length
  if (total <= max) return { text: lines.join("\n"), total, truncated: false }
  return { text: lines.slice(total - max).join("\n"), total, truncated: true }
}
