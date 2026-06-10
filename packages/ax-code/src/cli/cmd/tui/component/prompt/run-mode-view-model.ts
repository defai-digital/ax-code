// Renderer-free view-model for the footer run-mode control.
//
// The runtime exposes autonomous and Super-Long as two booleans, but they
// are dependent, not independent: Super-Long requires autonomous
// (server/routes/super-long.ts rejects enabling it otherwise), and
// disabling autonomous clears the Super-Long override server-side
// (server/routes/autonomous.ts). The only valid states are therefore a
// three-mode ladder, which the UI presents as one cycling control.

export type RunMode = "none" | "auto" | "super-long"

export interface RunModeFlags {
  autonomous: boolean
  superLong: boolean
}

// Super-Long without autonomous is ineffective server-side (GET reports
// the conjoined state), so a stale superLong=true with autonomous=false
// still reads as "none".
export function runMode(flags: RunModeFlags): RunMode {
  if (!flags.autonomous) return "none"
  return flags.superLong ? "super-long" : "auto"
}

export function nextRunMode(mode: RunMode): RunMode {
  switch (mode) {
    case "none":
      return "auto"
    case "auto":
      return "super-long"
    case "super-long":
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
      return "Auto"
    case "super-long":
      return "Super-Long"
  }
}

export interface RunModeStep {
  endpoint: "/autonomous" | "/super-long"
  key: "autonomous" | "superLong"
  enabled: boolean
}

// Ordered server writes that take `current` to `mode`. Ordering carries
// the dependency: autonomous is enabled before Super-Long (the server
// rejects Super-Long otherwise) and Super-Long is disabled before
// autonomous so client and server state never disagree mid-flight.
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
