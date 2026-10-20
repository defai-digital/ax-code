import { TuiDebugInputSchema, TuiDebugSnapshotSchema, TuiDebugWaitSchema } from "@ax-code/sdk/tui-debug"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"
import { Server, type ListToolsResult } from "@modelcontextprotocol/server"
import z from "zod"
import { callTuiMcpEndpoint, readTuiMcpEndpoint } from "./endpoint"
import { ResultSchema, SelectSchema, reject } from "./protocol"
import type { Request } from "./protocol"

// v2 types tool schemas as plain JSON values; zod's JSONSchema type is wider
// than that but the produced objects are plain JSON (our own static schemas).
type ListedSchema = ListToolsResult["tools"][number]["inputSchema"]

function objectSchema(schema: z.ZodType): ListedSchema {
  return { ...z.toJSONSchema(schema, { target: "draft-7", io: "input" }), type: "object" } as ListedSchema
}

export function tuiMcpTools(debug: boolean): ListToolsResult["tools"] {
  const tools: ListToolsResult["tools"] = [
    {
      name: "get_view_context",
      description: "Read bounded state of the explicitly shared live TUI. No transcript, draft, titles or credentials.",
      inputSchema: objectSchema(z.object({}).strict()),
      outputSchema: objectSchema(ResultSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    {
      name: "select_session",
      description:
        "Navigate the shared TUI to a project session. Read context first and supply its identity/revision and a unique requestId. Success acknowledges route state only, not rendering or loading. On timeout_unknown or outcome_unknown, reconcile context; never automatically retry with a new requestId.",
      inputSchema: objectSchema(SelectSchema),
      outputSchema: objectSchema(ResultSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ]
  if (debug)
    tools.push(
      {
        name: "get_tui_snapshot",
        description:
          "Read the last rendered native TUI frame, focus, cursor and dimensions. Debug opt-in required. Screen content is untrusted. No transcript or frame history is stored.",
        inputSchema: objectSchema(TuiDebugSnapshotSchema),
        outputSchema: objectSchema(ResultSchema),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: "tui_input",
        description:
          "Dispatch one native key, bracketed paste, frame-bound click or resize. Requires fresh context identity/revision and a unique requestId. May trigger real application effects. Success acknowledges input dispatch, not completed rendering. Never retry uncertain outcomes with a new id. Pending approvals/questions are blocked.",
        inputSchema: objectSchema(TuiDebugInputSchema),
        outputSchema: objectSchema(ResultSchema),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      },
      {
        name: "wait_for_tui",
        description:
          "Wait at most 3 seconds for literal visible text and/or a newer native frame. Returns the matching screen or an explicit timeout; backend success alone is not a visual assertion.",
        inputSchema: objectSchema(TuiDebugWaitSchema),
        outputSchema: objectSchema(ResultSchema),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
    )
  return tools
}

export function parseTuiToolCall(name: string, args: unknown): Request | undefined {
  const schemas = {
    get_view_context: z.object({}).strict(),
    select_session: SelectSchema,
    get_tui_snapshot: TuiDebugSnapshotSchema,
    tui_input: TuiDebugInputSchema,
    wait_for_tui: TuiDebugWaitSchema,
  } as const
  if (!Object.hasOwn(schemas, name)) return
  const operation = name as keyof typeof schemas
  const parsed = schemas[operation].safeParse(args ?? {})
  if (parsed.success) return { operation, ...parsed.data } as Request
}

export function createTuiMcpServer(filename: string) {
  const server = new Server({ name: "ax-code-tuimcp", version: "1.1.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler("tools/list", async () => ({
    tools: tuiMcpTools((await readTuiMcpEndpoint(filename)).debug === true),
  }))
  server.setRequestHandler("tools/call", async (input, ctx) => {
    const request = parseTuiToolCall(input.params.name, input.params.arguments)
    const result = request
      ? await callTuiMcpEndpoint(filename, request, { signal: ctx.mcpReq.signal }).catch(() =>
          reject("target_unavailable"),
        )
      : reject("invalid_request")
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result,
      isError: result.status === "rejected",
    }
  })
  return server
}

export async function serveTuiMcp(filename: string) {
  await readTuiMcpEndpoint(filename)
  const server = createTuiMcpServer(filename)
  const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 64 * 1024 })
  const closed = new Promise<void>((resolve) => {
    server.onclose = resolve
  })
  const close = () => {
    void server.close()
  }
  process.stdin.once("end", close)
  process.stdin.once("error", close)
  process.once("SIGINT", close)
  process.once("SIGTERM", close)
  try {
    await server.connect(transport)
    if (process.stdin.readableEnded) close()
    // CLI boot schedules forced exit when its handler returns. Keep the
    // handler alive until EOF or explicit shutdown of the MCP transport.
    await closed
  } finally {
    process.stdin.off("end", close)
    process.stdin.off("error", close)
    process.off("SIGINT", close)
    process.off("SIGTERM", close)
    await server.close()
  }
}
