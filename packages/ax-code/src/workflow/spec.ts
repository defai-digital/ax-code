import z from "zod"
import { Flag } from "../flag/flag"

export const WORKFLOW_SPEC_SCHEMA_VERSION = 1
export const WORKFLOW_DEFAULT_MAX_CONCURRENT_AGENTS = 3
export const WORKFLOW_DEFAULT_MAX_TOTAL_AGENTS = 25
export const WORKFLOW_MAX_CONCURRENT_AGENTS = 16
export const WORKFLOW_MAX_TOTAL_AGENTS = 1000
export const WORKFLOW_DEFAULT_MAX_TOTAL_TOKENS = 100_000
export const WORKFLOW_DEFAULT_MAX_WALL_TIME_MS = 60 * 60 * 1000
export const WORKFLOW_DEFAULT_MAX_TOOL_CALLS = 500
export const WORKFLOW_DEFAULT_MAX_RETRIES = 1

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

export const WorkflowPhaseBudget = z.object(WorkflowBudgetFields).partial()
export type WorkflowPhaseBudget = z.infer<typeof WorkflowPhaseBudget>

export const WorkflowModelPolicy = z.object({
  plannerModel: NonEmptyString.optional(),
  workerModel: NonEmptyString.optional(),
  verifierModel: NonEmptyString.optional(),
  synthesizerModel: NonEmptyString.optional(),
  effort: z.enum(["normal", "deep", "workflow", "max-workflow"]).default("normal"),
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
})
export type WorkflowArtifact = z.infer<typeof WorkflowArtifact>

export const WorkflowVerification = z.object({
  mode: z.enum(["required", "optional", "deferred", "skipped"]).default("optional"),
  workflow: z.enum(["review", "debug", "qa"]).optional(),
  commands: z.array(NonEmptyString).default([]),
  requiredArtifactIds: z.array(Identifier).default([]),
})
export type WorkflowVerification = z.infer<typeof WorkflowVerification>

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
  mergeStrategy: z.enum(["all", "first-success", "majority", "critic-confirmation"]).default("all"),
  modelPolicy: WorkflowModelPolicy.partial().optional(),
  budget: WorkflowPhaseBudget.optional(),
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
    budget: WorkflowBudget.default(DefaultWorkflowBudget),
    modelPolicy: WorkflowModelPolicy.default({ effort: "normal", routing: [] }),
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
    phases: z.array(WorkflowPhase).min(1, "workflow must declare at least one phase"),
  })
  .superRefine((spec, ctx) => {
    const phaseIds = new Set<string>()
    const phases = spec.phases ?? []
    const artifacts = spec.artifacts ?? []
    const artifactIds = new Set(artifacts.map((artifact) => artifact.id))
    const maxConcurrentAgents = spec.budget?.maxConcurrentAgents

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
  })
export type WorkflowSpecV1 = z.infer<typeof WorkflowSpecV1>

export function parseWorkflowSpecV1(input: unknown): WorkflowSpecV1 {
  return WorkflowSpecV1.parse(input)
}

export function safeParseWorkflowSpecV1(input: unknown) {
  return WorkflowSpecV1.safeParse(input)
}

export function isWorkflowRuntimeEnabled() {
  return Flag.AX_CODE_WORKFLOW_RUNTIME
}
