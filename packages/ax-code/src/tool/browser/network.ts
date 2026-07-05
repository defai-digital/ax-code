import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./browser-network.txt"
import { BrowserRuntime } from "./runtime"

export const BrowserNetworkTool = Tool.define("browser_network", {
  description: DESCRIPTION,
  parameters: z.object({
    resourceTypes: z
      .array(
        z.enum([
          "document",
          "stylesheet",
          "image",
          "media",
          "font",
          "script",
          "xhr",
          "fetch",
          "websocket",
          "eventsource",
          "manifest",
          "other",
        ]),
      )
      .optional()
      .describe("Filter by resource type (default: all)"),
    pageIdx: z.number().int().min(0).default(0).describe("Page index for pagination"),
    pageSize: z.number().int().min(1).max(100).default(50).describe("Number of requests per page"),
  }),
  async execute(params, ctx) {
    const runtime = BrowserRuntime.get()
    const requests = await runtime.network("latest", {
      resourceTypes: params.resourceTypes,
      pageIdx: params.pageIdx,
      pageSize: params.pageSize,
    })

    const output = requests.map((r) => `${r.method} ${r.status} ${r.resourceType} ${r.url}`).join("\n")

    return {
      title: `Network requests (${requests.length})`,
      output: output || "No network requests found.",
      metadata: {
        count: requests.length,
        pageIdx: params.pageIdx,
        pageSize: params.pageSize,
      },
    }
  },
})
