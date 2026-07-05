import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./browser-console.txt"
import { BrowserRuntime } from "./runtime"

export const BrowserConsoleTool = Tool.define("browser_console", {
  description: DESCRIPTION,
  parameters: z.object({
    types: z
      .array(z.enum(["log", "error", "warn", "info", "debug", "trace", "assert", "clear", "table"]))
      .optional()
      .describe("Filter by message type (default: all)"),
    pageIdx: z.number().int().min(0).default(0).describe("Page index for pagination"),
    pageSize: z.number().int().min(1).max(100).default(50).describe("Number of messages per page"),
  }),
  async execute(params, ctx) {
    const runtime = BrowserRuntime.get()
    const messages = await runtime.console("latest", {
      types: params.types,
      pageIdx: params.pageIdx,
      pageSize: params.pageSize,
    })

    const output = messages.map((m) => `[${m.type}] ${m.text}`).join("\n")

    return {
      title: `Console messages (${messages.length})`,
      output: output || "No console messages found.",
      metadata: {
        count: messages.length,
        pageIdx: params.pageIdx,
        pageSize: params.pageSize,
      },
    }
  },
})
