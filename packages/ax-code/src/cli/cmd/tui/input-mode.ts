import { createEffect, on } from "solid-js"
import { win32DisableProcessedInput } from "./win32"

type RawModeInput = {
  isTTY?: boolean
  setRawMode?: ((mode: boolean) => unknown) | undefined
}

type ResizeOutput = {
  isTTY?: boolean
  on?: (event: "resize", listener: () => void) => unknown
  off?: (event: "resize", listener: () => void) => unknown
}

type ResizeProcess = {
  platform: string
  on: (event: "SIGWINCH", listener: () => void) => unknown
  off: (event: "SIGWINCH", listener: () => void) => unknown
}

type Dimensions = {
  width: number
  height: number
}

export function restoreTuiInputMode(
  input: RawModeInput = process.stdin,
  platform: string = process.platform,
  restoreWin32ConsoleInput: () => void = win32DisableProcessedInput,
) {
  if (input.isTTY && typeof input.setRawMode === "function") {
    try {
      input.setRawMode(true)
    } catch {
      // Ignore transient raw-mode failures during resize; the next resize
      // or renderer tick will retry and we do not want to crash the TUI.
    }
  }

  if (platform === "win32") restoreWin32ConsoleInput()
}

export function resizeSignature(input: Dimensions) {
  return `${input.width}x${input.height}`
}

export function useResizeInputRecovery(
  dimensions: () => Dimensions,
  restore: () => void = () => {
    restoreTuiInputMode()
  },
) {
  createEffect(
    on(
      () => resizeSignature(dimensions()),
      () => {
        restore()
      },
    ),
  )
}

export function installResizeInputGuard(
  input: {
    stdin?: RawModeInput
    stdout?: ResizeOutput
    process?: ResizeProcess
    restore?: () => void
    schedule?: (listener: () => void) => void
  } = {},
) {
  const stdin = input.stdin ?? process.stdin
  const stdout = input.stdout ?? process.stdout
  const proc = input.process ?? process

  if (!stdin.isTTY) return () => {}

  const restore =
    input.restore ??
    (() => {
      restoreTuiInputMode(stdin, proc.platform)
    })
  const schedule = input.schedule ?? ((listener: () => void) => void setImmediate(listener))

  const handleResize = () => {
    restore()
    schedule(restore)
  }

  if (proc.platform !== "win32") proc.on("SIGWINCH", handleResize)
  if (stdout.isTTY) stdout.on?.("resize", handleResize)

  return () => {
    if (proc.platform !== "win32") proc.off("SIGWINCH", handleResize)
    if (stdout.isTTY) stdout.off?.("resize", handleResize)
  }
}
