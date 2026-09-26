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
