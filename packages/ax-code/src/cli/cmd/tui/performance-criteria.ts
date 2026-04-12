import { TUI_RENDER_FRAME_BUDGET_MS, TUI_RENDER_TARGET_FPS } from "./renderer"

export type TuiPerformanceGate = "release-blocking" | "benchmark-before-rewrite"

export type TuiPerformanceCriterion = {
  id: string
  gate: TuiPerformanceGate
  target: {
    p95Ms?: number
    minFps?: number
    maxRegressionPct?: number
  }
  workload: string
  measurement: string
}

export const TUI_PERFORMANCE_CRITERIA_VERSION = 1
export const TUI_PERFORMANCE_CRITERIA = [
  {
    id: "renderer.frame-budget",
    gate: "release-blocking",
    target: {
      p95Ms: Math.ceil(TUI_RENDER_FRAME_BUDGET_MS),
      minFps: TUI_RENDER_TARGET_FPS,
    },
    workload: "steady-state render loop with no active model stream",
    measurement: "renderer frame timer or OpenTUI stats when enabled for a benchmark run",
  },
  {
    id: "startup.first-frame",
    gate: "release-blocking",
    target: {
      p95Ms: 1200,
      maxRegressionPct: 10,
    },
    workload: "cold TUI start to first stable frame in a warmed dependency install",
    measurement: "PTY smoke timer from process spawn to first non-empty frame",
  },
  {
    id: "input.keypress-echo",
    gate: "release-blocking",
    target: {
      p95Ms: 50,
      maxRegressionPct: 10,
    },
    workload: "prompt typing while sync is idle and no dialog is open",
    measurement: "PTY input timestamp to visible prompt echo",
  },
  {
    id: "transcript.large-append",
    gate: "benchmark-before-rewrite",
    target: {
      p95Ms: 120,
      maxRegressionPct: 10,
    },
    workload: "append 2,000 mixed text/tool/diff transcript rows while the prompt remains interactive",
    measurement: "fixture replay append duration and missed prompt echo samples",
  },
  {
    id: "scroll.long-cjk-wrapped",
    gate: "benchmark-before-rewrite",
    target: {
      minFps: 45,
      maxRegressionPct: 10,
    },
    workload: "scroll a long transcript containing wrapped ASCII, CJK, and diff blocks",
    measurement: "PTY scroll replay with frame counter and viewport assertions",
  },
] as const satisfies readonly TuiPerformanceCriterion[]

export function listTuiPerformanceCriteria(): readonly TuiPerformanceCriterion[] {
  return TUI_PERFORMANCE_CRITERIA
}

export function findTuiPerformanceCriterion(id: string): TuiPerformanceCriterion | undefined {
  return TUI_PERFORMANCE_CRITERIA.find((criterion) => criterion.id === id)
}
