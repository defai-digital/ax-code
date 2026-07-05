import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./visual-compare.txt"
import { VisualArtifactStore } from "@/visual/artifact"
import { compareVisualRuns, formatCompareSummary } from "@/visual/compare"
import type { VisualRun } from "@/visual/run"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import fs from "fs"

const log = Log.create({ service: "tool.visual_compare" })

/**
 * Load a visual run summary from the artifact store.
 */
async function loadRun(projectDir: string, runID: string): Promise<VisualRun> {
  const runDir = VisualArtifactStore.runDir(projectDir, runID)
  const summaryPath = `${runDir}/visual-run.json`
  try {
    const content = await fs.promises.readFile(summaryPath, "utf-8")
    return JSON.parse(content) as VisualRun
  } catch {
    throw new Error(
      `Visual run "${runID}" not found. Ensure the run was completed and artifacts are stored at ${summaryPath}.`,
    )
  }
}

export const VisualCompareTool = Tool.define("visual_compare", {
  description: DESCRIPTION,
  parameters: z.object({
    beforeRunID: z.string().describe("The baseline visual run ID (before the fix)"),
    afterRunID: z.string().describe("The verification visual run ID (after the fix)"),
  }),
  async execute(params) {
    const projectDir = Instance.directory

    log.info("compare request", { beforeRunID: params.beforeRunID, afterRunID: params.afterRunID })

    const [beforeRun, afterRun] = await Promise.all([
      loadRun(projectDir, params.beforeRunID),
      loadRun(projectDir, params.afterRunID),
    ])

    const result = compareVisualRuns(beforeRun, afterRun)
    const text = formatCompareSummary(result)

    log.info("compare completed", {
      beforeRunID: params.beforeRunID,
      afterRunID: params.afterRunID,
      resolved: result.resolvedCount,
      unresolved: result.unresolvedCount,
      introduced: result.introducedCount,
    })

    return {
      title: `Compare: ${params.beforeRunID} → ${params.afterRunID}`,
      output: text,
      metadata: {
        beforeRunID: params.beforeRunID,
        afterRunID: params.afterRunID,
        resolvedCount: result.resolvedCount,
        unresolvedCount: result.unresolvedCount,
        introducedCount: result.introducedCount,
        viewportMatches: result.matches.length,
      },
    }
  },
})
