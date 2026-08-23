import { z } from "zod"

/**
 * The versioned canonical AX Computer MCP contract. One MCP stdio server
 * exposes the five canonical tools below and carries every payload in the
 * shapes validated here — full input AND output validation, unlike the OCU
 * dialect contract (protocol-contract.ts), which only checks tool names.
 *
 * Versioning: the server advertises its protocol version in the MCP
 * `initialize` result under the `axComputer` field
 * (`{ version, minVersion? }`); clients call validateProtocolPeer() on that
 * result before issuing any tool call. A peer is compatible when the version
 * ranges overlap: the server can serve at least one version this client
 * speaks (`server.version >= client min` and `server.minVersion <= client
 * version`).
 */

export const AX_COMPUTER_PROTOCOL_VERSION = 1

/** oldest protocol version this client can still interoperate with */
export const AX_COMPUTER_PROTOCOL_MIN_VERSION = 1

export type ProtocolErrorCode = "missing_protocol" | "incompatible_version" | "invalid_payload"

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode

  constructor(code: ProtocolErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "ProtocolError"
    this.code = code
  }
}

// ---- payload schemas (mirror the canonical types) ----

export const BoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})

export const PixelImageSchema = z.object({
  /** base64-encoded image bytes */
  data: z.string(),
  mimeType: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
})

export const ComputerElementSchema = z.object({
  id: z.string(),
  role: z.string().optional(),
  name: z.string().optional(),
  value: z.string().optional(),
  bounds: BoundsSchema.optional(),
  enabled: z.boolean().optional(),
  focused: z.boolean().optional(),
})

export const AppInfoSchema = z.object({
  name: z.string(),
  pid: z.number().optional(),
  bundleId: z.string().optional(),
})

export const WindowInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  bounds: BoundsSchema,
  app: AppInfoSchema.optional(),
})

export const ComputerObservationSchema = z.object({
  platform: z.string(),
  provider: z.string(),
  /** epoch milliseconds */
  timestamp: z.number(),
  app: AppInfoSchema.optional(),
  window: WindowInfoSchema.optional(),
  screenshot: PixelImageSchema.optional(),
  elements: z.array(ComputerElementSchema),
  a11yText: z.string().optional(),
  /** the untouched backend payload, for debugging and forward-compat */
  raw: z.unknown().optional(),
})

export const MouseButtonSchema = z.enum(["left", "right", "middle"])

export const ComputerTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("element"), id: z.string() }),
  z.object({ kind: z.literal("point"), x: z.number(), y: z.number() }),
])

export const COMPUTER_ACTION_TYPES = [
  "click",
  "type",
  "keypress",
  "scroll",
  "drag",
  "set_value",
  "activate_window",
  "launch_app",
] as const

export const ComputerActionTypeSchema = z.enum(COMPUTER_ACTION_TYPES)

export const ComputerActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    target: ComputerTargetSchema,
    button: MouseButtonSchema.optional(),
    count: z.number().optional(),
  }),
  z.object({ type: z.literal("type"), text: z.string() }),
  z.object({ type: z.literal("keypress"), keys: z.array(z.string()) }),
  z.object({
    type: z.literal("scroll"),
    target: ComputerTargetSchema.optional(),
    direction: z.enum(["up", "down", "left", "right"]),
    amount: z.number().optional(),
  }),
  z.object({ type: z.literal("drag"), from: ComputerTargetSchema, to: ComputerTargetSchema }),
  z.object({ type: z.literal("set_value"), target: ComputerTargetSchema, value: z.string() }),
  z.object({ type: z.literal("activate_window"), windowId: z.string() }),
  z.object({ type: z.literal("launch_app"), app: z.string() }),
])

export const ActionResultSchema = z.object({
  ok: z.boolean(),
  provider: z.string(),
  action: ComputerActionTypeSchema,
  detail: z.string().optional(),
  /** backend refusal code carried verbatim */
  refusal: z.string().optional(),
})

export const ObserveScopeSchema = z.union([
  z.object({ app: z.string() }),
  z.object({ windowId: z.string() }),
  z.object({ desktop: z.literal(true) }),
])

export const ProviderCapabilitiesSchema = z.object({
  actions: z.array(ComputerActionTypeSchema),
  backgroundDelivery: z.boolean(),
  elementTargeting: z.boolean(),
  windowActivation: z.boolean(),
})

// ---- canonical tool I/O envelopes ----

/** ax_list_apps result envelope (carried in structuredContent) */
export const ListAppsResultSchema = z.object({ apps: z.array(AppInfoSchema) })

/** ax_list_windows result envelope (carried in structuredContent) */
export const ListWindowsResultSchema = z.object({ windows: z.array(WindowInfoSchema) })

export const AX_CAPABILITIES_TOOL = "ax_capabilities"
export const AX_LIST_APPS_TOOL = "ax_list_apps"
export const AX_LIST_WINDOWS_TOOL = "ax_list_windows"
export const AX_OBSERVE_TOOL = "ax_observe"
export const AX_ACT_TOOL = "ax_act"

export interface CanonicalToolDefinition {
  name: string
  description: string
  /** JSON Schema for the tool arguments, as advertised over MCP tools/list */
  inputSchema: Record<string, unknown>
}

const SCOPE_JSON_SCHEMA: Record<string, unknown> = {
  oneOf: [
    { type: "object", properties: { app: { type: "string" } }, required: ["app"], additionalProperties: false },
    {
      type: "object",
      properties: { windowId: { type: "string" } },
      required: ["windowId"],
      additionalProperties: false,
    },
    { type: "object", properties: { desktop: { const: true } }, required: ["desktop"], additionalProperties: false },
  ],
}

const TARGET_JSON_SCHEMA: Record<string, unknown> = {
  oneOf: [
    {
      type: "object",
      properties: { kind: { const: "element" }, id: { type: "string" } },
      required: ["kind", "id"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { kind: { const: "point" }, x: { type: "number" }, y: { type: "number" } },
      required: ["kind", "x", "y"],
      additionalProperties: false,
    },
  ],
}

const ACTION_JSON_SCHEMA: Record<string, unknown> = {
  oneOf: [
    {
      type: "object",
      properties: {
        type: { const: "click" },
        target: TARGET_JSON_SCHEMA,
        button: { enum: ["left", "right", "middle"] },
        count: { type: "number" },
      },
      required: ["type", "target"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { type: { const: "type" }, text: { type: "string" } },
      required: ["type", "text"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { type: { const: "keypress" }, keys: { type: "array", items: { type: "string" } } },
      required: ["type", "keys"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "scroll" },
        target: TARGET_JSON_SCHEMA,
        direction: { enum: ["up", "down", "left", "right"] },
        amount: { type: "number" },
      },
      required: ["type", "direction"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { type: { const: "drag" }, from: TARGET_JSON_SCHEMA, to: TARGET_JSON_SCHEMA },
      required: ["type", "from", "to"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { type: { const: "set_value" }, target: TARGET_JSON_SCHEMA, value: { type: "string" } },
      required: ["type", "target", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { type: { const: "activate_window" }, windowId: { type: "string" } },
      required: ["type", "windowId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { type: { const: "launch_app" }, app: { type: "string" } },
      required: ["type", "app"],
      additionalProperties: false,
    },
  ],
}

const NO_ARGS_JSON_SCHEMA: Record<string, unknown> = { type: "object", additionalProperties: false }

/**
 * The five canonical tools every AX Computer MCP server exposes. Designed to
 * be served by one MCP stdio server; arguments and results are validated
 * against the zod schemas above on both sides of the wire.
 */
export const AX_COMPUTER_TOOLS: readonly CanonicalToolDefinition[] = [
  {
    name: AX_CAPABILITIES_TOOL,
    description:
      "Return the provider's capabilities: supported action types, background delivery, element targeting, and window activation.",
    inputSchema: NO_ARGS_JSON_SCHEMA,
  },
  {
    name: AX_LIST_APPS_TOOL,
    description: "List applications visible to the backend. Result: { apps: AppInfo[] } in structuredContent.",
    inputSchema: NO_ARGS_JSON_SCHEMA,
  },
  {
    name: AX_LIST_WINDOWS_TOOL,
    description: "List windows visible to the backend. Result: { windows: WindowInfo[] } in structuredContent.",
    inputSchema: NO_ARGS_JSON_SCHEMA,
  },
  {
    name: AX_OBSERVE_TOOL,
    description:
      "Observe a scope ({ app } | { windowId } | { desktop: true }); returns a ComputerObservation in structuredContent. Element ids are only valid against the observation that issued them.",
    inputSchema: {
      type: "object",
      properties: { scope: SCOPE_JSON_SCHEMA },
      required: ["scope"],
      additionalProperties: false,
    },
  },
  {
    name: AX_ACT_TOOL,
    description:
      "Execute one ComputerAction against the backend; returns an ActionResult in structuredContent. Refusals are reported as { ok: false, refusal } results, not transport errors.",
    inputSchema: {
      type: "object",
      properties: { action: ACTION_JSON_SCHEMA },
      required: ["action"],
      additionalProperties: false,
    },
  },
]

// ---- payload validation ----

/**
 * Parse one wire payload against a canonical schema. Zod issues are folded
 * into a ProtocolError naming the context (tool/direction) so a misbehaving
 * peer surfaces a protocol error here instead of a crash deep in mapping.
 */
export function validatePayload<S extends z.ZodType>(schema: S, payload: unknown, context: string): z.output<S> {
  const parsed = schema.safeParse(payload)
  if (parsed.success) return parsed.data
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")
  throw new ProtocolError("invalid_payload", `AX Computer protocol payload failed validation (${context}): ${issues}`, {
    cause: parsed.error,
  })
}

// ---- version negotiation ----

/** version advertisement a server embeds in its MCP initialize result */
export interface ProtocolAdvertisement {
  version: number
  /** oldest client protocol version the server can still serve (default: version) */
  minVersion?: number
}

const AdvertisementSchema = z.object({
  version: z.number().int().positive(),
  minVersion: z.number().int().positive().optional(),
})

/** the initialize-result field this client advertises; servers embed the same shape */
export function protocolAdvertisement(): { axComputer: ProtocolAdvertisement } {
  return { axComputer: { version: AX_COMPUTER_PROTOCOL_VERSION, minVersion: AX_COMPUTER_PROTOCOL_MIN_VERSION } }
}

/**
 * Validate a peer's MCP initialize result against this client's protocol
 * range. Returns the negotiated advertisement on success; throws a
 * ProtocolError with a clear message when the server does not speak the AX
 * Computer protocol at all ("missing_protocol") or speaks only incompatible
 * versions ("incompatible_version").
 */
export function validateProtocolPeer(initializeResult: unknown): Required<ProtocolAdvertisement> {
  const field =
    typeof initializeResult === "object" && initializeResult !== null
      ? (initializeResult as Record<string, unknown>).axComputer
      : undefined
  if (field === undefined) {
    throw new ProtocolError(
      "missing_protocol",
      "MCP server does not advertise the AX Computer protocol (no axComputer field in the initialize result); it cannot serve as an external computer-use backend",
    )
  }
  const peer = validatePayload(AdvertisementSchema, field, "initialize result axComputer")
  const peerMin = peer.minVersion ?? peer.version
  if (peer.version < AX_COMPUTER_PROTOCOL_MIN_VERSION || peerMin > AX_COMPUTER_PROTOCOL_VERSION) {
    throw new ProtocolError(
      "incompatible_version",
      `AX Computer protocol version mismatch: this client speaks versions ${AX_COMPUTER_PROTOCOL_MIN_VERSION}..${AX_COMPUTER_PROTOCOL_VERSION}, but the server speaks ${peerMin}..${peer.version}. Upgrade the server or the client so the ranges overlap.`,
    )
  }
  return { version: peer.version, minVersion: peerMin }
}
