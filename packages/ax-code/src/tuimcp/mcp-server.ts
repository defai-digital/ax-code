import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import z from "zod"
import { callTuiMcpEndpoint, readTuiMcpEndpoint } from "./endpoint"
import { ResultSchema, SelectSchema, reject } from "./protocol"
import type { Request } from "./protocol"

export function createTuiMcpServer(filename: string) {
  const server = new Server({ name: "ax-code-tuimcp", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_view_context",
        description:
          "Read bounded state of the explicitly shared live TUI. No transcript, draft, titles or credentials.",
        inputSchema: z.toJSONSchema(z.object({}).strict(), { target: "draft-7", io: "input" }),
        outputSchema: { ...z.toJSONSchema(ResultSchema, { target: "draft-7", io: "input" }), type: "object" },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: "select_session",
        description:
          "Navigate the shared TUI to a project session. Read context first and supply its identity/revision and a unique requestId. Success acknowledges route state only, not rendering or loading. On timeout_unknown or outcome_unknown, reconcile context; never automatically retry with a new requestId.",
        inputSchema: z.toJSONSchema(SelectSchema, { target: "draft-7", io: "input" }),
        outputSchema: { ...z.toJSONSchema(ResultSchema, { target: "draft-7", io: "input" }), type: "object" },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
    ],
  }))
  server.setRequestHandler(CallToolRequestSchema, async (input, extra) => {
    let request: Request | undefined
    if (
      input.params.name === "get_view_context" &&
      z
        .object({})
        .strict()
        .safeParse(input.params.arguments ?? {}).success
    ) {
      request = { operation: "get_view_context" }
    }
    if (input.params.name === "select_session") {
      const parsed = SelectSchema.safeParse(input.params.arguments)
      if (parsed.success) request = { operation: "select_session", ...parsed.data }
    }
    const result = request
      ? await callTuiMcpEndpoint(filename, request, { signal: extra.signal }).catch(() => reject("target_unavailable"))
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
