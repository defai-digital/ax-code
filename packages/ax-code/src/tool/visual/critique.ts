import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./visual-critique.txt"
import { VisualArtifactStore } from "@/visual/artifact"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { checkVisualRouting, sessionModelFromMessages } from "@/visual/router"
import { Filesystem } from "@/util/filesystem"
import path from "path"

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
      const run = JSON.parse(summaryContent)
      // The run summary is untrusted (a prompt-injected write can ship a crafted
      // .ax-code/ tree), so confine screenshot reads to the run directory instead
      // of attaching an arbitrary file to the model. `Filesystem.contains` is
      // lexical — it does not resolve symlinks — so the canonical path is checked
      // as well: a link inside the run directory would otherwise dereference an
      // outside file.
      const runRoot = path.resolve(runDir)
      const runRootReal = await fs.promises.realpath(runRoot).catch(() => runRoot)
      for (const artifact of run.artifacts ?? []) {
        const candidate = artifact as { kind?: string; path?: string }
        if (candidate.kind !== "screenshot" || !candidate.path) continue
        const resolved = path.resolve(candidate.path)
        const real = await fs.promises.realpath(resolved).catch(() => undefined)
        if (!Filesystem.contains(runRoot, resolved) || !real || !Filesystem.contains(runRootReal, real)) {
          log.warn("ignoring visual artifact outside its run directory", { runID: params.runID, path: candidate.path })
          continue
        }
        screenshotArtifacts.push(artifact)
      }
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
