import z from "zod"
import { Flag } from "../flag/flag"

export const WORKFLOW_SPEC_SCHEMA_VERSION = 1
export const WORKFLOW_DEFAULT_MAX_CONCURRENT_AGENTS = 3
export const WORKFLOW_DEFAULT_MAX_TOTAL_AGENTS = 25
export const WORKFLOW_MAX_CONCURRENT_AGENTS = 16
export const WORKFLOW_MAX_TOTAL_AGENTS = 1000
export const WORKFLOW_DEFAULT_MAX_TOTAL_TOKENS = 100_000
export const WORKFLOW_DEFAULT_MAX_INPUT_TOKENS_PER_CHILD = 50_000
export const WORKFLOW_DEFAULT_MAX_OUTPUT_TOKENS_PER_CHILD = 8_000
export const WORKFLOW_DEFAULT_MAX_WALL_TIME_MS = 60 * 60 * 1000
export const WORKFLOW_DEFAULT_MAX_TOOL_CALLS = 500
export const WORKFLOW_DEFAULT_MAX_RETRIES = 1
export const WORKFLOW_DEFAULT_MAX_REQUESTS_PER_MINUTE = 12
export const WORKFLOW_DEFAULT_MAX_TOKENS_PER_MINUTE = 200_000
export const WORKFLOW_MAX_REQUESTS_PER_MINUTE = 120
export const WORKFLOW_MAX_TOKENS_PER_MINUTE = 2_000_000

const Identifier = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9-]*$/, "must be kebab-case starting with a lowercase letter")

const NonEmptyString = z.string().trim().min(1)
const PositiveInteger = z.number().int().positive()

export const WorkflowTrigger = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("manual"),
    source: z.enum(["prompt", "command", "api"]).default("prompt"),
  }),
  z.object({
    kind: z.literal("scheduled"),
    schedule: NonEmptyString,
    timezone: NonEmptyString.optional(),
    enabled: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("command"),
    command: NonEmptyString.optional(),
  }),
  z.object({
    kind: z.literal("api"),
    route: NonEmptyString.optional(),
    enabled: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("webhook"),
    event: NonEmptyString,
    enabled: z.literal(false).default(false),
    securityGate: z.literal("required").default("required"),
  }),
])
export type WorkflowTrigger = z.infer<typeof WorkflowTrigger>

const WorkflowBudgetFields = {
  maxTotalTokens: PositiveInteger.default(WORKFLOW_DEFAULT_MAX_TOTAL_TOKENS),
  maxInputTokensPerChild: PositiveInteger.default(WORKFLOW_DEFAULT_MAX_INPUT_TOKENS_PER_CHILD),
  maxOutputTokensPerChild: PositiveInteger.default(WORKFLOW_DEFAULT_MAX_OUTPUT_TOKENS_PER_CHILD),
  maxWallTimeMs: PositiveInteger.default(WORKFLOW_DEFAULT_MAX_WALL_TIME_MS),
  maxConcurrentAgents: PositiveInteger.max(WORKFLOW_MAX_CONCURRENT_AGENTS).default(
    WORKFLOW_DEFAULT_MAX_CONCURRENT_AGENTS,
  ),
  maxTotalAgents: PositiveInteger.max(WORKFLOW_MAX_TOTAL_AGENTS).default(WORKFLOW_DEFAULT_MAX_TOTAL_AGENTS),
  maxToolCalls: PositiveInteger.default(WORKFLOW_DEFAULT_MAX_TOOL_CALLS),
  maxRetries: z.number().int().min(0).max(5).default(WORKFLOW_DEFAULT_MAX_RETRIES),
}

const DefaultWorkflowBudget = {
  maxTotalTokens: WORKFLOW_DEFAULT_MAX_TOTAL_TOKENS,
  maxInputTokensPerChild: WORKFLOW_DEFAULT_MAX_INPUT_TOKENS_PER_CHILD,
  maxOutputTokensPerChild: WORKFLOW_DEFAULT_MAX_OUTPUT_TOKENS_PER_CHILD,
  maxWallTimeMs: WORKFLOW_DEFAULT_MAX_WALL_TIME_MS,
  maxConcurrentAgents: WORKFLOW_DEFAULT_MAX_CONCURRENT_AGENTS,
  maxTotalAgents: WORKFLOW_DEFAULT_MAX_TOTAL_AGENTS,
  maxToolCalls: WORKFLOW_DEFAULT_MAX_TOOL_CALLS,
  maxRetries: WORKFLOW_DEFAULT_MAX_RETRIES,
}

export const WorkflowBudget = z.object(WorkflowBudgetFields).superRefine((budget, ctx) => {
  if (budget.maxConcurrentAgents > budget.maxTotalAgents) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "maxConcurrentAgents must not exceed maxTotalAgents",
      path: ["maxConcurrentAgents"],
    })
  }
})
export type WorkflowBudget = z.infer<typeof WorkflowBudget>

export const WorkflowPhaseBudget = z.object({
  maxTotalTokens: PositiveInteger.optional(),
  maxInputTokensPerChild: PositiveInteger.optional(),
  maxOutputTokensPerChild: PositiveInteger.optional(),
  maxWallTimeMs: PositiveInteger.optional(),
  maxConcurrentAgents: PositiveInteger.max(WORKFLOW_MAX_CONCURRENT_AGENTS).optional(),
  maxTotalAgents: PositiveInteger.max(WORKFLOW_MAX_TOTAL_AGENTS).optional(),
  maxToolCalls: PositiveInteger.optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
})
export type WorkflowPhaseBudget = z.infer<typeof WorkflowPhaseBudget>

const WorkflowPacingFields = {
  maxRequestsPerMinute: PositiveInteger.max(WORKFLOW_MAX_REQUESTS_PER_MINUTE).default(
    WORKFLOW_DEFAULT_MAX_REQUESTS_PER_MINUTE,
  ),
  maxTokensPerMinute: PositiveInteger.max(WORKFLOW_MAX_TOKENS_PER_MINUTE).default(
    WORKFLOW_DEFAULT_MAX_TOKENS_PER_MINUTE,
  ),
}

const DefaultWorkflowPacing = {
  maxRequestsPerMinute: WORKFLOW_DEFAULT_MAX_REQUESTS_PER_MINUTE,
  maxTokensPerMinute: WORKFLOW_DEFAULT_MAX_TOKENS_PER_MINUTE,
}

export const WorkflowPacing = z.object(WorkflowPacingFields)
export type WorkflowPacing = z.infer<typeof WorkflowPacing>

export const WorkflowPhasePacing = z.object({
  maxRequestsPerMinute: PositiveInteger.max(WORKFLOW_MAX_REQUESTS_PER_MINUTE).optional(),
  maxTokensPerMinute: PositiveInteger.max(WORKFLOW_MAX_TOKENS_PER_MINUTE).optional(),
})
export type WorkflowPhasePacing = z.infer<typeof WorkflowPhasePacing>

export const WorkflowModelPolicy = z.object({
  defaultModel: NonEmptyString.optional(),
  cheapModel: NonEmptyString.optional(),
  strongModel: NonEmptyString.optional(),
  plannerModel: NonEmptyString.optional(),
  workerModel: NonEmptyString.optional(),
  verifierModel: NonEmptyString.optional(),
  synthesizerModel: NonEmptyString.optional(),
  effort: z.enum(["normal", "deep", "workflow", "max-workflow"]).default("normal"),
  allowedProviders: z.array(NonEmptyString).default([]),
  routing: z
    .array(
      z.object({
        phaseKind: z.enum(["fanout", "sequential", "synthesis", "verification", "noop"]).optional(),
        use: z.enum(["planner", "worker", "verifier", "synthesizer"]),
      }),
    )
    .default([]),
})
export type WorkflowModelPolicy = z.infer<typeof WorkflowModelPolicy>

export const WorkflowModelPolicyOverride = WorkflowModelPolicy.partial()
export type WorkflowModelPolicyOverride = z.infer<typeof WorkflowModelPolicyOverride>

export const WorkflowInput = z.object({
  id: Identifier,
  label: NonEmptyString.max(120).optional(),
  description: NonEmptyString.max(500).optional(),
  type: z.enum(["string", "number", "boolean", "json", "path", "string-array"]).default("string"),
  required: z.boolean().default(false),
  sensitive: z.boolean().default(false),
  default: z.unknown().optional(),
})
export type WorkflowInput = z.infer<typeof WorkflowInput>

export const WorkflowInputValues = z.record(z.string(), z.unknown()).default({})
export type WorkflowInputValues = z.infer<typeof WorkflowInputValues>

export const WorkflowRoutine = z
  .object({
    enabled: z.boolean().default(false),
    mode: z.enum(["manual", "scheduled", "api", "webhook"]).default("manual"),
    schedule: NonEmptyString.optional(),
    timezone: NonEmptyString.optional(),
    apiRoute: NonEmptyString.optional(),
    webhookEvent: NonEmptyString.optional(),
    securityGate: z.enum(["local-only", "required"]).default("local-only"),
  })
  .superRefine((routine, ctx) => {
    if (routine.mode === "scheduled" && !routine.schedule) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "scheduled routines must declare a schedule",
        path: ["schedule"],
      })
    }
    if (routine.mode === "api" && routine.enabled && routine.securityGate !== "local-only") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "api routines must stay local-only in workflow runtime preview",
        path: ["securityGate"],
      })
    }
    if (routine.mode === "webhook" && routine.enabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "webhook routines must remain disabled until remote security gates ship",
        path: ["enabled"],
      })
    }
    if (routine.mode === "webhook" && !routine.webhookEvent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "webhook routines must declare an event",
        path: ["webhookEvent"],
      })
    }
  })
export type WorkflowRoutine = z.infer<typeof WorkflowRoutine>

export const WorkflowPermissions = z.object({
  writePolicy: z.enum(["read-only", "serialized", "worktree-required"]).default("read-only"),
  allowedTools: z.array(NonEmptyString).default([]),
  networkPolicy: z.enum(["inherit", "disabled", "allowed"]).default("inherit"),
  escalationPolicy: z.enum(["inherit", "ask", "deny"]).default("ask"),
})
export type WorkflowPermissions = z.infer<typeof WorkflowPermissions>

export const WorkflowArtifact = z.object({
  id: Identifier,
  kind: z.enum(["summary", "finding", "patch", "verification", "metric", "log"]),
  retention: z.enum(["ephemeral", "session", "durable"]).default("session"),
  exposeToMainContext: z.boolean().default(false),
  redaction: z
    .object({
      status: z.enum(["none", "redacted", "pending"]).default("pending"),
      summary: NonEmptyString.max(500).optional(),
    })
    .optional(),
})
export type WorkflowArtifact = z.infer<typeof WorkflowArtifact>

export const WorkflowVerification = z
  .object({
    mode: z.enum(["required", "optional", "deferred", "skipped"]).default("optional"),
    workflow: z.enum(["review", "debug", "qa"]).optional(),
    commands: z.array(NonEmptyString).default([]),
    requiredArtifactIds: z.array(Identifier).default([]),
    reason: NonEmptyString.max(500).optional(),
  })
  .superRefine((verification, ctx) => {
    if (verification.mode === "skipped" && !verification.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "skipped verification must state a reason",
        path: ["reason"],
      })
    }
  })
export type WorkflowVerification = z.infer<typeof WorkflowVerification>

export const WorkflowSynthesis = z.object({
  agent: NonEmptyString.optional(),
  model: NonEmptyString.optional(),
  outputFormat: z.enum(["markdown", "json", "table", "findings"]).default("markdown"),
  exposeToMainContext: z.boolean().default(true),
  requiredArtifactIds: z.array(Identifier).default([]),
})
export type WorkflowSynthesis = z.infer<typeof WorkflowSynthesis>

export const WorkflowPhase = z.object({
  id: Identifier,
  name: NonEmptyString.max(120),
  kind: z.enum(["fanout", "sequential", "synthesis", "verification", "noop"]),
  prompt: NonEmptyString.optional(),
  agent: NonEmptyString.optional(),
  inputs: z.array(NonEmptyString).default([]),
  outputs: z.array(Identifier).default([]),
  dependsOn: z.array(Identifier).default([]),
  maxParallel: PositiveInteger.max(WORKFLOW_MAX_CONCURRENT_AGENTS).optional(),
  mergeStrategy: z
    .enum(["all", "first-success", "majority", "vote-with-critic", "critic-confirmation", "custom-reducer"])
    .default("all"),
  modelPolicy: WorkflowModelPolicy.partial().optional(),
  budget: WorkflowPhaseBudget.optional(),
  pacing: WorkflowPhasePacing.optional(),
})
export type WorkflowPhase = z.infer<typeof WorkflowPhase>

export const WorkflowSpecV1 = z
  .object({
    schemaVersion: z.literal(WORKFLOW_SPEC_SCHEMA_VERSION),
    id: Identifier,
    name: NonEmptyString.max(120),
    description: NonEmptyString.max(1000),
    tags: z.array(Identifier).default([]),
    trigger: WorkflowTrigger.default({ kind: "manual", source: "prompt" }),
    inputs: z.array(WorkflowInput).default([]),
    routine: WorkflowRoutine.optional(),
    budget: WorkflowBudget.default(DefaultWorkflowBudget),
    pacing: WorkflowPacing.default(DefaultWorkflowPacing),
    modelPolicy: WorkflowModelPolicy.default({ effort: "normal", allowedProviders: [], routing: [] }),
    permissions: WorkflowPermissions.default({
      writePolicy: "read-only",
      allowedTools: [],
      networkPolicy: "inherit",
      escalationPolicy: "ask",
    }),
    artifacts: z.array(WorkflowArtifact).default([]),
    verification: WorkflowVerification.default({
      mode: "optional",
      commands: [],
      requiredArtifactIds: [],
    }),
    synthesis: WorkflowSynthesis.default({
      outputFormat: "markdown",
      exposeToMainContext: true,
      requiredArtifactIds: [],
    }),
    phases: z.array(WorkflowPhase).min(1, "workflow must declare at least one phase"),
  })
  .superRefine((spec, ctx) => {
    const phaseIds = new Set<string>()
    const phases = spec.phases ?? []
    const artifacts = spec.artifacts ?? []
    const artifactIds = new Set(artifacts.map((artifact) => artifact.id))
    const maxConcurrentAgents = spec.budget?.maxConcurrentAgents

    for (const [index, input] of spec.inputs.entries()) {
      if (spec.inputs.findIndex((candidate) => candidate.id === input.id) !== index) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate input id: ${input.id}`,
          path: ["inputs", index, "id"],
        })
      }
    }

    for (const [index, phase] of phases.entries()) {
      if (phaseIds.has(phase.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate phase id: ${phase.id}`,
          path: ["phases", index, "id"],
        })
      }
      phaseIds.add(phase.id)

      if (
        phase.maxParallel !== undefined &&
        maxConcurrentAgents !== undefined &&
        phase.maxParallel > maxConcurrentAgents
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "phase maxParallel must not exceed workflow maxConcurrentAgents",
          path: ["phases", index, "maxParallel"],
        })
      }

      for (const dependency of phase.dependsOn) {
        if (!phaseIds.has(dependency)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `phase dependency must reference an earlier phase: ${dependency}`,
            path: ["phases", index, "dependsOn"],
          })
        }
      }

      for (const output of phase.outputs) {
        if (!artifactIds.has(output)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `phase output must reference a declared artifact: ${output}`,
            path: ["phases", index, "outputs"],
          })
        }
      }
    }

    for (const [index, artifact] of artifacts.entries()) {
      if (artifacts.findIndex((candidate) => candidate.id === artifact.id) !== index) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate artifact id: ${artifact.id}`,
          path: ["artifacts", index, "id"],
        })
      }
    }

    for (const artifactId of spec.verification?.requiredArtifactIds ?? []) {
      if (!artifactIds.has(artifactId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `verification artifact must be declared: ${artifactId}`,
          path: ["verification", "requiredArtifactIds"],
        })
      }
    }

    for (const artifactId of spec.synthesis.requiredArtifactIds) {
      if (!artifactIds.has(artifactId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `synthesis artifact must be declared: ${artifactId}`,
          path: ["synthesis", "requiredArtifactIds"],
        })
      }
    }
  })
export type WorkflowSpecV1 = z.infer<typeof WorkflowSpecV1>

export function parseWorkflowSpecV1(input: unknown): WorkflowSpecV1 {
  return WorkflowSpecV1.parse(input)
}

export function resolveWorkflowInputValues(spec: WorkflowSpecV1, input: unknown): WorkflowInputValues {
  const provided = WorkflowInputValues.parse(input)
  const inputByID = new Map(spec.inputs.map((definition) => [definition.id, definition]))
  const issues: string[] = []
  const resolved: Record<string, unknown> = {}

  for (const key of Object.keys(provided)) {
    if (!inputByID.has(key)) issues.push(`unknown workflow input: ${key}`)
  }

  for (const definition of spec.inputs) {
    const hasProvidedValue = Object.prototype.hasOwnProperty.call(provided, definition.id)
    const value = hasProvidedValue ? provided[definition.id] : definition.default
    if (value === undefined) {
      if (definition.required) issues.push(`required workflow input is missing: ${definition.id}`)
      continue
    }
    if (!inputValueMatchesType(value, definition.type)) {
      issues.push(`workflow input ${definition.id} must be ${definition.type}`)
      continue
    }
    resolved[definition.id] = value
  }

  if (issues.length > 0) throw new WorkflowInputValidationError(issues)
  return resolved
}

export class WorkflowInputValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Workflow input validation failed: ${issues.join("; ")}`)
    this.name = "WorkflowInputValidationError"
  }
}

function inputValueMatchesType(value: unknown, type: WorkflowInput["type"]) {
  switch (type) {
    case "string":
    case "path":
      return typeof value === "string"
    case "number":
      return typeof value === "number" && Number.isFinite(value)
    case "boolean":
      return typeof value === "boolean"
    case "string-array":
      return Array.isArray(value) && value.every((item) => typeof item === "string")
    case "json":
      return true
  }
  return false
}

export function safeParseWorkflowSpecV1(input: unknown) {
  return WorkflowSpecV1.safeParse(input)
}

export function applyWorkflowModelPolicyOverride(
  spec: WorkflowSpecV1,
  override: WorkflowModelPolicyOverride | undefined,
): WorkflowSpecV1 {
  if (!override || Object.keys(override).length === 0) return spec
  return WorkflowSpecV1.parse({
    ...spec,
    modelPolicy: {
      ...spec.modelPolicy,
      ...override,
    },
  })
}

export function isWorkflowRuntimeEnabled() {
  return Flag.AX_CODE_WORKFLOW_RUNTIME
}
