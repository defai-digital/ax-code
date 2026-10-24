import z from "zod"
import { Tool } from "./tool"
import { DesktopBrowser } from "../mcp/desktop-browser"
import { WebMcpAutoApproval } from "../mcp/webmcp-auto-approval"
import DESCRIPTION from "./desktop_webmcp.txt"

function permissionError(error: unknown) {
  if (!(error instanceof Error)) return false
  return (
    error.name === "PermissionRejectedError" ||
    error.name === "PermissionCorrectedError" ||
    error.name === "PermissionDeniedError" ||
    error.name === "QuestionRejectedError"
  )
}

function toolFailure(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  if (message.startsWith("Navigate requires"))
    return new DesktopBrowser.Failure({
      reason: "invalid-input",
      message,
      nextAction: "Pass action=navigate with an https:// or loopback http:// URL.",
    })
  if (message.startsWith("Wait requires"))
    return new DesktopBrowser.Failure({
      reason: "invalid-input",
      message,
      nextAction: "Pass waitText, the text to wait for.",
    })
  if (message.startsWith("Act requires"))
    return new DesktopBrowser.Failure({
      reason: "invalid-input",
      message,
      nextAction: "Pass readId and ref from the latest read, and how set to click, type, or select.",
    })
  if (message.startsWith("Invoke requires"))
    return new DesktopBrowser.Failure({
      reason: "invalid-input",
      message,
      nextAction: "List tools, then invoke with the toolName and digest from that listing.",
    })
  // Unknown failures stay native-failure. Do not copy the caught message: it may contain input.
  return new DesktopBrowser.Failure({
    reason: "native-failure",
    message: "The project browser operation failed.",
    nextAction: "Stop and report the failure; do not retry automatically.",
  })
}

// Ordinary sites register nothing. Some models read a bare [] as "not loaded yet" and
// list again in a loop, so the runtime names the next step beside the untrusted data.
const EMPTY_CATALOG_NOTE =
  "This page currently registers no WebMCP tools. Do not list it again unless the page changes; use action=read to see its text and controls."

// Desktop caps a read at these sizes (contract v1, DesktopBrowser.ReadOutput) without marking it.
const READ_TEXT_CAP = 8000
const READ_OUTLINE_CAP = 150

/**
 * The runtime's next step for a read or wait result, beside the untrusted data. A read
 * already covers off-screen content, so a cut read is not fixed by scrolling, and an
 * unmet wait repeated with the same text was a loop.
 */
function observationNote(operation: "read" | "wait" | "act", result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined
  if (operation === "wait" && "found" in result && result.found === false)
    return "The text did not appear before the timeout. Do not wait for the same text again; call action=read to see what the page shows now."
  if (operation !== "read" || !("text" in result) || !("outline" in result)) return undefined
  const textCut = typeof result.text === "string" && result.text.length >= READ_TEXT_CAP
  const outlineCut = Array.isArray(result.outline) && result.outline.length >= READ_OUTLINE_CAP
  if (!textCut && !outlineCut) return undefined
  const what = [
    textCut ? `the text at ${READ_TEXT_CAP} characters` : undefined,
    outlineCut ? `the outline at ${READ_OUTLINE_CAP} controls` : undefined,
  ]
    .filter(Boolean)
    .join(" and ")
  return `This read was cut: ${what}. It already includes off-screen content, so scrolling or reading again returns the same cut. Use action=wait for specific text, or navigate to a narrower page such as a search or detail URL.`
}

function listingOutput(listing: Record<string, unknown>, tools: readonly unknown[]) {
  return JSON.stringify({
    untrusted: true,
    ...listing,
    result: tools,
    ...(tools.length === 0 ? { note: EMPTY_CATALOG_NOTE } : {}),
  })
}

export const DesktopWebMcpTool = Tool.define("desktop_webmcp", {
  description: DESCRIPTION,
  parameters: z
    .object({
      action: z.enum(["list", "invoke", "navigate", "read", "act", "wait"]),
      url: z.string().max(2048).optional(),
      toolName: z.string().min(1).max(256).optional(),
      digest: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      input: z.record(z.string(), z.unknown()).optional(),
      readId: z.string().uuid().optional(),
      ref: z
        .string()
        .regex(/^e[1-9][0-9]{0,3}$/)
        .optional(),
      how: z.enum(["click", "type", "select"]).optional(),
      text: z.string().max(2000).optional(),
      waitText: z.string().min(1).max(200).optional(),
      timeoutMs: z.number().int().min(100).max(10000).optional(),
    })
    .strict(),
  async execute(params, ctx) {
    // Kept as one variable so every return path carries the same metadata type.
    const operation = params.action
    try {
      return await executeDesktopWebMcp(params, ctx, operation)
    } catch (error) {
      if (permissionError(error)) throw error
      const failure = error instanceof DesktopBrowser.Failure ? error : toolFailure(error)
      try {
        await ctx.metadata({
          metadata: {
            operation,
            reason: failure.data.reason,
            nextAction: failure.data.nextAction,
            ...(failure.data.path ? { path: failure.data.path } : {}),
          },
        })
      } catch {
        // The error data still carries reason and nextAction when metadata cannot be recorded.
      }
      throw failure
    }
  },
})

async function executeDesktopWebMcp(
  params: {
    action: "list" | "invoke" | "navigate" | "read" | "act" | "wait"
    url?: string
    toolName?: string
    digest?: string
    input?: Record<string, unknown>
    readId?: string
    ref?: string
    how?: "click" | "type" | "select"
    text?: string
    waitText?: string
    timeoutMs?: number
  },
  ctx: Tool.Context,
  operation: "list" | "invoke" | "navigate" | "read" | "act" | "wait",
) {
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
      output: listingOutput({ navigated }, tools),
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
  if (params.action === "read" || params.action === "wait" || params.action === "act") {
    const operation = params.action
    let action: { readId: string; ref: string; how: "click" | "type" | "select"; text?: string } | undefined
    let target: DesktopBrowser.OutlineEntry | undefined
    if (operation === "wait" && !params.waitText) throw new Error("Wait requires the text to wait for")
    if (operation === "act") {
      if (!params.readId || !params.ref || !params.how)
        throw new Error("Act requires readId and ref from the latest read, and how: click, type or select")
      action = { readId: params.readId, ref: params.ref, how: params.how, text: params.text }
      // Validate and resolve the element before asking, so the prompt names what will be touched.
      target = DesktopBrowser.prepareAction(binding, action).target
    }
    const metadata = {
      requireInteractive: false,
      desktopProvider: true,
      origin: binding.origin,
      operation,
      providerID: binding.providerID,
      generation: binding.generation,
      ...(target
        ? {
            how: params.how,
            element: { ref: target.ref, kind: target.kind, name: target.name, submit: target.submit === true },
            ...(params.how !== "click" ? { text: params.text } : {}),
          }
        : {}),
    }
    // Acting is never bound for auto-approval: every action asks, whatever the permission mode.
    if (operation !== "act")
      WebMcpAutoApproval.bindDesktop(
        metadata,
        { permission: "webmcp", patterns: [binding.origin] },
        async () => {
          await DesktopBrowser.checkPolicy(binding)
          return true
        },
        operation,
      )
    await ctx.ask({ permission: "webmcp", patterns: [binding.origin], always: [], metadata })
    const result =
      operation === "read"
        ? await DesktopBrowser.read(binding, ctx.abort)
        : operation === "wait"
          ? await DesktopBrowser.wait(binding, params.waitText!, params.timeoutMs ?? 5000, ctx.abort)
          : await DesktopBrowser.act(binding, action!, ctx.abort)
    const note = observationNote(operation, result)
    return {
      title: "Desktop WebMCP",
      output: JSON.stringify({ untrusted: true, result, ...(note ? { note } : {}) }),
      metadata: {
        truncated: false,
        providerID: binding.providerID,
        generation: binding.generation,
        operation,
      },
    }
  }
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
    // Display copy of the detached input. always stays empty: there is no standing grant.
    ...(invocation ? { inputPreview: DesktopBrowser.inputPreview(invocation.input) } : {}),
  }
  WebMcpAutoApproval.bindDesktop(
    metadata,
    { permission: "webmcp", patterns: [binding.origin] },
    async () => {
      await DesktopBrowser.checkPolicy(binding)
      // Same prepareInvocation as before the prompt, so the cached validator is reused.
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
  if (params.action === "list") {
    const tools = await DesktopBrowser.list(binding, ctx.abort)
    return {
      title: "Desktop WebMCP",
      output: listingOutput({}, tools),
      metadata: {
        truncated: false,
        providerID: binding.providerID,
        generation: binding.generation,
        operation: params.action,
      },
    }
  }
  const result = await DesktopBrowser.invoke(
    binding,
    invocation!.toolName,
    invocation!.digest,
    invocation!.input,
    ctx.abort,
  )
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
}
