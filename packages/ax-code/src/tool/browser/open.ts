import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./browser-open.txt"
import { BrowserPermission } from "@/visual/permission"
import { BrowserRuntime } from "./runtime"

export const BrowserOpenTool = Tool.define("browser_open", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("The URL to open (http:// or https:// only)"),
    viewport: z
      .object({
        width: z.number().int().min(320).max(3840).default(1440),
        height: z.number().int().min(240).max(2160).default(900),
      })
      .default({ width: 1440, height: 900 })
      .describe("Viewport dimensions"),
  }),
  async execute(params, ctx) {
    const validation = BrowserPermission.validateUrl(params.url)
    if (!validation.valid) {
      throw new Error(validation.reason)
    }

    await ctx.ask({
      permission: "browser_open",
      patterns: [params.url],
      always: ["*"],
      metadata: {
        url: params.url,
        viewport: params.viewport,
      },
    })

    const runtime = BrowserRuntime.get()
    const page = await runtime.open(params.url, params.viewport)

    return {
      title: `Opened ${page.title || params.url}`,
      output: JSON.stringify(page, null, 2),
      metadata: {
        pageID: page.pageID,
        url: page.url,
        title: page.title,
        viewport: page.viewport,
      },
    }
  },
})
