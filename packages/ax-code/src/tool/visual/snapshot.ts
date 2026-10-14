import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./visual-snapshot.txt"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { captureSnapshot } from "@/visual/snapshot"
import { checkVisualRouting, sessionModelFromMessages } from "@/visual/router"
import { BrowserPermission } from "@/visual/permission"
import { fileToolGuard } from "../external-directory"

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
    // Check that the session's model supports vision input
    const routing = await checkVisualRouting({ visionInput: true }, { model: sessionModelFromMessages(ctx.messages) })
    if (!routing.ok) {
      throw new Error(routing.diagnostic)
    }

    const projectDir = Instance.directory

    // A URL capture drives a real browser, so it needs the same gate as
    // browser_open: reject file:/data: and ask for network egress. Without it a
    // prompt could screenshot file:///… and attach local file bytes.
    if (params.url) {
      const validation = BrowserPermission.validateUrl(params.url)
      if (!validation.valid) throw new Error(validation.reason)
      await ctx.ask({
        permission: "browser_open",
        patterns: [params.url],
        always: BrowserPermission.permissionPatterns(params.url),
        metadata: { url: params.url },
      })
    }
    // A file capture reads a model-supplied path off disk, so run it through the
    // same guard as `read`: resolve against the project directory, prompt for the
    // external-directory boundary, and reject a link whose target leaves the
    // project. Asking for `read` on the raw input let a linked path inside the
    // workspace attach an outside file without that boundary check.
    const filePath = params.filePath ? await fileToolGuard(ctx, params.filePath) : undefined
    if (filePath) {
      await ctx.ask({ permission: "read", patterns: [filePath], always: ["*"], metadata: {} })
    }

    const source = params.url
      ? { type: "url" as const, url: params.url }
      : filePath
        ? { type: "file" as const, filePath }
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
