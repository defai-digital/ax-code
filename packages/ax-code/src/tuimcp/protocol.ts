import z from "zod"
import { SessionID } from "@/session/schema"

export const MAX_FRAME_BYTES = 16 * 1024
export const CALL_TIMEOUT_MS = 4_000
export const HUMAN_QUIET_MS = 1_500
export const MAX_RECEIPTS = 128

export const ViewSchema = z
  .object({
    instanceId: z.uuid(),
    generation: z.uuid(),
    revision: z.number().int().nonnegative(),
    route: z.enum(["home", "session"]),
    sessionId: SessionID.zod.optional(),
    ready: z.boolean(),
    blocked: z.boolean(),
  })
  .strict()
export type View = z.infer<typeof ViewSchema>

export const SelectSchema = z
  .object({
    requestId: z.uuid(),
    instanceId: z.uuid(),
    generation: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    sessionId: SessionID.zod,
  })
  .strict()
export type Select = z.infer<typeof SelectSchema>

export const RequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("get_view_context") }).strict(),
  SelectSchema.extend({ operation: z.literal("select_session") }).strict(),
])
export type Request = z.infer<typeof RequestSchema>

export const ResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("context"), context: ViewSchema }).strict(),
  z.object({ status: z.literal("applied"), context: ViewSchema }).strict(),
  z
    .object({
      status: z.literal("rejected"),
      code: z.enum([
        "invalid_request",
        "unauthorized",
        "stale_target",
        "stale_revision",
        "not_ready",
        "user_active",
        "busy",
        "request_conflict",
        "request_limit",
        "target_unavailable",
        "cancelled",
        "timeout_unknown",
        "revoked",
        "internal_error",
        "deadline_exceeded",
        "outcome_unknown",
      ]),
    })
    .strict(),
])
export type Result = z.infer<typeof ResultSchema>
export type RejectionCode = Extract<Result, { status: "rejected" }>["code"]
export const reject = (code: RejectionCode): Result => ({ status: "rejected", code })

export const EndpointSchema = z
  .object({
    version: z.literal(1),
    instanceId: z.uuid(),
    generation: z.uuid(),
    token: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
export type Endpoint = z.infer<typeof EndpointSchema>
