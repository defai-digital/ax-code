import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { ElectronWindowOptions } from "./config"

export type WindowBounds = {
  x?: number
  y?: number
  width: number
  height: number
}

export type DesktopWindowState = {
  bounds?: WindowBounds
  maximized?: boolean
  updatedAt?: number
}

export type DesktopWindowStateStore = {
  read(): DesktopWindowState
  write(state: DesktopWindowState): void
}

export type RecoverableElectronWindowOptions = ElectronWindowOptions & {
  x?: number
  y?: number
}

export function createWindowStateStore(userDataPath: string, fileName = "window-state.json"): DesktopWindowStateStore {
  const filePath = path.join(userDataPath, fileName)
  return {
    read() {
      return readWindowStateFile(filePath)
    },
    write(state) {
      writeWindowStateFile(filePath, state)
    },
  }
}

export function writeWindowStateFile(filePath: string, state: DesktopWindowState) {
  const directory = path.dirname(filePath)
  mkdirSync(directory, { recursive: true })
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  try {
    writeFileSync(tempPath, JSON.stringify(sanitizeWindowState(state) ?? {}, null, 2), { flag: "wx" })
    renameSync(tempPath, filePath)
  } catch (error) {
    rmSync(tempPath, { force: true })
    throw error
  }
}

export function readWindowStateFile(filePath: string): DesktopWindowState {
  if (!existsSync(filePath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown
    return sanitizeWindowState(parsed) ?? {}
  } catch {
    return {}
  }
}

export function applyWindowState(
  options: ElectronWindowOptions,
  state: DesktopWindowState,
): RecoverableElectronWindowOptions {
  const sanitized = sanitizeWindowState(state, {
    minWidth: options.minWidth,
    minHeight: options.minHeight,
  })
  if (!sanitized?.bounds) return options
  return {
    ...options,
    x: sanitized.bounds.x,
    y: sanitized.bounds.y,
    width: sanitized.bounds.width,
    height: sanitized.bounds.height,
  }
}

export function attachWindowStatePersistence(
  win: {
    on(event: "resize" | "move" | "close", callback: () => void): unknown
    getBounds(): WindowBounds
    isMaximized?(): boolean
  },
  store: DesktopWindowStateStore,
  now: () => number = Date.now,
) {
  const save = () => {
    const state = captureWindowState(win, now)
    if (state.bounds) store.write(state)
  }
  win.on("resize", save)
  win.on("move", save)
  win.on("close", save)
}

export function captureWindowState(
  win: {
    getBounds(): WindowBounds
    isMaximized?(): boolean
  },
  now: () => number = Date.now,
): DesktopWindowState {
  return (
    sanitizeWindowState({
      bounds: win.getBounds(),
      maximized: Boolean(win.isMaximized?.()),
      updatedAt: now(),
    }) ?? {}
  )
}

export function sanitizeWindowState(
  value: unknown,
  minimums: { minWidth?: number; minHeight?: number } = {},
): DesktopWindowState | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const bounds = sanitizeBounds(record["bounds"], minimums)
  const updatedAt = finiteNumber(record["updatedAt"])
  return {
    ...(bounds ? { bounds } : {}),
    ...(typeof record["maximized"] === "boolean" ? { maximized: record["maximized"] } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  }
}

function sanitizeBounds(value: unknown, minimums: { minWidth?: number; minHeight?: number }): WindowBounds | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const width = finiteNumber(record["width"])
  const height = finiteNumber(record["height"])
  if (width === undefined || height === undefined) return undefined
  const minWidth = minimums.minWidth ?? 720
  const minHeight = minimums.minHeight ?? 480
  if (width < minWidth || height < minHeight) return undefined
  return {
    width: Math.round(width),
    height: Math.round(height),
    ...(finiteNumber(record["x"]) !== undefined ? { x: Math.round(finiteNumber(record["x"])!) } : {}),
    ...(finiteNumber(record["y"]) !== undefined ? { y: Math.round(finiteNumber(record["y"])!) } : {}),
  }
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
