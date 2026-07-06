/**
 * App Snapshot module (ADR-047, Phase 4).
 *
 * Supports native visual review without OS control. A snapshot captures
 * the current visual state of a web app (via Playwright) or accepts an
 * uploaded image, stores it as a visual run artifact, and makes it
 * available for agent critique.
 *
 * Retention follows the same policy as browser visual runs: artifacts
 * live under `.ax-code/visual-runs/<run-id>/` and are pruned by
 * `VisualArtifactStore.prune()`.
 */

import path from "path"
import fs from "fs"
import crypto from "crypto"
import { Log } from "@/util/log"
import { VisualArtifactStore } from "./artifact"
import type { VisualRun, VisualTarget, VisualArtifact } from "./run"
import { captureNativeSnapshot, type NativeSnapshotSource } from "./native"

const log = Log.create({ service: "visual.snapshot" })

export type SnapshotSource =
  | {
      type: "url"
      url: string
    }
  | {
      type: "file"
      filePath: string
    }
  | NativeSnapshotSource

export type SnapshotResult = {
  run: VisualRun
  screenshot: VisualArtifact
  screenshotData: Buffer
}

/**
 * Create a snapshot visual run: capture a screenshot from a URL (using
 * the Playwright browser runtime) or read an existing image file, then
 * store it as a visual run artifact.
 */
export async function captureSnapshot(
  projectDir: string,
  sessionID: string,
  source: SnapshotSource,
): Promise<SnapshotResult> {
  const runID = `snap_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`
  const now = new Date().toISOString()

  let target: VisualTarget = { type: "snapshot", source: source.type === "url" ? "browser" : "upload" }

  let screenshotData: Buffer
  let format: "png" | "jpeg" = "png"
  let width: number | undefined
  let height: number | undefined
  let label: string

  if (source.type === "file") {
    // Read an existing image file
    const absPath = path.resolve(source.filePath)
    screenshotData = await fs.promises.readFile(absPath)
    const ext = path.extname(absPath).toLowerCase()
    format = ext === ".jpg" || ext === ".jpeg" ? "jpeg" : "png"
    label = `Snapshot: ${path.basename(source.filePath)}`
  } else {
    if (source.type !== "url") {
      const native = await captureNativeSnapshot(source)
      screenshotData = native.data
      format = native.format
      width = native.width
      height = native.height
      target = native.target
      label = native.label
    } else {
      // Capture from URL using Playwright browser runtime
      const { BrowserRuntime } = await import("@/tool/browser/runtime")
      const runtime = BrowserRuntime.get()

      // Open the URL in a new page with default desktop viewport
      const page = await runtime.open(source.url, { width: 1440, height: 900 })

      // Take a screenshot
      const screenshot = await runtime.screenshot(page.pageID, {
        fullPage: false,
        format: "png",
      })

      screenshotData = screenshot.data
      format = screenshot.format === "jpeg" ? "jpeg" : "png"
      width = screenshot.width
      height = screenshot.height
      label = `Snapshot: ${source.url}`
    }
  }

  // Write the screenshot artifact
  const screenshotArtifact = await VisualArtifactStore.writeScreenshot(projectDir, runID, screenshotData, label, {
    format,
    width,
    height,
  })

  const run: VisualRun = {
    id: runID,
    sessionID,
    projectID: projectDir,
    target,
    mode: source.type === "url" || source.type === "file" ? "snapshot" : "computer",
    status: "running",
    createdAt: now,
    updatedAt: now,
    artifacts: [screenshotArtifact],
    findings: [],
  }

  // Write the run summary
  await VisualArtifactStore.writeRunSummary(projectDir, run)

  log.info("snapshot captured", {
    runID,
    source: source.type,
    format,
    size: screenshotData.length,
  })

  return { run, screenshot: screenshotArtifact, screenshotData }
}

/**
 * Retention: prune old snapshot runs. Delegates to the shared artifact
 * store pruner which enforces maxRuns and maxDays limits.
 */
export async function pruneSnapshots(
  projectDir: string,
  options?: { maxRuns?: number; maxDays?: number },
): Promise<number> {
  return VisualArtifactStore.prune(projectDir, options)
}
