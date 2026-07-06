/**
 * Viewport matrix runner (ADR-047).
 *
 * Runs browser captures across multiple viewport presets
 * (desktop, tablet, mobile) for responsive visual review.
 * Each viewport produces a separate set of artifacts and findings.
 */
import { Log } from "@/util/log"
import { DEFAULT_VIEWPORTS, type ViewportPreset, type VisualArtifact } from "./run"
import { VisualArtifactStore } from "./artifact"
import { BrowserRuntime, type BrowserSnapshot } from "@/tool/browser/runtime"

const log = Log.create({ service: "visual.viewport" })

export type ViewportCaptureResult = {
  viewport: ViewportPreset
  screenshot?: VisualArtifact
  snapshot?: BrowserSnapshot
  error?: string
}

export type ViewportMatrixResult = {
  url: string
  runID: string
  captures: ViewportCaptureResult[]
  totalViewports: number
  successCount: number
  failureCount: number
}

/**
 * Parse a viewport label into a ViewportPreset.
 * Accepts named presets ("desktop", "tablet", "mobile") or
 * explicit dimensions ("1440x900").
 */
export function parseViewport(input: string): ViewportPreset | undefined {
  const named = DEFAULT_VIEWPORTS.find((v) => v.label === input.toLowerCase())
  if (named) return named

  const match = input.match(/^(\d+)x(\d+)$/)
  if (match) {
    const width = parseInt(match[1]!, 10)
    const height = parseInt(match[2]!, 10)
    if (width >= 320 && width <= 3840 && height >= 240 && height <= 2160) {
      return { label: `${width}x${height}`, width, height }
    }
  }

  return undefined
}

/**
 * Resolve a list of viewport inputs into presets.
 * Accepts: "all" (default viewports), comma-separated labels/dimensions,
 * or an explicit array.
 */
export function resolveViewports(input?: string | string[]): ViewportPreset[] {
  if (!input) return [...DEFAULT_VIEWPORTS]
  if (Array.isArray(input)) {
    return input.map((s) => parseViewport(s)).filter((v): v is ViewportPreset => v !== undefined)
  }
  if (input.toLowerCase() === "all") return [...DEFAULT_VIEWPORTS]
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => parseViewport(s))
    .filter((v): v is ViewportPreset => v !== undefined)
}

/**
 * Capture screenshots across a viewport matrix.
 * Opens the URL at each viewport size, captures a screenshot,
 * and stores artifacts in the run directory.
 */
export async function captureViewportMatrix(
  projectDir: string,
  runID: string,
  url: string,
  viewports: ViewportPreset[],
): Promise<ViewportMatrixResult> {
  const runtime = BrowserRuntime.get()
  const captures: ViewportCaptureResult[] = []

  for (const viewport of viewports) {
    let pageID: string | undefined
    try {
      log.info("capturing viewport", { url, viewport: viewport.label, width: viewport.width, height: viewport.height })

      const page = await runtime.open(url, { width: viewport.width, height: viewport.height })
      pageID = page.pageID
      const screenshot = await runtime.screenshot(page.pageID, { format: "png" })

      const artifact = await VisualArtifactStore.writeScreenshot(
        projectDir,
        runID,
        screenshot.data,
        `viewport-${viewport.label}`,
        { format: "png", width: viewport.width, height: viewport.height },
      )

      captures.push({ viewport, screenshot: artifact })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn("viewport capture failed", { viewport: viewport.label, error: message })
      captures.push({ viewport, error: message })
    } finally {
      if (pageID) {
        await runtime.closePage(pageID).catch(() => {})
      }
    }
  }

  const successCount = captures.filter((c) => !c.error).length
  return {
    url,
    runID,
    captures,
    totalViewports: viewports.length,
    successCount,
    failureCount: viewports.length - successCount,
  }
}

/**
 * Format a viewport matrix result as a text summary.
 */
export function formatViewportMatrix(result: ViewportMatrixResult): string {
  const lines: string[] = []
  lines.push(`Viewport Matrix: ${result.url}`)
  lines.push(`  Captured: ${result.successCount}/${result.totalViewports}`)
  if (result.failureCount > 0) {
    lines.push(`  Failed: ${result.failureCount}`)
  }
  for (const c of result.captures) {
    if (c.error) {
      lines.push(`  [FAIL] ${c.viewport.label} (${c.viewport.width}x${c.viewport.height}): ${c.error}`)
    } else {
      lines.push(`  [OK]   ${c.viewport.label} (${c.viewport.width}x${c.viewport.height})`)
    }
  }
  return lines.join("\n")
}
