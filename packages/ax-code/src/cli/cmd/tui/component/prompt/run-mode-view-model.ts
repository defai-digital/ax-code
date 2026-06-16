// Renderer-free view-model for the footer run-mode control.
//
// Simplified two-mode system: Manual ↔ Autonomous
// Long-run capabilities are configured separately via settings, not through
// the mode toggle. This addresses user feedback about confusing mode semantics.
//
// Backward compatibility: The "super-long" mode is preserved during the
// deprecation period but will show a warning and eventually be removed.

export type RunMode = "none" | "auto" | "super-long"

export interface RunModeFlags {
  autonomous: boolean
  superLong: boolean
}

/**
 * Determine the current run mode from flags.
 *
 * Note: Super-Long without autonomous is ineffective server-side, so a stale
 * superLong=true with autonomous=false still reads as "none".
 */
export function runMode(flags: RunModeFlags): RunMode {
  if (!flags.autonomous) return "none"
  return flags.superLong ? "super-long" : "auto"
}

/**
 * Cycle to the next run mode.
 *
 * Two-mode cycle (recommended):
 *   none → auto → none
 *
 * Three-mode cycle (legacy, for backward compatibility):
 *   none → auto → super-long → none
 *
 * @param mode - Current run mode
 * @param enableSuperLong - Whether to include Super-Long in the cycle (default: false)
 */
export function nextRunMode(mode: RunMode, enableSuperLong = false): RunMode {
  if (enableSuperLong) {
    // Legacy three-mode cycle
    switch (mode) {
      case "none":
        return "auto"
      case "auto":
        return "super-long"
      case "super-long":
        return "none"
    }
  }

  // Simplified two-mode cycle
  switch (mode) {
    case "none":
      return "auto"
    case "auto":
    case "super-long": // Treat super-long as auto in two-mode system
      return "none"
  }
}

export function runModeFlags(mode: RunMode): RunModeFlags {
  return { autonomous: mode !== "none", superLong: mode === "super-long" }
}

export function runModeLabel(mode: RunMode): string {
  switch (mode) {
    case "none":
      return "Manual"
    case "auto":
      return "Autonomous"
    case "super-long":
      // During deprecation, show as "Autonomous (Long-Run)" to clarify semantics
      return "Autonomous (Long-Run)"
  }
}

export interface RunModeStep {
  endpoint: "/autonomous" | "/super-long"
  key: "autonomous" | "superLong"
  enabled: boolean
}

/**
 * Compute the ordered server writes needed to transition from current mode to target mode.
 *
 * Ordering carries the dependency: autonomous is enabled before Super-Long
 * (the server rejects Super-Long otherwise) and Super-Long is disabled before
 * autonomous so client and server state never disagree mid-flight.
 */
export function runModeTransition(current: RunModeFlags, mode: RunMode): RunModeStep[] {
  const desired = runModeFlags(mode)
  const steps: RunModeStep[] = []
  if (desired.autonomous && !current.autonomous) {
    steps.push({ endpoint: "/autonomous", key: "autonomous", enabled: true })
  }
  if (desired.superLong !== current.superLong) {
    steps.push({ endpoint: "/super-long", key: "superLong", enabled: desired.superLong })
  }
  if (!desired.autonomous && current.autonomous) {
    steps.push({ endpoint: "/autonomous", key: "autonomous", enabled: false })
  }
  return steps
}
