import z from "zod"

export namespace AgentControl {
  export const Phase = z.enum([
    "assess",
    "plan",
    "await_approval",
    "execute",
    "validate",
    "recover",
    "summarize",
    "complete",
    "blocked",
  ])
  export type Phase = z.infer<typeof Phase>

  export const ReasoningDepth = z.enum(["fast", "standard", "deep", "xdeep"])
  export type ReasoningDepth = z.infer<typeof ReasoningDepth>

  export const ValidationStatus = z.enum(["not_required", "pending", "passed", "failed"])
  export type ValidationStatus = z.infer<typeof ValidationStatus>

  export const ApprovalState = z.enum(["not_required", "pending", "approved", "rejected"])
  export type ApprovalState = z.infer<typeof ApprovalState>

  export const PlanTaskStatus = z.enum(["pending", "in_progress", "completed", "cancelled", "blocked"])
  export type PlanTaskStatus = z.infer<typeof PlanTaskStatus>

  export const PlanTask = z.object({
    id: z.string(),
    title: z.string(),
    status: PlanTaskStatus,
    ownerAgent: z.string().optional(),
    evidence: z.string().array(),
    validation: z.string().array(),
  })
  export type PlanTask = z.infer<typeof PlanTask>

  export const PlanArtifact = z.object({
    id: z.string(),
    objective: z.string(),
    evidence: z.string().array(),
    assumptions: z.string().array(),
    tasks: PlanTask.array(),
    risks: z.string().array(),
    validation: z.string().array(),
    approvalState: ApprovalState,
  })
  export type PlanArtifact = z.infer<typeof PlanArtifact>

  export type CreatePlanInput = {
    id: string
    objective: string
    evidence?: string[]
    assumptions?: string[]
    tasks?: Array<{
      id: string
      title: string
      status?: PlanTaskStatus
      ownerAgent?: string
      evidence?: string[]
      validation?: string[]
    }>
    risks?: string[]
    validation?: string[]
    approvalState?: ApprovalState
  }

  export type CreateShadowPlanInput = {
    id: string
    objective: string
    ownerAgent?: string
    reason: string
  }

  export type PlanCheckpointInput = {
    reason: string
    evidence?: string[]
    assumptions?: string[]
    risks?: string[]
    validation?: string[]
    taskUpdates?: Array<{
      id: string
      status?: PlanTaskStatus
      evidence?: string[]
      validation?: string[]
    }>
  }

  export const Decision = z.object({
    phase: Phase,
    reasoningDepth: ReasoningDepth,
    planRequired: z.boolean(),
    approvalRequired: z.boolean(),
    validationRequired: z.boolean(),
    allowedSubagents: z.string().array(),
    allowedTools: z.string().array(),
    reason: z.string(),
  })
  export type Decision = z.infer<typeof Decision>

  export const State = z.object({
    sessionID: z.string(),
    phase: Phase,
    objective: z.string(),
    plan: PlanArtifact.optional(),
    reasoningDepth: ReasoningDepth,
    lastDecisionReason: z.string(),
    validationStatus: ValidationStatus,
    blockedReason: z.string().optional(),
  })
  export type State = z.infer<typeof State>

  export type CreateStateInput = {
    sessionID: string
    objective: string
    phase?: Phase
    reasoningDepth?: ReasoningDepth
    validationStatus?: ValidationStatus
    lastDecisionReason?: string
    plan?: PlanArtifact
  }

  export type TransitionInput = {
    state: State
    phase: Phase
    reason: string
    plan?: PlanArtifact
    reasoningDepth?: ReasoningDepth
    validationStatus?: ValidationStatus
    blockedReason?: string
  }

  const transitions: Record<Phase, readonly Phase[]> = {
    assess: ["plan", "execute", "blocked"],
    plan: ["await_approval", "execute", "blocked"],
    await_approval: ["plan", "execute", "blocked"],
    execute: ["validate", "recover", "summarize", "blocked"],
    validate: ["recover", "summarize", "complete", "blocked"],
    recover: ["plan", "execute", "blocked"],
    summarize: ["complete", "blocked"],
    complete: [],
    blocked: ["assess", "plan", "execute", "recover"],
  }

  export function createState(input: CreateStateInput): State {
    if (input.phase === "complete") {
      assertCanComplete({
        plan: input.plan,
        validationStatus: input.validationStatus ?? "not_required",
      })
    }
    return State.parse(compact({
      sessionID: input.sessionID,
      phase: input.phase ?? "assess",
      objective: input.objective,
      plan: input.plan,
      reasoningDepth: input.reasoningDepth ?? "standard",
      lastDecisionReason: input.lastDecisionReason ?? "session_started",
      validationStatus: input.validationStatus ?? "not_required",
    }))
  }

  export function canTransition(from: Phase, to: Phase): boolean {
    return transitions[from].includes(to)
  }

  export function transition(input: TransitionInput): State {
    if (!canTransition(input.state.phase, input.phase)) {
      throw new Error(`invalid agent phase transition: ${input.state.phase} -> ${input.phase}`)
    }
    const plan = input.plan ?? input.state.plan
    const validationStatus = input.validationStatus ?? input.state.validationStatus
    if (input.phase === "complete") assertCanComplete({ plan, validationStatus })

    return State.parse(compact({
      ...input.state,
      phase: input.phase,
      plan,
      reasoningDepth: input.reasoningDepth ?? input.state.reasoningDepth,
      lastDecisionReason: input.reason,
      validationStatus,
      blockedReason: input.phase === "blocked" ? input.blockedReason ?? input.reason : undefined,
    }))
  }

  export function planProgress(plan: PlanArtifact) {
    const total = plan.tasks.length
    const completed = plan.tasks.filter((task) => task.status === "completed").length
    const blocked = plan.tasks.filter((task) => task.status === "blocked").length
    const cancelled = plan.tasks.filter((task) => task.status === "cancelled").length
    return {
      total,
      completed,
      blocked,
      cancelled,
      open: total - completed - blocked - cancelled,
    }
  }

  export function createPlan(input: CreatePlanInput): PlanArtifact {
    return PlanArtifact.parse({
      id: input.id,
      objective: input.objective,
      evidence: input.evidence ?? [],
      assumptions: input.assumptions ?? [],
      tasks: (input.tasks ?? []).map((task) =>
        compact({
          id: task.id,
          title: task.title,
          status: task.status ?? "pending",
          ownerAgent: task.ownerAgent,
          evidence: task.evidence ?? [],
          validation: task.validation ?? [],
        }),
      ),
      risks: input.risks ?? [],
      validation: input.validation ?? [],
      approvalState: input.approvalState ?? "not_required",
    })
  }

  export function createShadowPlan(input: CreateShadowPlanInput): PlanArtifact {
    const objective = normalizeObjective(input.objective)
    return createPlan({
      id: input.id,
      objective,
      evidence: [`Shadow plan initialized from ${input.reason}.`],
      assumptions: ["The plan artifact is session-local and must be refined before tool-heavy implementation."],
      tasks: [
        {
          id: `${input.id}_task_01`,
          title: "Assess objective and produce an implementation plan",
          status: "pending",
          ownerAgent: input.ownerAgent,
          validation: ["Plan evidence, assumptions, risks, and validation criteria are recorded."],
        },
      ],
      risks: ["Shadow plan may be incomplete until the model produces a concrete plan."],
      validation: ["Do not mark the session complete while plan tasks remain open or blocked."],
      approvalState: "not_required",
    })
  }

  export function updateTaskStatus(plan: PlanArtifact, taskID: string, status: PlanTaskStatus): PlanArtifact {
    let matched = false
    const next = {
      ...plan,
      tasks: plan.tasks.map((task) => {
        if (task.id !== taskID) return task
        matched = true
        return {
          ...task,
          status,
        }
      }),
    }
    if (!matched) throw new Error(`plan task not found: ${taskID}`)
    return PlanArtifact.parse(next)
  }

  export function applyCheckpoint(plan: PlanArtifact, input: PlanCheckpointInput): PlanArtifact {
    const updates = new Map<
      string,
      {
        status?: PlanTaskStatus
        evidence: string[]
        validation: string[]
      }
    >()
    const taskIDs = new Set(plan.tasks.map((task) => task.id))
    for (const update of input.taskUpdates ?? []) {
      if (!taskIDs.has(update.id)) throw new Error(`plan task not found: ${update.id}`)
      const current = updates.get(update.id) ?? { evidence: [], validation: [] }
      updates.set(update.id, {
        status: update.status ?? current.status,
        evidence: appendUnique(current.evidence, update.evidence ?? []),
        validation: appendUnique(current.validation, update.validation ?? []),
      })
    }

    return PlanArtifact.parse({
      ...plan,
      evidence: appendUnique(plan.evidence, [`Checkpoint: ${input.reason}`, ...(input.evidence ?? [])]),
      assumptions: appendUnique(plan.assumptions, input.assumptions ?? []),
      tasks: plan.tasks.map((task) => {
        const update = updates.get(task.id)
        if (!update) return task
        return compact({
          ...task,
          status: update.status ?? task.status,
          evidence: appendUnique(task.evidence, update.evidence),
          validation: appendUnique(task.validation, update.validation),
        })
      }),
      risks: appendUnique(plan.risks, input.risks ?? []),
      validation: appendUnique(plan.validation, input.validation ?? []),
    })
  }

  function assertCanComplete(input: { plan?: PlanArtifact; validationStatus: ValidationStatus }) {
    if (input.validationStatus !== "not_required" && input.validationStatus !== "passed") {
      throw new Error(`cannot complete with validation status: ${input.validationStatus}`)
    }
    if (!input.plan) return
    const progress = planProgress(input.plan)
    if (progress.open > 0 || progress.blocked > 0) {
      throw new Error("cannot complete with open or blocked plan tasks")
    }
  }

  function normalizeObjective(objective: string) {
    const trimmed = objective.trim().replace(/\s+/g, " ")
    if (!trimmed) return "Plan the requested work"
    if (trimmed.length <= 400) return trimmed
    return `${trimmed.slice(0, 397)}...`
  }

  function appendUnique(existing: string[], incoming: string[]) {
    const seen = new Set(existing)
    const next = [...existing]
    for (const item of incoming) {
      const normalized = item.trim()
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      next.push(normalized)
    }
    return next
  }

  function compact<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
  }
}
