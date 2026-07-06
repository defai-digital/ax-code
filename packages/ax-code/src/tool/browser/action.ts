import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./browser-action.txt"
import { BrowserPermission } from "@/visual/permission"
import { BrowserRuntime } from "./runtime"

export const BrowserActionTool = Tool.define("browser_action", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z
      .enum(["click", "fill", "press", "hover", "scroll", "select", "navigate", "waitFor", "drag", "uploadFile"])
      .describe("The action to perform"),
    uid: z
      .string()
      .optional()
      .describe("Element UID from the latest snapshot (required for click, fill, hover, select, drag, uploadFile)"),
    value: z.string().optional().describe("Value for fill or select actions"),
    key: z.string().optional().describe("Key or key combination for press action (e.g. 'Enter', 'Control+A')"),
    url: z.string().optional().describe("URL for navigate action"),
    type: z.enum(["url", "back", "forward", "reload"]).optional().describe("Navigation type for navigate action"),
    text: z.string().optional().describe("Text to wait for (waitFor action)"),
    timeout: z.number().optional().describe("Timeout in milliseconds (waitFor action)"),
    direction: z.enum(["up", "down", "left", "right"]).optional().describe("Scroll direction"),
    amount: z.number().optional().describe("Scroll amount in pixels"),
    dblClick: z.boolean().optional().describe("Double-click instead of single click"),
    fromUid: z.string().optional().describe("Source element UID for drag action"),
    toUid: z.string().optional().describe("Target element UID for drag action"),
    filePaths: z.array(z.string()).optional().describe("File paths for uploadFile action"),
  }),
  async execute(params, ctx) {
    // Validate URL for navigate actions to prevent bypassing browser_open guards
    if (params.action === "navigate" && params.url && (!params.type || params.type === "url")) {
      const validation = BrowserPermission.validateUrl(params.url)
      if (!validation.valid) {
        throw new Error(validation.reason)
      }
      await ctx.ask({
        permission: "browser_open",
        patterns: [params.url],
        always: BrowserPermission.permissionPatterns(params.url),
        metadata: { url: params.url },
      })
    }

    const runtime = BrowserRuntime.get()
    const result = await runtime.action("latest", params.action, params as Record<string, unknown>)

    return {
      title: `${params.action}${params.uid ? ` [${params.uid}]` : ""}`,
      output: result || `${params.action} completed`,
      metadata: {
        action: params.action,
        uid: params.uid,
      },
    }
  },
})
