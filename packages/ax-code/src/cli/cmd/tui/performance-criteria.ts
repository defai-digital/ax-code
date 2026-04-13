export type TuiPerformanceCriterion = {
  id: string
  title: string
  gate: "automated" | "manual"
  target: {
    p95Ms?: number
    minFps?: number
  }
  workload: string
  measurement: string
}

export const TUI_PERFORMANCE_CRITERIA_VERSION = "2026-04-12"

export const TUI_PERFORMANCE_CRITERIA: TuiPerformanceCriterion[] = [
  {
    id: "startup.first-frame",
    title: "First TUI frame",
    gate: "manual",
    target: { p95Ms: 1200 },
    workload: "Start ax-code in a warmed local checkout and wait for the first non-empty terminal frame.",
    measurement: "Wall-clock milliseconds from PTY spawn to first visible frame.",
  },
  {
    id: "input.keypress-echo",
    title: "Input echo latency",
    gate: "manual",
    target: { p95Ms: 80 },
    workload: "Send a short input sequence after the prompt is visible.",
    measurement: "Wall-clock milliseconds from write to the echoed sequence appearing in terminal output.",
  },
  {
    id: "transcript.large-append",
    title: "Large transcript projection",
    gate: "automated",
    target: { p95Ms: 25 },
    workload: "Project a 2,000 message transcript fixture with mixed text and tool parts.",
    measurement: "Wall-clock milliseconds spent building visible transcript data.",
  },
  {
    id: "scroll.long-cjk-wrapped",
    title: "Long transcript scroll replay",
    gate: "automated",
    target: { minFps: 45 },
    workload: "Replay next/previous scrolling over a long mixed-language transcript fixture.",
    measurement: "Effective frames per second for scroll target calculations.",
  },
]
