/**
 * Typed access to an explicitly shared native TUI through a standard MCP client.
 * No backend credentials, browser, or HTTP server are required.
 * @module
 */
import z from "zod"

/** Identity of one explicitly shared TUI process. */
export const TuiDebugTargetSchema = z.object({ instanceId: z.uuid(), generation: z.uuid() }).strict()
/** Bounded navigation context. Revision fences UI state, not completed rendering. */
export const TuiDebugContextSchema = TuiDebugTargetSchema.extend({
  revision: z.number().int().nonnegative(),
  route: z.enum(["home", "session"]),
  sessionId: z.string().optional(),
  ready: z.boolean(),
  blocked: z.boolean(),
}).strict()
/** A snapshot of the last completed native render buffer. */
export const TuiDebugScreenSchema = z
  .object({
    frameId: z.number().int().nonnegative(),
    width: z.number().int().min(1).max(1000),
    height: z.number().int().min(1).max(1000),
    text: z.string().max(48_000),
    focusedId: z.string().max(256).nullable(),
    modalDepth: z.number().int().nonnegative(),
    cursor: z.object({ x: z.number().int(), y: z.number().int(), visible: z.boolean() }).strict(),
  })
  .strict()
/** Keys supported by the native debug input adapter. */
export const TuiDebugKeySchema = z.union([
  z.enum([
    "enter",
    "escape",
    "tab",
    "backspace",
    "delete",
    "up",
    "down",
    "left",
    "right",
    "home",
    "end",
    "pageup",
    "pagedown",
  ]),
  z.string().regex(/^[ -~]$/),
])
/** One synchronous parser input or renderer resize. No arbitrary escape sequences. */
export const TuiDebugActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("key"),
      key: TuiDebugKeySchema,
      ctrl: z.boolean().optional(),
      shift: z.boolean().optional(),
      meta: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("paste"),
      text: z
        .string()
        .min(1)
        .max(4096)
        .regex(/^[^\x00-\x08\x0b-\x1f\x7f]*$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("click"),
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
      expectedFrameId: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("resize"),
      width: z.number().int().min(20).max(300),
      height: z.number().int().min(8).max(150),
    })
    .strict(),
])
/** Read the explicitly targeted TUI's screen. */
export const TuiDebugSnapshotSchema = TuiDebugTargetSchema
/** Fenced, deduplicated input. Reuse the same request id to reconcile a receipt. */
export const TuiDebugInputSchema = TuiDebugTargetSchema.extend({
  requestId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  action: TuiDebugActionSchema,
}).strict()
/** Literal screen assertions with a finite deadline. */
export const TuiDebugWaitSchema = TuiDebugTargetSchema.extend({
  text: z.string().min(1).max(1024).optional(),
  afterFrameId: z.number().int().nonnegative().optional(),
  timeoutMs: z.number().int().min(1).max(3000).default(2000),
})
  .strict()
  .refine((input) => input.text !== undefined || input.afterFrameId !== undefined, "A screen condition is required")
/** Structured results returned by the TUI's MCP tools. */
export const TuiDebugResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("context"), context: TuiDebugContextSchema }).strict(),
  z.object({ status: z.literal("applied"), context: TuiDebugContextSchema }).strict(),
  z.object({ status: z.literal("snapshot"), context: TuiDebugContextSchema, screen: TuiDebugScreenSchema }).strict(),
  z.object({ status: z.literal("rejected"), code: z.string().max(64) }).strict(),
])
/** Native screen DTO. */
export type TuiDebugScreen = z.infer<typeof TuiDebugScreenSchema>
/** Native input DTO. */
export type TuiDebugAction = z.infer<typeof TuiDebugActionSchema>
/** Native UI state DTO. */
export type TuiDebugContext = z.infer<typeof TuiDebugContextSchema>
/** Structured tool response, including explicit domain rejections. */
export type TuiDebugResult = z.infer<typeof TuiDebugResultSchema>
/** Structural subset of a standard MCP client; no MCP package dependency is needed. */
export interface TuiDebugTransport {
  callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<unknown>
}

/** Create a validated client. Calls never retry or silently refresh mutation fences. */
export function createTuiDebugClient(transport: TuiDebugTransport) {
  async function call(name: string, args: Record<string, unknown>): Promise<TuiDebugResult> {
    const reply = z
      .object({ structuredContent: TuiDebugResultSchema })
      .parse(await transport.callTool({ name, arguments: args }))
    return reply.structuredContent
  }
  return {
    context: () => call("get_view_context", {}),
    snapshot: async (target: z.input<typeof TuiDebugSnapshotSchema>) =>
      call("get_tui_snapshot", TuiDebugSnapshotSchema.parse(target)),
    input: async (input: z.input<typeof TuiDebugInputSchema>) => call("tui_input", TuiDebugInputSchema.parse(input)),
    wait: async (input: z.input<typeof TuiDebugWaitSchema>) => call("wait_for_tui", TuiDebugWaitSchema.parse(input)),
  }
}
