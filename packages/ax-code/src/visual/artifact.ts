/**
 * Visual artifact storage and management (ADR-047).
 *
 * All visual artifacts are written to a dedicated, user-reviewable
 * directory under `.ax-code/visual-runs/<run-id>/`. This folder is
 * the single source of truth for visual evidence; users can inspect,
 * delete, or export its contents at any time.
 *
 * PII detection or redaction is not required by default because
 * AX Code is a coding tool and screenshots contain developer-controlled
 * content (local web apps, desktop UI, code).
 */
import path from "path"
import fs from "fs"
import crypto from "crypto"
import { Log } from "@/util/log"
import type { VisualArtifact, VisualRun } from "./run"

const log = Log.create({ service: "visual.artifact" })

/**
 * Maximum number of visual runs to retain per project.
 * Older runs beyond this limit are pruned automatically.
 */
const DEFAULT_RETENTION_RUNS = 50

/**
 * Maximum number of days to retain visual runs.
 */
const DEFAULT_RETENTION_DAYS = 30

/**
 * Maximum screenshot dimensions. Images exceeding this are downscaled.
 */
const MAX_SCREENSHOT_WIDTH = 2560
const MAX_SCREENSHOT_HEIGHT = 2560
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function assertSafeRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`Invalid visual run id: ${runId}`)
  }
}

export namespace VisualArtifactStore {
  /**
   * Returns the base directory for visual runs in a project.
   */
  export function baseDir(projectDir: string): string {
    return path.join(projectDir, ".ax-code", "visual-runs")
  }

  /**
   * Returns the directory for a specific visual run.
   */
  export function runDir(projectDir: string, runId: string): string {
    assertSafeRunId(runId)
    return path.join(baseDir(projectDir), runId)
  }

  /**
   * Ensure the run directory exists and return its path.
   */
  export async function ensureRunDir(projectDir: string, runId: string): Promise<string> {
    const dir = runDir(projectDir, runId)
    await fs.promises.mkdir(dir, { recursive: true })
    return dir
  }

  /**
   * Write a screenshot artifact to the run directory.
   */
  export async function writeScreenshot(
    projectDir: string,
    runId: string,
    data: Buffer,
    label: string,
    options?: { format?: "png" | "jpeg"; width?: number; height?: number },
  ): Promise<VisualArtifact> {
    const dir = await ensureRunDir(projectDir, runId)
    const id = crypto.randomUUID()
    const ext = options?.format === "jpeg" ? "jpg" : "png"
    const filename = `${id}.${ext}`
    const filePath = path.join(dir, filename)

    await fs.promises.writeFile(filePath, data)

    const sha256 = crypto.createHash("sha256").update(data).digest("hex")

    log.info("screenshot written", {
      runId,
      label,
      filename,
      size: data.length,
      sha256: sha256.slice(0, 12),
    })

    return {
      id,
      kind: "screenshot",
      path: filePath,
      mime: options?.format === "jpeg" ? "image/jpeg" : "image/png",
      width: options?.width,
      height: options?.height,
      sha256,
      label,
    }
  }

  /**
   * Write a text-based artifact (DOM snapshot, console log, network log, etc.).
   */
  export async function writeText(
    projectDir: string,
    runId: string,
    kind: VisualArtifact["kind"],
    content: string,
    label: string,
  ): Promise<VisualArtifact> {
    const dir = await ensureRunDir(projectDir, runId)
    const id = crypto.randomUUID()
    const ext = kind === "dom" ? "html" : kind === "accessibility" ? "txt" : "json"
    const filename = `${id}.${ext}`
    const filePath = path.join(dir, filename)

    await fs.promises.writeFile(filePath, content, "utf-8")

    const sha256 = crypto.createHash("sha256").update(content).digest("hex")

    return {
      id,
      kind,
      path: filePath,
      mime: "text/plain",
      sha256,
      label,
    }
  }

  /**
   * Write the visual run summary JSON.
   */
  export async function writeRunSummary(projectDir: string, run: VisualRun): Promise<void> {
    const dir = await ensureRunDir(projectDir, run.id)
    const filePath = path.join(dir, "visual-run.json")
    await fs.promises.writeFile(filePath, JSON.stringify(run, null, 2), "utf-8")
  }

  /**
   * Prune old visual runs beyond retention limits.
   */
  export async function prune(projectDir: string, options?: { maxRuns?: number; maxDays?: number }): Promise<number> {
    const maxRuns = options?.maxRuns ?? DEFAULT_RETENTION_RUNS
    const maxDays = options?.maxDays ?? DEFAULT_RETENTION_DAYS
    const base = baseDir(projectDir)

    try {
      const entries = await fs.promises.readdir(base, { withFileTypes: true })
      const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)

      if (dirs.length <= maxRuns) return 0

      const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000
      let pruned = 0

      // Sort by modification time, oldest first
      const sorted = await Promise.all(
        dirs.map(async (name) => {
          const dirPath = path.join(base, name)
          const stat = await fs.promises.stat(dirPath)
          return { name, dirPath, mtime: stat.mtimeMs }
        }),
      )
      sorted.sort((a, b) => a.mtime - b.mtime)

      for (const entry of sorted) {
        if (pruned >= dirs.length - maxRuns) break
        if (entry.mtime < cutoff || dirs.length - pruned > maxRuns) {
          await fs.promises.rm(entry.dirPath, { recursive: true, force: true })
          pruned++
          log.info("pruned visual run", { name: entry.name })
        }
      }

      return pruned
    } catch {
      // Directory may not exist yet
      return 0
    }
  }
}

export { MAX_SCREENSHOT_WIDTH, MAX_SCREENSHOT_HEIGHT }
