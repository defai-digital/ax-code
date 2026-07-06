import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./visual-snapshot.txt"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { captureSnapshot } from "@/visual/snapshot"
import { checkVisualRouting } from "@/visual/router"

const log = Log.create({ service: "tool.visual_snapshot" })

export const VisualSnapshotTool = Tool.define("visual_snapshot", {
  description: DESCRIPTION,
  parameters: z
    .object({
      url: z.string().url().optional().describe("URL to capture (e.g. http://localhost:3000)"),
      filePath: z.string().optional().describe("Path to an existing image file to attach"),
      source: z
        .enum(["screen", "frontmost-window", "window", "region", "terminal"])
        .optional()
        .describe("Native capture source for non-web UI: screen, frontmost-window, window, region, or terminal"),
      display: z.number().int().positive().optional().describe("Display number for native screen capture on macOS"),
      appName: z.string().optional().describe("Native application/process name for window or terminal capture"),
      windowTitle: z.string().optional().describe("Window title substring for native window or terminal capture"),
      windowID: z.number().int().positive().optional().describe("macOS native window id for direct window capture"),
      x: z.number().int().nonnegative().optional().describe("Region x coordinate for native region capture"),
      y: z.number().int().nonnegative().optional().describe("Region y coordinate for native region capture"),
      width: z.number().int().positive().optional().describe("Region width for native region capture"),
      height: z.number().int().positive().optional().describe("Region height for native region capture"),
    })
    .refine((params) => params.url || params.filePath || params.source, {
      message: "Provide url, filePath, or source",
    })
    .refine(
      (params) =>
        params.source !== "region" ||
        (params.x !== undefined && params.y !== undefined && params.width !== undefined && params.height !== undefined),
      {
        message: "source:region requires x, y, width, and height",
      },
    ),
  async execute(params, ctx) {
    // Check that the current model supports vision input
    const routing = await checkVisualRouting({ visionInput: true })
    if (!routing.ok) {
      throw new Error(routing.diagnostic)
    }

    const projectDir = Instance.directory
    const source = params.url
      ? { type: "url" as const, url: params.url }
      : params.filePath
        ? { type: "file" as const, filePath: params.filePath }
        : params.source === "region"
          ? { type: "region" as const, x: params.x!, y: params.y!, width: params.width!, height: params.height! }
          : params.source === "window"
            ? {
                type: "window" as const,
                appName: params.appName,
                windowTitle: params.windowTitle,
                windowID: params.windowID,
              }
            : params.source === "terminal"
              ? { type: "terminal" as const, appName: params.appName, windowTitle: params.windowTitle }
              : params.source === "frontmost-window"
                ? { type: "frontmost-window" as const }
                : { type: "screen" as const, display: params.display }

    log.info("snapshot request", {
      source: source.type,
      url: source.type === "url" ? source.url : undefined,
      filePath: source.type === "file" ? source.filePath : undefined,
      appName: "appName" in source ? source.appName : undefined,
      windowTitle: "windowTitle" in source ? source.windowTitle : undefined,
    })

    const result = await captureSnapshot(projectDir, ctx.sessionID, source)

    const ext = result.screenshot.mime === "image/jpeg" ? "jpg" : "png"
    const mime = result.screenshot.mime ?? "image/png"

    return {
      title: `Snapshot: ${result.run.id}`,
      output: [
        `Snapshot captured and stored as visual run "${result.run.id}".`,
        `Source: ${source.type === "url" ? source.url : source.type === "file" ? source.filePath : source.type}`,
        `Format: ${mime}, Size: ${result.screenshotData.length} bytes`,
        "",
        "Use visual_critique to analyze this snapshot, or reference the run ID for comparison.",
      ].join("\n"),
      metadata: {
        runID: result.run.id,
        source: source.type,
        format: mime,
        artifactPath: result.screenshot.path,
      },
      attachments: [
        {
          type: "file" as const,
          filename: `snapshot.${ext}`,
          mime,
          url: `data:${mime};base64,${result.screenshotData.toString("base64")}`,
        },
      ],
    }
  },
})
