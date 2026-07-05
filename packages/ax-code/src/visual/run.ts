/**
 * Visual run model types (ADR-047).
 *
 * A VisualRun represents a single visual inspection session against
 * a target (URL, desktop window, or uploaded snapshot). Each run
 * produces artifacts (screenshots, DOM, console, network) and
 * findings (layout issues, accessibility problems, etc.).
 */

export type VisualRunMode = "browser" | "snapshot" | "computer"

export type VisualRunStatus = "running" | "passed" | "failed" | "error" | "blocked" | "cancelled"

export type VisualTarget =
  | { type: "url"; url: string; profile: "isolated" | "chrome" }
  | { type: "desktop-window"; appID: string; windowTitle?: string }
  | { type: "snapshot"; source: "desktop" | "upload" | "browser" }

export type VisualArtifact = {
  id: string
  kind: "screenshot" | "dom" | "console" | "network" | "accessibility" | "trace" | "summary"
  path?: string
  mime?: string
  width?: number
  height?: number
  sha256?: string
  label: string
}

export type VisualFindingSeverity = "info" | "warning" | "error" | "critical"

export type VisualFindingCategory =
  | "layout"
  | "accessibility"
  | "interaction"
  | "performance"
  | "console"
  | "network"
  | "copy"

export type VisualFindingStatus = "open" | "fixed" | "accepted" | "false-positive"

export type VisualFinding = {
  id: string
  severity: VisualFindingSeverity
  category: VisualFindingCategory
  title: string
  evidenceArtifactIDs: string[]
  suggestedFix?: string
  status: VisualFindingStatus
}

export type VisualRun = {
  id: string
  sessionID: string
  projectID: string
  target: VisualTarget
  mode: VisualRunMode
  status: VisualRunStatus
  createdAt: string
  updatedAt: string
  artifacts: VisualArtifact[]
  findings: VisualFinding[]
}

/**
 * Viewport preset for responsive visual review.
 */
export type ViewportPreset = {
  label: string
  width: number
  height: number
}

export const DEFAULT_VIEWPORTS: ViewportPreset[] = [
  { label: "desktop", width: 1440, height: 900 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "mobile", width: 390, height: 844 },
]
