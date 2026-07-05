import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./browser-capture.txt"
import { BrowserRuntime } from "./runtime"

export const BrowserCaptureTool = Tool.define("browser_capture", {
  description: DESCRIPTION,
  parameters: z.object({
    fullPage: z.boolean().default(false).describe("Capture the full page (scroll and stitch)"),
    format: z.enum(["png", "jpeg"]).default("png").describe("Image format"),
    quality: z.number().min(1).max(100).optional().describe("JPEG quality (1-100)"),
    uid: z.string().optional().describe("Element UID from the latest snapshot (captures specific element)"),
  }),
  async execute(params, ctx) {
    const runtime = BrowserRuntime.get()
    const screenshot = await runtime.screenshot("latest", {
      fullPage: params.fullPage,
      format: params.format,
      quality: params.quality,
      uid: params.uid,
    })

    return {
      title: params.uid
        ? `Element ${params.uid} screenshot`
        : params.fullPage
          ? "Full-page screenshot"
          : "Viewport screenshot",
      output: `Screenshot captured (${screenshot.width}x${screenshot.height}, ${screenshot.format})`,
      metadata: {
        pageID: screenshot.pageID,
        format: screenshot.format,
        width: screenshot.width,
        height: screenshot.height,
      },
      attachments: [
        {
          type: "file" as const,
          filename: `screenshot.${screenshot.format === "jpeg" ? "jpg" : "png"}`,
          mime: screenshot.format === "jpeg" ? "image/jpeg" : "image/png",
          url: `data:${screenshot.format === "jpeg" ? "image/jpeg" : "image/png"};base64,${screenshot.data.toString("base64")}`,
        },
      ],
    }
  },
})
