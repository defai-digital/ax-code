export const SESSION_TOOL_RENDERER_KEYS = [
  "bash",
  "glob",
  "read",
  "grep",
  "list",
  "webfetch",
  "codesearch",
  "websearch",
  "write",
  "edit",
  "task",
  "council",
  "arena",
  "apply_patch",
  "todowrite",
  "question",
  "skill",
  "refactor_plan",
  "refactor_apply",
  "impact_analyze",
  "dedup_scan",
  "schedule_task",
  "generic",
] as const

export type SessionToolRendererKey = (typeof SESSION_TOOL_RENDERER_KEYS)[number]

const SPECIALIZED_TOOL_RENDERERS = new Set<string>(SESSION_TOOL_RENDERER_KEYS.filter((key) => key !== "generic"))

export function isKnownSessionToolRenderer(tool: string): tool is Exclude<SessionToolRendererKey, "generic"> {
  return SPECIALIZED_TOOL_RENDERERS.has(tool)
}

export function sessionToolRendererKey(tool: string): SessionToolRendererKey {
  return isKnownSessionToolRenderer(tool) ? tool : "generic"
}

export function coalescedToolLabel(tool: string, count: number): string {
  if (tool === "read") return `Read · ${count} files`
  if (tool === "list") return `List · ${count} directories`
  if (tool === "glob") return `Glob · ${count} searches`
  if (tool === "grep") return `Grep · ${count} searches`
  return `${tool} · ${count}`
}

// Completed calls that stay rendered while "tool details" is toggled off.
// Edits and shell commands are the surface the user reviews; hiding them
// would make a whole turn's work invisible.
const DETAILS_OFF_VISIBLE_TOOLS = new Set(["edit", "write", "apply_patch", "bash"])

/** Whether a completed tool call is hidden while "tool details" is off. */
export function hidesCompletedToolWhenDetailsOff(tool: string): boolean {
  return !DETAILS_OFF_VISIBLE_TOOLS.has(tool)
}

// A bash call keeps ONE row shape. As soon as the tool has published a live
// snapshot (it publishes an empty one from the first tick) the card renders in
// its final block shape and the output window fills in, so completion only
// stops the spinner. The old rule kept a one-liner while running and swapped in
// a block at completion, which shifted everything below by the block's chrome
// (border, padding, margin) at the end of every command. Kimi Code caps a block
// before it grows; see .internal/reports/2026-09-26-tui-transcript-stability-plan.md.
export function bashDisplayMode(input: { hasOutput: boolean }): "inline" | "block" {
  return input.hasOutput ? "block" : "inline"
}

/** Rows the running bash card shows from the newest output. */
export const BASH_LIVE_WINDOW_LINES = 10

/**
 * Newest-output window for a running bash call. The tool publishes a tail
 * snapshot past its metadata cap, so the window is the newest lines either way;
 * `hidden` counts the snapshot lines above the window.
 */
export function bashLiveWindow(lines: readonly string[]): { text: string; hidden: number } {
  if (lines.length <= BASH_LIVE_WINDOW_LINES) return { text: lines.join("\n"), hidden: 0 }
  return {
    text: lines.slice(-BASH_LIVE_WINDOW_LINES).join("\n"),
    hidden: lines.length - BASH_LIVE_WINDOW_LINES,
  }
}

/**
 * Gutter the finished block-tool title uses to line up with the spinner's
 * text column. The running row paints [1-cell glyph][1-cell gap] before the
 * title, so the finished title needs the same inset once the glyph is gone.
 */
export const TOOL_TITLE_GLYPH_GUTTER = 2

/**
 * Strips the leading markdown heading marker ("# ") from a block tool title.
 * Both the spinner row and the finished title row render this text so the
 * title never shifts when the spinner stops.
 */
export function toolTitleText(title: string): string {
  return title.replace(/^# /, "")
}

/** Rewritten calls must remain visible even when ordinary tool details are folded. */
export function hasHookRewrite(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || !("hookRewrite" in metadata)) return false
  const record = metadata.hookRewrite
  return !!record && typeof record === "object" && "hooks" in record && Array.isArray(record.hooks)
}
