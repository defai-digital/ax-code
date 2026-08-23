/**
 * Renders a ComputerObservation as tool output text plus an optional
 * screenshot attachment (base64 data: URL, same convention as visual_snapshot).
 */
import type { AppInfo, ComputerObservation, WindowInfo } from "@ax-code/computer"
import type { Computer } from "@/computer/computer"
import { Config } from "@/config/config"
import { maybeResizeImage } from "@/session/image-resize"

/** Caps the accessibility-tree text included in tool output. */
const A11Y_TEXT_CAP = 20_000

/** Caps each side of the app/window discovery listing. */
const TARGET_LIST_CAP = 50

/**
 * Renders the provider's app/window inventory so the model can discover valid
 * values for the app and windowId scopes before targeting an observation.
 */
export function renderTargets(targets: { apps: AppInfo[]; windows: WindowInfo[] }): string {
  const lines: string[] = []
  lines.push("Available apps (pass as the app scope):")
  if (targets.apps.length === 0) lines.push("(none reported)")
  for (const app of targets.apps.slice(0, TARGET_LIST_CAP)) lines.push(`- ${app.name}`)
  if (targets.apps.length > TARGET_LIST_CAP) lines.push(`(truncated at ${TARGET_LIST_CAP} apps)`)
  lines.push("", "Available windows (pass as the windowId scope):")
  if (targets.windows.length === 0) lines.push("(none reported)")
  for (const win of targets.windows.slice(0, TARGET_LIST_CAP)) {
    lines.push(`- [${win.id}] ${win.title}${win.app ? ` (${win.app.name})` : ""}`)
  }
  if (targets.windows.length > TARGET_LIST_CAP) lines.push(`(truncated at ${TARGET_LIST_CAP} windows)`)
  return lines.join("\n")
}

/** How many trajectory steps to show inline in tool output. */
const TRAJECTORY_DISPLAY_CAP = 10

/**
 * Renders recent computer-use history as a compact numbered narrative, so the
 * model can reflect on what it already did (and what failed) before choosing
 * the next action. Oldest first; capped at the most recent steps.
 */
export function renderTrajectory(entries: Computer.TrajectoryEntry[]): string {
  if (entries.length === 0) return "(no prior computer-use steps)"
  const shown = entries.slice(-TRAJECTORY_DISPLAY_CAP)
  const skipped = entries.length - shown.length
  const lines: string[] = []
  if (skipped > 0) lines.push(`(${skipped} earlier ${skipped === 1 ? "step" : "steps"} omitted)`)
  shown.forEach((entry, index) => {
    // outcome markers apply to acts only; observes and plans have no outcome
    const outcome =
      entry.kind !== "act" ? "" : entry.ok === false ? ` → REFUSED${entry.detail ? ` (${entry.detail})` : ""}` : " → ok"
    lines.push(`${index + 1 + skipped}. ${entry.summary}${outcome}`)
  })
  return lines.join("\n")
}

export async function renderObservation(
  observation: ComputerObservation,
  options: { includeScreenshot: boolean; screenshotName: string },
): Promise<{
  output: string
  attachments?: { type: "file"; filename: string; mime: string; url: string }[]
}> {
  const lines: string[] = []
  lines.push(`Provider: ${observation.provider} (${observation.platform})`)
  if (observation.app) lines.push(`App: ${observation.app.name}`)
  if (observation.window) lines.push(`Window: ${observation.window.title} [${observation.window.id}]`)
  lines.push("")
  lines.push("Elements (ids are valid only against this observation):")
  if (observation.elements.length === 0) {
    lines.push("(no targetable elements)")
  }
  for (const element of observation.elements) {
    const parts = [`- [${element.id}]`]
    if (element.role) parts.push(element.role)
    if (element.name) parts.push(`"${element.name}"`)
    if (element.bounds) {
      parts.push(`at (${element.bounds.x},${element.bounds.y} ${element.bounds.width}x${element.bounds.height})`)
    }
    lines.push(parts.join(" "))
  }
  if (observation.a11yText) {
    lines.push("", "Accessibility tree:")
    if (observation.a11yText.length > A11Y_TEXT_CAP) {
      lines.push(observation.a11yText.slice(0, A11Y_TEXT_CAP))
      lines.push(`(accessibility tree truncated at ${A11Y_TEXT_CAP} characters)`)
    } else {
      lines.push(observation.a11yText)
    }
  }

  let attachments: { type: "file"; filename: string; mime: string; url: string }[] | undefined
  const screenshot = observation.screenshot
  if (screenshot && options.includeScreenshot) {
    let mime = screenshot.mimeType || "image/png"
    let data = screenshot.data
    const resized = await maybeResizeImage({
      buffer: Buffer.from(data, "base64"),
      mime,
      config: (await Config.get()).attachment?.image,
    })
    if (resized.resized) {
      mime = resized.mime
      data = resized.data
    } else if ("error" in resized && resized.error === "too_large") {
      lines.push("", "Screenshot omitted because it exceeds the configured image-size limit.")
      return { output: lines.join("\n") }
    }
    const ext = mime === "image/jpeg" ? "jpg" : "png"
    attachments = [
      {
        type: "file",
        filename: `${options.screenshotName}.${ext}`,
        mime,
        url: `data:${mime};base64,${data}`,
      },
    ]
  }

  return { output: lines.join("\n"), attachments }
}
