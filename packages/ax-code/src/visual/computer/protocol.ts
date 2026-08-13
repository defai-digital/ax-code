/**
 * AX Work computer-use protocol (ADR-052).
 *
 * Shared types for observations, actions, and typed errors. The live OS
 * backend is injected via `ComputerHost`; Phase 1 ships a fail-closed
 * unset host plus a test fake.
 */

export const COMPUTER_IMAGE_MAX_LONG_EDGE = 1280
export const COMPUTER_IMAGE_MAX_BYTES = 900_000
export const COMPUTER_ACTION_LIMIT = 50

export type ComputerRect = {
  x: number
  y: number
  width: number
  height: number
}

export type ComputerApp = {
  appID: string
  displayName: string
  pid: number
}

export type ComputerWindow = {
  windowID: string
  title?: string
  bounds: ComputerRect
  scaleFactor: number
}

export type ComputerElement = {
  elementID: string
  role: string
  name?: string
  value?: string
  state?: string[]
  bounds?: ComputerRect
}

export type ComputerFrame = {
  frameID: string
  app: ComputerApp
  window: ComputerWindow
  image: {
    width: number
    height: number
    mime: "image/png" | "image/jpeg"
  }
  elements: ComputerElement[]
  capturedAt: number
}

export type ComputerSnapshotTarget = { type: "frontmost" } | { type: "app"; query: string }

export type ComputerActionName =
  | "launch"
  | "focus"
  | "click"
  | "double_click"
  | "type"
  | "key"
  | "scroll"
  | "drag"
  | "wait"

export type ComputerCommitClass =
  | "message.send"
  | "form.submit"
  | "calendar.create"
  | "purchase"
  | "publish"
  | "delete"
  | "account.change"
  | "permission.change"

export type ComputerActionRequest = {
  frameID: string
  action: ComputerActionName
  elementID?: string
  x?: number
  y?: number
  text?: string
  key?: string
  expectedOutcome?: string
  commitClass?: ComputerCommitClass
  routeReason?: "connector_unavailable" | "connector_failed" | "native_only" | "visual_verification"
}

export const COMPUTER_ERROR_CODES = [
  "COMPUTER_HOST_UNAVAILABLE",
  "COMPUTER_OS_PERMISSION_REQUIRED",
  "COMPUTER_PERMISSION_DENIED",
  "COMPUTER_BUSY",
  "COMPUTER_STALE_FRAME",
  "COMPUTER_APP_CHANGED",
  "COMPUTER_SECURE_SURFACE",
  "COMPUTER_PAUSED",
  "COMPUTER_ACTION_LIMIT",
  "COMPUTER_UNSUPPORTED",
  "COMPUTER_MODEL_INELIGIBLE",
] as const

export type ComputerErrorCode = (typeof COMPUTER_ERROR_CODES)[number]

export class ComputerError extends Error {
  override readonly name = "ComputerError"
  readonly code: ComputerErrorCode

  constructor(code: ComputerErrorCode, message?: string, options?: ErrorOptions) {
    super(message ?? code, options)
    this.code = code
  }
}

export type ComputerHost = {
  snapshot(input: { target: ComputerSnapshotTarget; sessionID: string }): Promise<ComputerFrame>
  act(input: { request: ComputerActionRequest; sessionID: string }): Promise<ComputerFrame>
}

let host: ComputerHost | undefined

export function setComputerHost(next: ComputerHost | undefined) {
  host = next
}

export function getComputerHost(): ComputerHost | undefined {
  return host
}

export function requireComputerHost(): ComputerHost {
  if (!host) throw new ComputerError("COMPUTER_HOST_UNAVAILABLE", "No computer-use host is bound for this process")
  return host
}
