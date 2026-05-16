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

export const TUI_PERFORMANCE_CRITERIA_VERSION = "2026-04-13"

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
    id: "input.paste-echo",
    title: "Bracketed paste latency",
    gate: "manual",
    target: { p95Ms: 120 },
    workload: "Send a bracketed paste payload after the prompt is visible.",
    measurement: "Wall-clock milliseconds from paste write to the payload appearing in terminal output.",
  },
  {
    id: "terminal.resize-stability",
    title: "Terminal resize stability",
    gate: "manual",
    target: { p95Ms: 250 },
    workload: "Resize the PTY after the first frame and keep the session alive long enough to catch immediate crashes.",
    measurement: "Wall-clock milliseconds from resize to stable post-resize observation.",
  },
  {
    id: "mouse.click-release",
    title: "Mouse click/release stability",
    gate: "manual",
    target: { p95Ms: 250 },
    workload: "Send paired xterm SGR mouse down/up events after the first frame.",
    measurement: "Wall-clock milliseconds from mouse down to stable post-release observation.",
  },
  {
    id: "selection.drag-stability",
    title: "Selection drag stability",
    gate: "manual",
    target: { p95Ms: 250 },
    workload: "Send xterm SGR drag-style mouse events over transcript coordinates after the first frame.",
    measurement: "Wall-clock milliseconds from drag start to stable post-release observation.",
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
  {
    id: "layout.multi-pane",
    title: "Multi-pane layout projection",
    gate: "manual",
    target: { p95Ms: 32 },
    workload: "Project a session workspace with transcript, prompt, sidebar, dialogs, and plugin slot regions.",
    measurement: "Wall-clock milliseconds for layout projection before renderer paint.",
  },
  {
    id: "transcript.rich-rendering",
    title: "Rich transcript rendering",
    gate: "manual",
    target: { p95Ms: 40 },
    workload: "Render mixed Markdown, ANSI, CJK, code, diff, and long unbroken lines without layout instability.",
    measurement: "Wall-clock milliseconds for renderer-specific rich transcript projection.",
  },
  {
    id: "plugins.ui-slots",
    title: "Plugin UI slot projection",
    gate: "manual",
    target: { p95Ms: 32 },
    workload: "Project header, sidebar, transcript, and footer plugin UI slots with active session data.",
    measurement: "Wall-clock milliseconds for plugin slot projection and event registration.",
  },
  {
    id: "visualization.terminal-native",
    title: "Terminal-native visualization projection",
    gate: "manual",
    target: { p95Ms: 40 },
    workload: "Project dense terminal-native tables, progress bars, and graph-like summaries.",
    measurement: "Wall-clock milliseconds for visualization projection before renderer paint.",
  },
]
