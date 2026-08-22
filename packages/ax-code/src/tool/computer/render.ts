/**
 * Renders a ComputerObservation as tool output text plus an optional
 * screenshot attachment (base64 data: URL, same convention as visual_snapshot).
 */
import type { ComputerObservation } from "@ax-code/computer"

/** Caps the accessibility-tree text included in tool output. */
const A11Y_TEXT_CAP = 20_000

export function renderObservation(
  observation: ComputerObservation,
  options: { includeScreenshot: boolean; screenshotName: string },
): {
  output: string
  attachments?: { type: "file"; filename: string; mime: string; url: string }[]
} {
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
    const mime = screenshot.mimeType || "image/png"
    const ext = mime === "image/jpeg" ? "jpg" : "png"
    attachments = [
      {
        type: "file",
        filename: `${options.screenshotName}.${ext}`,
        mime,
        url: `data:${mime};base64,${screenshot.data}`,
      },
    ]
  }

  return { output: lines.join("\n"), attachments }
}
