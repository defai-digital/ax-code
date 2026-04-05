import z from "zod"

export const AuditRecord = z.object({
  trace_id: z.string(),
  session_id: z.string(),
  step_id: z.string().optional(),
  tool_id: z.string().optional(),
  timestamp: z.string(),
  event_type: z.string(),
  agent: z.string().optional(),
  tool: z.string().optional(),
  action: z.string().optional(),
  target: z.string().optional(),
  result: z.string().optional(),
  duration_ms: z.number().optional(),
  token_usage: z
    .object({
      input: z.number(),
      output: z.number(),
    })
    .optional(),
  policy: z
    .object({
      name: z.string(),
      version: z.string(),
    })
    .optional(),
})

export type AuditRecord = z.infer<typeof AuditRecord>
