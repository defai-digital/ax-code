import z from "zod"
import { Tool } from "./tool"
import { DesktopBrowser } from "../mcp/desktop-browser"
import DESCRIPTION from "./desktop_webmcp.txt"

export const DesktopWebMcpTool = Tool.define("desktop_webmcp", {
  description: DESCRIPTION,
  parameters: z
    .object({
      action: z.enum(["list", "invoke"]),
      toolName: z.string().min(1).max(256).optional(),
      digest: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      input: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  async execute(params, ctx) {
    const binding = DesktopBrowser.forSession(ctx.sessionID)
    await DesktopBrowser.checkPolicy(binding)
    if (params.action === "invoke" && (!params.toolName || !params.digest)) {
      throw new Error("Invoke requires a tool name and definition digest from a fresh listing")
    }
    // Validate and detach arguments before the approval wait; callers cannot mutate an approved input.
    const invocation =
      params.action === "invoke"
        ? DesktopBrowser.prepareInvocation(binding, params.toolName!, params.digest!, params.input ?? {})
        : undefined
    await ctx.ask({
      permission: "webmcp",
      patterns: [binding.origin],
      always: [],
      metadata: {
        requireInteractive: true,
        desktopProvider: true,
        origin: binding.origin,
        operation: params.action,
        toolName: params.toolName,
        providerID: binding.providerID,
        generation: binding.generation,
        definitionDigest: params.digest,
      },
    })
    const result =
      params.action === "list"
        ? await DesktopBrowser.list(binding, ctx.abort)
        : await DesktopBrowser.invoke(binding, invocation!.toolName, invocation!.digest, invocation!.input, ctx.abort)
    return {
      title: "Desktop WebMCP",
      output: JSON.stringify({ untrusted: true, result }),
      metadata: {
        truncated: false,
        providerID: binding.providerID,
        generation: binding.generation,
        operation: params.action,
      },
    }
  },
})
