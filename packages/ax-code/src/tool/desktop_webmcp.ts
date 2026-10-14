import z from "zod"
import { Tool } from "./tool"
import { DesktopBrowser } from "../mcp/desktop-browser"
import { WebMcpAutoApproval } from "../mcp/webmcp-auto-approval"
import DESCRIPTION from "./desktop_webmcp.txt"

export const DesktopWebMcpTool = Tool.define("desktop_webmcp", {
  description: DESCRIPTION,
  parameters: z
    .object({
      action: z.enum(["list", "invoke", "navigate"]),
      url: z.string().max(2048).optional(),
      toolName: z.string().min(1).max(256).optional(),
      digest: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      input: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  async execute(params, ctx) {
    // Kept as one variable so every return path carries the same metadata type.
    const operation = params.action
    // Navigation is the one action that works before a page is granted: the pane
    // may be blank, and opening the URL is exactly what the user would otherwise
    // have to type. It is approved against the target origin instead of a page.
    if (params.action === "navigate") {
      if (!params.url) throw new Error("Navigate requires the https:// or loopback http:// URL to open")
      const target = DesktopBrowser.navigableUrl(params.url)
      const metadata = {
        requireInteractive: false,
        desktopProvider: true,
        origin: target.origin,
        operation,
      }
      WebMcpAutoApproval.bindDesktop(
        metadata,
        { permission: "webmcp", patterns: [target.origin] },
        async () => true,
        "navigate",
      )
      await ctx.ask({ permission: "webmcp", patterns: [target.origin], always: [], metadata })
      const navigated = await DesktopBrowser.navigate(ctx.sessionID, params.url, ctx.abort)
      const binding = DesktopBrowser.forSession(ctx.sessionID)
      await DesktopBrowser.checkPolicy(binding)
      const tools = await DesktopBrowser.list(binding, ctx.abort)
      return {
        title: "Desktop WebMCP",
        output: JSON.stringify({ untrusted: true, navigated, result: tools }),
        metadata: {
          truncated: false,
          providerID: binding.providerID,
          generation: binding.generation,
          operation,
        },
      }
    }

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
    const metadata = {
      requireInteractive: false,
      desktopProvider: true,
      origin: binding.origin,
      operation: params.action,
      toolName: params.toolName,
      providerID: binding.providerID,
      generation: binding.generation,
      definitionDigest: params.digest,
    }
    WebMcpAutoApproval.bindDesktop(
      metadata,
      { permission: "webmcp", patterns: [binding.origin] },
      async () => {
        await DesktopBrowser.checkPolicy(binding)
        if (invocation)
          DesktopBrowser.prepareInvocation(binding, invocation.toolName, invocation.digest, invocation.input)
        return true
      },
      params.action,
    )
    await ctx.ask({
      permission: "webmcp",
      patterns: [binding.origin],
      always: [],
      metadata,
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
