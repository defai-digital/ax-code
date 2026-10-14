import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./visual-critique.txt"
import { VisualArtifactStore } from "@/visual/artifact"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { checkVisualRouting, sessionModelFromMessages } from "@/visual/router"
import { Filesystem } from "@/util/filesystem"
import path from "path"
import { parseJsonStrict } from "@/util/json-value"

const log = Log.create({ service: "tool.visual_critique" })

export const VisualCritiqueTool = Tool.define("visual_critique", {
  description: DESCRIPTION,
  parameters: z.object({
    runID: z.string().describe("The visual run ID to critique"),
    focus: z
      .enum(["layout", "accessibility", "interaction", "performance"])
      .optional()
      .describe("Focus area to guide the critique"),
  }),
  async execute(params, ctx) {
    // Check that the session's model supports vision input
    const routing = await checkVisualRouting({ visionInput: true }, { model: sessionModelFromMessages(ctx.messages) })
    if (!routing.ok) {
      throw new Error(routing.diagnostic)
    }

    const projectDir = Instance.directory

    // Read the run summary to find screenshot artifacts
    const runDir = VisualArtifactStore.runDir(projectDir, params.runID)
    const fs = await import("fs")
    const summaryPath = `${runDir}/visual-run.json`

    let screenshotArtifacts: Array<{ id: string; path: string; label: string; width?: number; height?: number }> = []

    try {
      const summaryContent = await fs.promises.readFile(summaryPath, "utf-8")
      const run = z
        .object({
          artifacts: z
            .array(
              z.object({
                kind: z.string(),
                id: z.string().default(""),
                path: z.string().default(""),
                label: z.string().default(""),
                width: z.number().optional(),
                height: z.number().optional(),
              }),
            )
            .default([]),
        })
        .parse(parseJsonStrict(summaryContent))
      screenshotArtifacts = run.artifacts.filter((artifact) => artifact.kind === "screenshot" && artifact.path)
    } catch {
      // If no summary exists, try scanning the directory
      try {
        const entries = await fs.promises.readdir(runDir)
        screenshotArtifacts = entries
          .filter((e: string) => e.endsWith(".png") || e.endsWith(".jpg"))
          .map((e: string) => ({
            id: e.replace(/\.[^.]+$/, ""),
            path: `${runDir}/${e}`,
            label: e,
          }))
      } catch {
        throw new Error(
          `No artifacts found for run "${params.runID}". Run browser_capture first to generate screenshots.`,
        )
      }
    }

    // Apply the same boundary to manifest entries and directory-scan fallback.
    // A missing or malformed summary must not let a symlink attach an outside file.
    const runRootReal = await fs.promises.realpath(runDir).catch(() => undefined)
    const projectRootReal = await fs.promises.realpath(projectDir).catch(() => undefined)
    const confinedArtifacts: typeof screenshotArtifacts = []
    for (const artifact of screenshotArtifacts) {
      const resolved = path.resolve(artifact.path)
      const real = await fs.promises.realpath(resolved).catch(() => undefined)
      if (
        !runRootReal ||
        !projectRootReal ||
        !Filesystem.contains(projectRootReal, runRootReal) ||
        !Filesystem.contains(runDir, resolved) ||
        !real ||
        !Filesystem.contains(runRootReal, real)
      ) {
        log.warn("ignoring visual artifact outside its run directory", { runID: params.runID })
        continue
      }
      confinedArtifacts.push({ ...artifact, path: real })
    }
    screenshotArtifacts = confinedArtifacts

    if (screenshotArtifacts.length === 0) {
      throw new Error(
        `No screenshots found in run "${params.runID}". Run browser_capture first to generate screenshots.`,
      )
    }

    // Read screenshots as base64 for attachment
    const attachments = await Promise.all(
      screenshotArtifacts.map(async (a) => {
        const data = await fs.promises.readFile(a.path)
        const ext = a.path.endsWith(".jpg") ? "jpeg" : "png"
        return {
          type: "file" as const,
          filename: a.label,
          mime: ext === "jpeg" ? "image/jpeg" : "image/png",
          url: `data:image/${ext};base64,${data.toString("base64")}`,
        }
      }),
    )

    log.info("critique request", {
      runID: params.runID,
      screenshotCount: screenshotArtifacts.length,
      focus: params.focus,
    })

    const focusHint = params.focus ? ` Focus your analysis on ${params.focus} issues.` : ""

    return {
      title: `Visual critique: ${params.runID} (${screenshotArtifacts.length} screenshots)`,
      output: [
        `Analyze these ${screenshotArtifacts.length} screenshot(s) from visual run "${params.runID}".${focusHint}`,
        "",
        "For each issue found, report:",
        "- severity: info, warning, error, or critical",
        "- category: layout, accessibility, interaction, performance, console, network, or copy",
        "- title: brief description of the issue",
        "- suggestedFix: brief fix suggestion (optional)",
        "",
        "Return your findings as a JSON array.",
      ].join("\n"),
      metadata: {
        runID: params.runID,
        screenshotCount: screenshotArtifacts.length,
        focus: params.focus,
        artifactPaths: screenshotArtifacts.map((a) => a.path),
      },
      attachments,
    }
  },
})
