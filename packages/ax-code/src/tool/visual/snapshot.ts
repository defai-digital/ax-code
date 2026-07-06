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
    })
    .refine((params) => params.url || params.filePath, {
      message: "Either url or filePath must be provided",
    }),
  async execute(params, ctx) {
    // Check that the current model supports vision input
    const routing = await checkVisualRouting({ visionInput: true })
    if (!routing.ok) {
      throw new Error(routing.diagnostic)
    }

    const projectDir = Instance.directory
    const source = params.url
      ? { type: "url" as const, url: params.url }
      : { type: "file" as const, filePath: params.filePath! }

    log.info("snapshot request", {
      source: source.type,
      url: source.type === "url" ? source.url : undefined,
      filePath: source.type === "file" ? source.filePath : undefined,
    })

    const result = await captureSnapshot(projectDir, ctx.sessionID, source)

    const ext = result.screenshot.mime === "image/jpeg" ? "jpg" : "png"
    const mime = result.screenshot.mime ?? "image/png"

    return {
      title: `Snapshot: ${result.run.id}`,
      output: [
        `Snapshot captured and stored as visual run "${result.run.id}".`,
        `Source: ${source.type === "url" ? source.url : source.filePath}`,
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
