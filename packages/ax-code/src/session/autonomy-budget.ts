import type { Config } from "@/config/config"
import {
  AUTONOMOUS_BLOCKED_PATHS,
  AUTONOMOUS_MAX_FILES_CHANGED,
  AUTONOMOUS_MAX_LINES_CHANGED,
  AUTONOMOUS_MAX_STEPS,
  AUTONOMOUS_PER_TOOL_MAX_CALLS,
  GLOBAL_STEP_LIMIT,
  GOAL_TOTAL_STEP_HEADROOM,
  SUPER_LONG_TOTAL_STEP_HEADROOM,
} from "@/constants/session"
import {
  MAX_EMPTY_MODEL_TURN_RETRIES,
  MAX_TOOL_ONLY_TURNS,
  MAX_TRUNCATED_MODEL_TURN_RETRIES,
  TOOL_ONLY_TURN_FINAL_NUDGE,
  TOOL_ONLY_TURN_NUDGE,
} from "./prompt-loop-config"

/** Named workload profiles (ADR-051 follow-up). Omitted fields fall through to defaults. */
export type AutonomyProfile = "quick" | "standard" | "long" | "goal" | "custom"

export interface ResolvedAutonomyBudget {
  profile: AutonomyProfile
  /** Per-continuation outer-loop step ceiling (session.max_steps). */
  modelTurnsPerSegment: number
  /** Cumulative outer-loop steps across continuations. */
  modelTurnsTotal: number
  /** Cumulative for Super-Long (when max_total_steps not explicit). */
  modelTurnsTotalSuperLong: number
  /** Cumulative for active goals (when max_total_steps not explicit). */
  modelTurnsTotalGoal: number
  maxContinuations: number
  maxTodoRetries: number
  maxCompletionGateRetries: number
  maxEmptyModelTurnRetries: number
  maxTruncatedModelTurnRetries: number
  /** Blast-radius tool-call ceiling per continuation segment. */
  toolCallsPerSegment: number
  filesTotal: number
  linesTotal: number
  blockedPaths: readonly string[]
  perTool: Readonly<Record<string, number>>
  /** Sliding-window tool-call burst limiter. */
  toolCallRate: { count: number; windowSeconds: number }
  /** Tool-only streak circuit breaker. */
  toolOnly: { nudge: number; finalNudge: number; maxTurns: number }
  /** Config keys that contributed non-default values (for /limits). */
  sources: string[]
}

const DEFAULT_BURST_COUNT = 30
const DEFAULT_BURST_WINDOW_SECONDS = 10

type ProfilePreset = Partial<{
  modelTurnsPerSegment: number
  maxContinuations: number
  modelTurnsTotal: number
  toolCallsPerSegment: number
  toolOnlyMaxTurns: number
  burstCount: number
}>

const PROFILE_PRESETS: Record<Exclude<AutonomyProfile, "custom" | "standard">, ProfilePreset> = {
  // Short interactive fixes: tighter pacing, fewer auto-continuations.
  quick: {
    modelTurnsPerSegment: 80,
    maxContinuations: 1,
    modelTurnsTotal: 160,
    toolCallsPerSegment: 150,
    toolOnlyMaxTurns: 20,
    burstCount: 20,
  },
  // Multi-file / batch work without a formal /goal.
  long: {
    modelTurnsPerSegment: 500,
    maxContinuations: 10,
    modelTurnsTotal: 10_000,
    toolCallsPerSegment: 800,
    toolOnlyMaxTurns: 50,
    burstCount: 40,
  },
  // Aligns ordinary runs with goal-scale headroom when profile is selected.
  goal: {
    modelTurnsPerSegment: 500,
    maxContinuations: 40,
    modelTurnsTotal: GLOBAL_STEP_LIMIT * GOAL_TOTAL_STEP_HEADROOM,
    toolCallsPerSegment: 1000,
    toolOnlyMaxTurns: 50,
    burstCount: 40,
  },
}

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback
}

/**
 * Resolve the effective autonomy budget from layered config:
 * profile presets → constants → session.* / experimental.autonomous_caps →
 * autonomy.budget / autonomy.stall (highest precedence).
 */
export function resolveAutonomyBudget(config: Pick<Config.Info, "session" | "experimental" | "autonomy">): ResolvedAutonomyBudget {
  const sources: string[] = []
  const autonomy = config.autonomy
  const budget = autonomy?.budget
  const stall = autonomy?.stall
  const session = config.session
  const caps = config.experimental?.autonomous_caps

  const rawProfile = autonomy?.profile ?? "standard"
  const profile: AutonomyProfile =
    rawProfile === "quick" || rawProfile === "long" || rawProfile === "goal" || rawProfile === "custom"
      ? rawProfile
      : "standard"
  if (autonomy?.profile) sources.push(`autonomy.profile=${profile}`)

  const preset =
    profile === "quick" || profile === "long" || profile === "goal" ? PROFILE_PRESETS[profile] : undefined

  // --- model turns / continuations ---
  let modelTurnsPerSegment =
    preset?.modelTurnsPerSegment ?? session?.max_steps ?? GLOBAL_STEP_LIMIT
  if (budget?.model_turns?.per_segment !== undefined) {
    modelTurnsPerSegment = budget.model_turns.per_segment
    sources.push("autonomy.budget.model_turns.per_segment")
  } else if (session?.max_steps !== undefined) {
    sources.push("session.max_steps")
  } else if (preset?.modelTurnsPerSegment !== undefined) {
    sources.push(`profile:${profile}.model_turns.per_segment`)
  }

  let maxContinuations = preset?.maxContinuations ?? session?.max_continuations ?? 3
  if (budget?.continuations !== undefined) {
    maxContinuations = budget.continuations
    sources.push("autonomy.budget.continuations")
  } else if (session?.max_continuations !== undefined) {
    sources.push("session.max_continuations")
  } else if (preset?.maxContinuations !== undefined) {
    sources.push(`profile:${profile}.continuations`)
  }

  const derivedTotal = modelTurnsPerSegment * (maxContinuations + 1)
  let modelTurnsTotal = preset?.modelTurnsTotal ?? session?.max_total_steps ?? derivedTotal
  let modelTurnsTotalSuperLong = session?.max_total_steps ?? modelTurnsPerSegment * SUPER_LONG_TOTAL_STEP_HEADROOM
  let modelTurnsTotalGoal = session?.max_total_steps ?? modelTurnsPerSegment * GOAL_TOTAL_STEP_HEADROOM
  if (budget?.model_turns?.total !== undefined) {
    modelTurnsTotal = budget.model_turns.total
    modelTurnsTotalSuperLong = budget.model_turns.total
    modelTurnsTotalGoal = budget.model_turns.total
    sources.push("autonomy.budget.model_turns.total")
  } else if (session?.max_total_steps !== undefined) {
    sources.push("session.max_total_steps")
  } else if (preset?.modelTurnsTotal !== undefined) {
    modelTurnsTotalSuperLong = Math.max(modelTurnsTotalSuperLong, preset.modelTurnsTotal)
    modelTurnsTotalGoal = Math.max(modelTurnsTotalGoal, preset.modelTurnsTotal)
    sources.push(`profile:${profile}.model_turns.total`)
  }

  let maxTodoRetries = session?.max_todo_retries ?? 10
  if (budget?.todo_retries !== undefined) {
    maxTodoRetries = budget.todo_retries
    sources.push("autonomy.budget.todo_retries")
  } else if (session?.max_todo_retries !== undefined) {
    sources.push("session.max_todo_retries")
  }

  // --- blast radius / tool calls ---
  let toolCallsPerSegment = preset?.toolCallsPerSegment ?? caps?.steps ?? AUTONOMOUS_MAX_STEPS
  if (budget?.tool_calls?.per_segment !== undefined) {
    toolCallsPerSegment = budget.tool_calls.per_segment
    sources.push("autonomy.budget.tool_calls.per_segment")
  } else if (caps?.steps !== undefined) {
    sources.push("experimental.autonomous_caps.steps")
  } else if (preset?.toolCallsPerSegment !== undefined) {
    sources.push(`profile:${profile}.tool_calls.per_segment`)
  }

  let filesTotal = caps?.files ?? AUTONOMOUS_MAX_FILES_CHANGED
  if (budget?.changes?.files_total !== undefined) {
    filesTotal = budget.changes.files_total
    sources.push("autonomy.budget.changes.files_total")
  } else if (caps?.files !== undefined) {
    sources.push("experimental.autonomous_caps.files")
  }

  let linesTotal = caps?.lines ?? AUTONOMOUS_MAX_LINES_CHANGED
  if (budget?.changes?.lines_total !== undefined) {
    linesTotal = budget.changes.lines_total
    sources.push("autonomy.budget.changes.lines_total")
  } else if (caps?.lines !== undefined) {
    sources.push("experimental.autonomous_caps.lines")
  }

  let blockedPaths: readonly string[] = caps?.blockedPaths ?? AUTONOMOUS_BLOCKED_PATHS
  if (budget?.changes?.blocked_paths !== undefined) {
    blockedPaths = budget.changes.blocked_paths
    sources.push("autonomy.budget.changes.blocked_paths")
  } else if (caps?.blockedPaths !== undefined) {
    sources.push("experimental.autonomous_caps.blockedPaths")
  }

  const perTool: Record<string, number> = { ...AUTONOMOUS_PER_TOOL_MAX_CALLS }
  if (caps?.perTool) {
    for (const [k, v] of Object.entries(caps.perTool)) {
      if (typeof v === "number" && Number.isFinite(v)) perTool[k] = v
    }
    sources.push("experimental.autonomous_caps.perTool")
  }
  if (budget?.tool_calls?.per_tool) {
    for (const [k, v] of Object.entries(budget.tool_calls.per_tool)) {
      if (typeof v === "number" && Number.isFinite(v)) perTool[k] = v
    }
    sources.push("autonomy.budget.tool_calls.per_tool")
  }

  let burstCount = preset?.burstCount ?? DEFAULT_BURST_COUNT
  let burstWindow = DEFAULT_BURST_WINDOW_SECONDS
  if (budget?.tool_calls?.rate?.count !== undefined) {
    burstCount = budget.tool_calls.rate.count
    sources.push("autonomy.budget.tool_calls.rate.count")
  } else if (preset?.burstCount !== undefined) {
    sources.push(`profile:${profile}.tool_calls.rate.count`)
  }
  if (budget?.tool_calls?.rate?.window_seconds !== undefined) {
    burstWindow = budget.tool_calls.rate.window_seconds
    sources.push("autonomy.budget.tool_calls.rate.window_seconds")
  }

  // --- tool-only stall breaker ---
  let maxToolOnlyTurns = preset?.toolOnlyMaxTurns ?? MAX_TOOL_ONLY_TURNS
  if (stall?.tool_only_turns !== undefined) {
    maxToolOnlyTurns = stall.tool_only_turns
    sources.push("autonomy.stall.tool_only_turns")
  } else if (preset?.toolOnlyMaxTurns !== undefined) {
    sources.push(`profile:${profile}.stall.tool_only_turns`)
  }

  let toolOnlyNudge = TOOL_ONLY_TURN_NUDGE
  if (stall?.tool_only_nudge !== undefined) {
    toolOnlyNudge = stall.tool_only_nudge
    sources.push("autonomy.stall.tool_only_nudge")
  }

  let toolOnlyFinalNudge = Math.max(1, maxToolOnlyTurns - 5)
  if (stall?.tool_only_final_nudge !== undefined) {
    toolOnlyFinalNudge = stall.tool_only_final_nudge
    sources.push("autonomy.stall.tool_only_final_nudge")
  } else {
    // Keep final nudge below max and at least at nudge when using defaults.
    toolOnlyFinalNudge = Math.min(Math.max(toolOnlyNudge, maxToolOnlyTurns - 5), Math.max(1, maxToolOnlyTurns - 1))
  }
  // Ensure ordering: nudge <= finalNudge <= maxTurns (when maxTurns > 0)
  if (maxToolOnlyTurns > 0) {
    toolOnlyNudge = Math.min(toolOnlyNudge, maxToolOnlyTurns)
    toolOnlyFinalNudge = Math.min(Math.max(toolOnlyFinalNudge, toolOnlyNudge), maxToolOnlyTurns)
  }

  return {
    profile,
    modelTurnsPerSegment: finitePositive(modelTurnsPerSegment, GLOBAL_STEP_LIMIT),
    modelTurnsTotal: finitePositive(modelTurnsTotal, derivedTotal),
    modelTurnsTotalSuperLong: finitePositive(modelTurnsTotalSuperLong, modelTurnsPerSegment * SUPER_LONG_TOTAL_STEP_HEADROOM),
    modelTurnsTotalGoal: finitePositive(modelTurnsTotalGoal, modelTurnsPerSegment * GOAL_TOTAL_STEP_HEADROOM),
    maxContinuations: finiteNonNegative(maxContinuations, 3),
    maxTodoRetries: finiteNonNegative(maxTodoRetries, 10),
    maxCompletionGateRetries: Math.min(finiteNonNegative(maxTodoRetries, 10), 2),
    maxEmptyModelTurnRetries: MAX_EMPTY_MODEL_TURN_RETRIES,
    maxTruncatedModelTurnRetries: MAX_TRUNCATED_MODEL_TURN_RETRIES,
    toolCallsPerSegment: finitePositive(toolCallsPerSegment, AUTONOMOUS_MAX_STEPS),
    filesTotal: finitePositive(filesTotal, AUTONOMOUS_MAX_FILES_CHANGED),
    linesTotal: finitePositive(linesTotal, AUTONOMOUS_MAX_LINES_CHANGED),
    blockedPaths,
    perTool,
    toolCallRate: {
      count: finitePositive(burstCount, DEFAULT_BURST_COUNT),
      windowSeconds: finitePositive(burstWindow, DEFAULT_BURST_WINDOW_SECONDS),
    },
    toolOnly: {
      nudge: finitePositive(toolOnlyNudge, TOOL_ONLY_TURN_NUDGE),
      finalNudge: finitePositive(toolOnlyFinalNudge, TOOL_ONLY_TURN_FINAL_NUDGE),
      maxTurns: finitePositive(maxToolOnlyTurns, MAX_TOOL_ONLY_TURNS),
    },
    sources,
  }
}

/** Format a multi-line doctor report for /limits. */
export function formatAutonomyBudgetReport(input: {
  budget: ResolvedAutonomyBudget
  agentName?: string
  agentSteps?: number
  autonomous?: boolean
}): string {
  const b = input.budget
  const effectiveAgent =
    typeof input.agentSteps === "number" && Number.isFinite(input.agentSteps) && input.agentSteps > 0
      ? Math.min(input.agentSteps, b.modelTurnsPerSegment)
      : b.modelTurnsPerSegment

  const lines = [
    "Autonomous budget (resolved)",
    "",
    `Profile: ${b.profile}`,
    `Autonomous mode: ${input.autonomous === false ? "off" : "on (or default)"}`,
    input.agentName ? `Active agent: ${input.agentName}` : "Active agent: (session default)",
    input.agentSteps !== undefined && Number.isFinite(input.agentSteps)
      ? `Agent steps override: ${input.agentSteps}`
      : "Agent steps override: none (unbounded at agent layer)",
    `Effective pacing denominator (TUI): ${effectiveAgent}`,
    "",
    "Model turns",
    `  per segment:     ${b.modelTurnsPerSegment}`,
    `  auto-continuations: ${b.maxContinuations}`,
    `  total (ordinary):   ${b.modelTurnsTotal}`,
    `  total (goal):       ${b.modelTurnsTotalGoal}`,
    `  total (super-long): ${b.modelTurnsTotalSuperLong}`,
    `  todo retries:       ${b.maxTodoRetries}`,
    "",
    "Tool calls / blast radius",
    `  tool calls / segment: ${b.toolCallsPerSegment}`,
    `  files total:          ${b.filesTotal}`,
    `  lines total:          ${b.linesTotal}`,
    `  burst rate:           ${b.toolCallRate.count} calls / ${b.toolCallRate.windowSeconds}s`,
    `  per-tool:             ${Object.entries(b.perTool)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ") || "(none)"}`,
    `  blocked path patterns: ${b.blockedPaths.length}`,
    "",
    "Stall breakers",
    `  tool-only nudge / final / max: ${b.toolOnly.nudge} / ${b.toolOnly.finalNudge} / ${b.toolOnly.maxTurns}`,
    "",
    "Config sources (non-default)",
    b.sources.length ? b.sources.map((s) => `  - ${s}`).join("\n") : "  (all shipped defaults)",
    "",
    "Override keys",
    '  autonomy.profile, autonomy.budget.*, autonomy.stall.*',
    "  session.max_steps | max_continuations | max_total_steps | max_todo_retries",
    "  experimental.autonomous_caps.* (legacy blast-radius overrides)",
    "  agent.<name>.steps",
  ]
  return lines.join("\n")
}

/** Doctor warnings for inconsistent or surprising config. */
export function autonomyBudgetDiagnostics(input: {
  budget: ResolvedAutonomyBudget
  agentSteps?: number
}): string[] {
  const warnings: string[] = []
  const b = input.budget
  if (typeof input.agentSteps === "number" && Number.isFinite(input.agentSteps) && input.agentSteps > 0) {
    if (input.agentSteps < b.modelTurnsPerSegment) {
      warnings.push(
        `Agent step cap (${input.agentSteps}) is lower than session per-segment turns (${b.modelTurnsPerSegment}); ` +
          `the TUI and agent limit will use ${input.agentSteps}.`,
      )
    }
  }
  if (b.modelTurnsTotal < b.modelTurnsPerSegment) {
    warnings.push(
      `model_turns.total (${b.modelTurnsTotal}) is lower than per_segment (${b.modelTurnsPerSegment}); ` +
        `the run will stop before a full segment completes.`,
    )
  }
  if (b.toolOnly.nudge > b.toolOnly.maxTurns) {
    warnings.push(`tool_only_nudge (${b.toolOnly.nudge}) exceeds tool_only_turns (${b.toolOnly.maxTurns}).`)
  }
  if (b.toolOnly.finalNudge > b.toolOnly.maxTurns) {
    warnings.push(
      `tool_only_final_nudge (${b.toolOnly.finalNudge}) exceeds tool_only_turns (${b.toolOnly.maxTurns}).`,
    )
  }
  if (b.toolCallRate.count < 5) {
    warnings.push(
      `Burst rate count is very low (${b.toolCallRate.count}/ ${b.toolCallRate.windowSeconds}s); parallel tool batches may fail.`,
    )
  }
  return warnings
}
