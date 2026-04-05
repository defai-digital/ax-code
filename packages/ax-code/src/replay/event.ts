import z from "zod"

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
  reason: z.enum(["completed", "aborted", "error", "step_limit"]),
  totalSteps: z.number().int(),
})

export const AgentRouteEvent = Base.extend({
  type: z.literal("agent.route"),
  fromAgent: z.string(),
  toAgent: z.string(),
  confidence: z.number(),
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
  cost: z.number().optional(),
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
  cost: z.number().optional(),
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
  error: z.string().optional(),
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
])
export type ReplayEvent = z.infer<typeof ReplayEvent>
