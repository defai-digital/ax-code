import z from "zod"

import { AgentControl } from "@/control-plane/agent-control"
import { SafetyPolicy } from "@/control-plane/safety-policy"

const Base = z.object({
  sessionID: z.string(),
  messageID: z.string().optional(),
  stepIndex: z.number().int().optional(),
  /** R8: When false, replay comparison should skip this event (e.g., date, ls output order) */
  deterministic: z.boolean().optional(),
})

export const SessionStartEvent = Base.extend({
  type: z.literal("session.start"),
  agent: z.string(),
  model: z.string(),
  directory: z.string(),
})

export const SessionEndEvent = Base.extend({
  type: z.literal("session.end"),
  reason: z.enum(["completed", "aborted", "error", "step_limit", "stalled"]),
  totalSteps: z.number().int(),
})

export const AgentRouteEvent = Base.extend({
  type: z.literal("agent.route"),
  fromAgent: z.string(),
  toAgent: z.string(),
  confidence: z.number(),
  routeMode: z.enum(["delegate", "switch", "complexity"]).optional(),
  matched: z.string().array().optional(),
  complexity: z.enum(["low", "medium", "high"]).optional(),
})

export const LLMRequestEvent = Base.extend({
  type: z.literal("llm.request"),
  model: z.string(),
  messageCount: z.number().int(),
  temperature: z.number().optional(),
})

export const LLMResponseEvent = Base.extend({
  type: z.literal("llm.response"),
  finishReason: z.string(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    reasoning: z.number().optional(),
    cache: z.object({ read: z.number(), write: z.number() }).optional(),
  }),
  latencyMs: z.number(),
})

const LLMOutputPart = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  z.object({
    type: z.literal("tool_call"),
    callID: z.string(),
    tool: z.string(),
    input: z.record(z.string(), z.unknown()),
  }),
])

export const LLMOutputEvent = Base.extend({
  type: z.literal("llm.output"),
  parts: LLMOutputPart.array(),
})

export const StepStartEvent = Base.extend({
  type: z.literal("step.start"),
  stepIndex: z.number().int(),
})

export const StepFinishEvent = Base.extend({
  type: z.literal("step.finish"),
  stepIndex: z.number().int(),
  finishReason: z.string(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    reasoning: z.number().optional(),
    cache: z.object({ read: z.number(), write: z.number() }).optional(),
  }),
})

export const ToolCallEvent = Base.extend({
  type: z.literal("tool.call"),
  tool: z.string(),
  callID: z.string(),
  input: z.record(z.string(), z.unknown()),
})

export const ToolResultEvent = Base.extend({
  type: z.literal("tool.result"),
  tool: z.string(),
  callID: z.string(),
  status: z.enum(["completed", "error"]),
  output: z.string().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  error: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  durationMs: z.number(),
})

export const PermissionAskEvent = Base.extend({
  type: z.literal("permission.ask"),
  permission: z.string(),
  patterns: z.string().array(),
  tool: z.string().optional(),
})

export const PermissionReplyEvent = Base.extend({
  type: z.literal("permission.reply"),
  permission: z.string(),
  reply: z.enum(["once", "always", "reject"]),
})

export const ErrorEvent = Base.extend({
  type: z.literal("error"),
  errorType: z.string(),
  message: z.string(),
})

// Snapshot of the Code Intelligence graph at a point in time. Emitted
// once per session (right after session.start) so replay can see the
// exact graph state the agent was querying against. Counts come from
// CodeGraphQuery.getCursor — if the project has never been indexed,
// all numeric fields are 0 and commitSha is null.
export const CodeGraphSnapshotEvent = Base.extend({
  type: z.literal("code.graph.snapshot"),
  projectID: z.string(),
  commitSha: z.string().nullable(),
  nodeCount: z.number().int(),
  edgeCount: z.number().int(),
  lastIndexedAt: z.number().nullable(),
})

// Autonomous-mode telemetry (PRD v4.2.0). Emitted whenever a blast-radius
// cap is tripped so replay can audit why a session ended early.
export const AutonomousCapHitEvent = Base.extend({
  type: z.literal("autonomous.cap_hit"),
  kind: z.enum(["steps", "files", "lines", "blocked_path", "tool_calls"]),
  current: z.number().int(),
  limit: z.number().int(),
  message: z.string().optional(),
})

export const AutonomousEscalationEvent = Base.extend({
  type: z.literal("autonomous.escalation"),
  reason: z.literal("low_confidence"),
  questionHeader: z.string().optional(),
  rationale: z.string().optional(),
})

export const PlannerArchitectCallEvent = Base.extend({
  type: z.literal("planner.architect_call"),
  model: z.string(),
  durationMs: z.number(),
  status: z.enum(["completed", "error", "timeout"]),
  phaseCount: z.number().int().optional(),
})

export const QualityCriticFindingEvent = Base.extend({
  type: z.literal("quality.critic_finding"),
  phaseId: z.string(),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
  ruleId: z.string().optional(),
  file: z.string(),
  line: z.number().int().optional(),
  summary: z.string(),
})

export const AgentPhaseChangedEvent = Base.extend({
  type: z.literal("agent.phase.changed"),
  previousPhase: AgentControl.Phase.optional(),
  phase: AgentControl.Phase,
  reason: z.string(),
})

export const AgentReasoningSelectedEvent = Base.extend({
  type: z.literal("agent.reasoning.selected"),
  depth: AgentControl.ReasoningDepth,
  reason: z.string(),
  policyVersion: z.string().optional(),
  checkpoint: z.boolean().optional(),
})

export const AgentPlanCreatedEvent = Base.extend({
  type: z.literal("agent.plan.created"),
  plan: AgentControl.PlanArtifact,
})

export const AgentPlanUpdatedEvent = Base.extend({
  type: z.literal("agent.plan.updated"),
  plan: AgentControl.PlanArtifact,
  reason: z.string().optional(),
})

export const AgentValidationUpdatedEvent = Base.extend({
  type: z.literal("agent.validation.updated"),
  status: AgentControl.ValidationStatus,
  reason: z.string().optional(),
})

export const AgentBlockedEvent = Base.extend({
  type: z.literal("agent.blocked"),
  phase: AgentControl.Phase,
  reason: z.string(),
  recoverable: z.boolean(),
})

export const AgentCompletionGateDecidedEvent = Base.extend({
  type: z.literal("agent.completion_gate.decided"),
  status: z.enum(["allow", "blocked"]),
  reason: z.enum(["none", "empty_subagent_result", "unfinished_todos"]).optional(),
  message: z.string().optional(),
  retryCount: z.number().int().optional(),
  maxRetries: z.number().int().optional(),
})

export const AgentCompletedEvent = Base.extend({
  type: z.literal("agent.completed"),
  phase: z.literal("complete"),
  validationStatus: z.enum(["not_required", "passed"]),
  summary: z.string().optional(),
})

export const AgentSafetyDecidedEvent = Base.extend({
  type: z.literal("agent.safety.decided"),
  action: SafetyPolicy.Action,
  risk: SafetyPolicy.Risk,
  reason: z.string(),
  permission: z.string(),
  tool: z.string().optional(),
  path: z.string().optional(),
  checkpointRequired: z.boolean(),
  matchedRule: z.string().optional(),
  shadow: z.boolean().optional(),
})

export const ReplayEvent = z.discriminatedUnion("type", [
  SessionStartEvent,
  SessionEndEvent,
  AgentRouteEvent,
  LLMRequestEvent,
  LLMResponseEvent,
  LLMOutputEvent,
  StepStartEvent,
  StepFinishEvent,
  ToolCallEvent,
  ToolResultEvent,
  PermissionAskEvent,
  PermissionReplyEvent,
  ErrorEvent,
  CodeGraphSnapshotEvent,
  AutonomousCapHitEvent,
  AutonomousEscalationEvent,
  PlannerArchitectCallEvent,
  QualityCriticFindingEvent,
  AgentPhaseChangedEvent,
  AgentReasoningSelectedEvent,
  AgentPlanCreatedEvent,
  AgentPlanUpdatedEvent,
  AgentValidationUpdatedEvent,
  AgentBlockedEvent,
  AgentCompletionGateDecidedEvent,
  AgentCompletedEvent,
  AgentSafetyDecidedEvent,
])
export type ReplayEvent = z.infer<typeof ReplayEvent>
