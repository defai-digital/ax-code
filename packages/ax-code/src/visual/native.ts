/**
 * Native screenshot capture for visual review.
 *
 * This adapter turns native desktop/terminal targets into the same screenshot
 * artifact shape used by browser snapshots. macOS has the most complete
 * implementation because it exposes scriptable window bounds plus
 * `screencapture`. Windows and Linux support screen/region best-effort paths.
 */
import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"
import { Process } from "@/util/process"
import type { VisualTarget } from "./run"

export type NativeSnapshotSource =
  | { type: "screen"; display?: number }
  | { type: "frontmost-window" }
  | { type: "window"; appName?: string; windowTitle?: string; windowID?: number }
  | { type: "region"; x: number; y: number; width: number; height: number }
  | { type: "terminal"; appName?: string; windowTitle?: string }

export type NativeSnapshotResult = {
  data: Buffer
  format: "png"
  label: string
  target: VisualTarget
  width?: number
  height?: number
}

type WindowBounds = {
  appName: string
  windowTitle?: string
  x: number
  y: number
  width: number
  height: number
}

const TERMINAL_APP_NAMES = new Set([
  "Terminal",
  "iTerm2",
  "WezTerm",
  "Alacritty",
  "Ghostty",
  "kitty",
  "Kitty",
  "Warp",
  "Hyper",
  "Tabby",
])

function tmpPngPath() {
  return path.join(os.tmpdir(), `ax-code-native-snapshot-${process.pid}-${crypto.randomUUID()}.png`)
}

function assertRegion(input: { x: number; y: number; width: number; height: number }) {
  for (const [key, value] of Object.entries(input)) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid native screenshot ${key}: ${value}`)
  }
  if (input.width < 1 || input.height < 1) throw new Error("Native screenshot region must be at least 1x1")
}

function regionArg(input: { x: number; y: number; width: number; height: number }) {
  assertRegion(input)
  return `${input.x},${input.y},${input.width},${input.height}`
}

function parseBounds(output: string): WindowBounds {
  const [appName, windowTitle, x, y, width, height] = output.trim().split("\n")
  const bounds = {
    appName: appName ?? "",
    windowTitle: windowTitle || undefined,
    x: Number(x),
    y: Number(y),
    width: Number(width),
    height: Number(height),
  }
  assertRegion({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
  if (!bounds.appName) throw new Error("Could not resolve native window application name")
  return bounds
}

function appleScriptString(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

async function macWindowBounds(
  source: Extract<NativeSnapshotSource, { type: "frontmost-window" | "window" | "terminal" }>,
) {
  const lines: string[] = ['tell application "System Events"']
  if (source.type === "frontmost-window" || (!source.appName && source.type === "terminal")) {
    lines.push("set targetProcess to first application process whose frontmost is true")
  } else {
    lines.push(`set targetProcess to first application process whose name is ${appleScriptString(source.appName!)}`)
  }
  if (source.type === "window" || source.type === "terminal") {
    if (source.windowTitle) {
      lines.push(
        `set targetWindow to first window of targetProcess whose name contains ${appleScriptString(source.windowTitle)}`,
      )
    } else {
      lines.push("set targetWindow to front window of targetProcess")
    }
  } else {
    lines.push("set targetWindow to front window of targetProcess")
  }
  lines.push("set p to position of targetWindow")
  lines.push("set s to size of targetWindow")
  lines.push("set appName to name of targetProcess")
  lines.push("set windowName to name of targetWindow")
  lines.push(
    "return appName & linefeed & windowName & linefeed & (item 1 of p) & linefeed & (item 2 of p) & linefeed & (item 1 of s) & linefeed & (item 2 of s)",
  )
  lines.push("end tell")

  const result = await Process.text(["osascript", ...lines.flatMap((line) => ["-e", line])], { timeout: 10_000 })
  const bounds = parseBounds(result.text)
  if (source.type === "terminal" && !source.appName && !TERMINAL_APP_NAMES.has(bounds.appName)) {
    throw new Error(
      `Frontmost application "${bounds.appName}" is not a recognized terminal. Pass appName/windowTitle or use source:"frontmost-window".`,
    )
  }
  return bounds
}

async function runCapture(cmd: string[], outputPath: string) {
  await Process.run(cmd, { timeout: 20_000 })
  return fs.promises.readFile(outputPath)
}

async function captureMac(source: NativeSnapshotSource, outputPath: string): Promise<NativeSnapshotResult> {
  if (source.type === "screen") {
    const displayArgs = source.display === undefined ? [] : ["-D", String(source.display)]
    const data = await runCapture(["screencapture", "-x", ...displayArgs, outputPath], outputPath)
    return {
      data,
      format: "png",
      label: source.display === undefined ? "Native screen" : `Native screen ${source.display}`,
      target: { type: "screen", display: source.display },
    }
  }

  if (source.type === "region") {
    const data = await runCapture(["screencapture", "-x", "-R", regionArg(source), outputPath], outputPath)
    return {
      data,
      format: "png",
      label: `Native region ${source.x},${source.y} ${source.width}x${source.height}`,
      target: { type: "screen", region: source },
      width: source.width,
      height: source.height,
    }
  }

  if (source.type === "window" && source.windowID !== undefined) {
    const data = await runCapture(["screencapture", "-x", "-l", String(source.windowID), outputPath], outputPath)
    return {
      data,
      format: "png",
      label: `Native window ${source.windowID}`,
      target: {
        type: "desktop-window",
        appID: source.appName ?? String(source.windowID),
        windowTitle: source.windowTitle,
      },
    }
  }

  const bounds = await macWindowBounds(source)
  const data = await runCapture(
    [
      "screencapture",
      "-x",
      "-R",
      regionArg({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }),
      outputPath,
    ],
    outputPath,
  )
  const label =
    source.type === "terminal"
      ? `Terminal window: ${bounds.appName}${bounds.windowTitle ? ` - ${bounds.windowTitle}` : ""}`
      : `Native window: ${bounds.appName}${bounds.windowTitle ? ` - ${bounds.windowTitle}` : ""}`

  return {
    data,
    format: "png",
    label,
    target:
      source.type === "terminal"
        ? { type: "terminal", appName: bounds.appName, windowTitle: bounds.windowTitle }
        : { type: "desktop-window", appID: bounds.appName, windowTitle: bounds.windowTitle },
    width: bounds.width,
    height: bounds.height,
  }
}

async function captureWindows(source: NativeSnapshotSource, outputPath: string): Promise<NativeSnapshotResult> {
  if (source.type !== "screen" && source.type !== "region") {
    throw new Error(
      'Native window/terminal capture is currently implemented on macOS. Use source:"screen" or source:"region" on Windows.',
    )
  }
  const region =
    source.type === "region"
      ? source
      : {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        }
  if (source.type === "region") assertRegion(region)
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    source.type === "region"
      ? `$bounds = New-Object System.Drawing.Rectangle(${region.x}, ${region.y}, ${region.width}, ${region.height})`
      : "$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
    "$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)",
    "$graphics = [System.Drawing.Graphics]::FromImage($bmp)",
    "$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)",
    `$bmp.Save(${JSON.stringify(outputPath)}, [System.Drawing.Imaging.ImageFormat]::Png)`,
    "$graphics.Dispose()",
    "$bmp.Dispose()",
  ].join("; ")
  const data = await runCapture(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], outputPath)
  return {
    data,
    format: "png",
    label:
      source.type === "region"
        ? `Native region ${region.x},${region.y} ${region.width}x${region.height}`
        : "Native screen",
    target: source.type === "region" ? { type: "screen", region } : { type: "screen" },
    width: source.type === "region" ? region.width : undefined,
    height: source.type === "region" ? region.height : undefined,
  }
}

async function captureLinux(source: NativeSnapshotSource, outputPath: string): Promise<NativeSnapshotResult> {
  if (source.type !== "screen" && source.type !== "region") {
    throw new Error("Native window/terminal capture is currently best-effort screen/region only on Linux.")
  }
  if (source.type === "region") assertRegion(source)
  const commands =
    source.type === "screen"
      ? [
          ["gnome-screenshot", "-f", outputPath],
          ["spectacle", "-b", "-o", outputPath],
          ["grim", outputPath],
        ]
      : [
          ["grim", "-g", `${source.x},${source.y} ${source.width}x${source.height}`, outputPath],
          [
            "import",
            "-window",
            "root",
            "-crop",
            `${source.width}x${source.height}+${source.x}+${source.y}`,
            outputPath,
          ],
        ]

  let lastError = ""
  for (const cmd of commands) {
    const result = await Process.run(cmd, { timeout: 20_000, nothrow: true })
    if (result.code === 0 && fs.existsSync(outputPath)) {
      const data = await fs.promises.readFile(outputPath)
      return {
        data,
        format: "png",
        label:
          source.type === "region"
            ? `Native region ${source.x},${source.y} ${source.width}x${source.height}`
            : "Native screen",
        target: source.type === "region" ? { type: "screen", region: source } : { type: "screen" },
        width: source.type === "region" ? source.width : undefined,
        height: source.type === "region" ? source.height : undefined,
      }
    }
    lastError = result.stderr.toString().trim() || result.stdout.toString().trim() || `${cmd[0]} exited ${result.code}`
  }
  throw new Error(`No Linux screenshot command succeeded. Last error: ${lastError}`)
}

export async function captureNativeSnapshot(source: NativeSnapshotSource): Promise<NativeSnapshotResult> {
  const outputPath = tmpPngPath()
  try {
    if (process.platform === "darwin") return await captureMac(source, outputPath)
    if (process.platform === "win32") return await captureWindows(source, outputPath)
    if (process.platform === "linux") return await captureLinux(source, outputPath)
    throw new Error(`Native screenshot capture is not supported on ${process.platform}`)
  } finally {
    await fs.promises.rm(outputPath, { force: true }).catch(() => {})
  }
}
