// Home layout math: the bottom status bar (workspace · MCP/status · version)
// and the compact header row (heading · model chip · Sessions) shown when the
// terminal is short. The mode chips used to be a segment here; they now live
// in the prompt footer (see ModeChips / Prompt `footerRight`).
// Keep this isolated from component modules so width calculations stay testable
// and low-dependency, mirroring prompt/footer-layout.ts.

import { stringWidth } from "@/bun/node-compat"
import { truncateToCellWidth } from "./session/last-input-view-model"

// Rows sit inside boxes with paddingLeft/paddingRight of 2 and separate their
// segments by 2 columns.
const ROW_PADDING = 4
const ROW_GAP = 2
const AGENT_SEPARATOR = " · "

export type HomeStatusBarLayout = {
  stacked: boolean
}

/** Width of the MCP status group ("● N MCP" + gap + "/status"). */
export function homeStatusBarMcpWidth(connectedCount: number) {
  return 2 + String(connectedCount).length + 4 + 1 + "/status".length
}

/**
 * Stack the bar vertically when the segments no longer fit on one line.
 * Zero-width segments are hidden, so they contribute neither width nor gap.
 */
export function homeStatusBarLayout(input: { terminalWidth: number; segmentWidths: number[] }): HomeStatusBarLayout {
  const visible = input.segmentWidths.filter((width) => width > 0)
  const required =
    ROW_PADDING + visible.reduce((sum, width) => sum + width, 0) + ROW_GAP * Math.max(0, visible.length - 1)
  return { stacked: required > input.terminalWidth }
}

/** Abbreviated workspace label: the final path segment, branch suffix kept. */
export function homeWorkspaceLabel(directory: string) {
  const trimmed = directory.replace(/[\\/]+$/, "")
  return trimmed.split(/[\\/]/).at(-1) || directory
}

export type HomeStatusBarPlan = {
  /** Workspace segment to render: the full path, or the abbreviated label. */
  workspace: string
  /** Version is the least essential segment; drop it before stacking. */
  showVersion: boolean
  stacked: boolean
}

/**
 * Keep the status bar on one row: prefer the full path, then the abbreviated
 * project label, then drop the version; stack only the essentials last.
 */
export function homeStatusBarPlan(input: {
  terminalWidth: number
  directory: string
  mcpWidth: number
  versionWidth: number
}): HomeStatusBarPlan {
  const inline = (segmentWidths: number[]) =>
    !homeStatusBarLayout({ terminalWidth: input.terminalWidth, segmentWidths }).stacked
  const label = homeWorkspaceLabel(input.directory)
  if (inline([stringWidth(input.directory), input.mcpWidth, input.versionWidth]))
    return { workspace: input.directory, showVersion: true, stacked: false }
  if (inline([stringWidth(label), input.mcpWidth, input.versionWidth]))
    return { workspace: label, showVersion: true, stacked: false }
  if (inline([stringWidth(label), input.mcpWidth])) return { workspace: label, showVersion: false, stacked: false }
  // Nothing fits one row: stack the essentials, clamped so the label itself
  // cannot wrap its own row.
  return {
    workspace: truncateToCellWidth(label, input.terminalWidth - ROW_PADDING),
    showVersion: false,
    stacked: true,
  }
}

export type HomeCompactHeaderPlan = {
  /** The agent prefix is dropped first; the model chip and Sessions stay. */
  showAgent: boolean
  model: string
  sessions: string
}

/**
 * Budget for the compact header row: the heading on the left, the clickable
 * model chip and Sessions action on the right. A long model id truncates so
 * both affordances stay visible on one line; Sessions is never abbreviated.
 */
export function homeCompactHeaderPlan(input: {
  terminalWidth: number
  heading: string
  agent: string
  model: string
  sessions: string
}): HomeCompactHeaderPlan {
  const available =
    input.terminalWidth - ROW_PADDING - stringWidth(input.heading) - ROW_GAP - stringWidth(input.sessions)
  if (available >= stringWidth(input.agent) + stringWidth(AGENT_SEPARATOR) + ROW_GAP + stringWidth(input.model))
    return { showAgent: true, model: input.model, sessions: input.sessions }
  return { showAgent: false, model: truncateToCellWidth(input.model, available), sessions: input.sessions }
}
