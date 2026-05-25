/**
 * @ax-code/sdk/headless — App-oriented headless SDK for AX Code.
 *
 * Use this entry point to start or attach to a local AX Code backend,
 * subscribe to typed events, project state, and manage backend lifecycle.
 *
 * @example
 * ```ts
 * import {
 *   startHeadlessBackend,
 *   createHeadlessProjectionState,
 *   applyHeadlessProjectionEvent,
 * } from "@ax-code/sdk/headless"
 * import { createAxCodeClient } from "@ax-code/sdk/v2/client"
 *
 * const backend = await startHeadlessBackend({ directory: "/path/to/workspace" })
 * try {
 *   const client = createAxCodeClient({ baseUrl: backend.url, headers: backend.headers })
 *   const state = createHeadlessProjectionState()
 *   const session = await client.session.create({ title: "App session" })
 *   // subscribe to events and apply to state...
 * } finally {
 *   await backend.close()
 * }
 * ```
 */

export { startHeadlessBackend } from "./headless/lifecycle.js"
export type { HeadlessBackendOptions, HeadlessBackendHandle } from "./headless/lifecycle.js"

export {
  createHeadlessProjectionState,
  applyHeadlessProjectionEvent,
  runtimeProbeKeysForEvent,
} from "./headless/projection.js"
export type {
  HeadlessProjectionState,
  HeadlessProjectionEffect,
  HeadlessProjectionApplyResult,
} from "./headless/projection.js"

export { HEADLESS_RUNTIME_EVENT_TYPES, isHeadlessRuntimeEvent } from "./headless/event.js"
export type {
  HeadlessRuntimeEvent,
  HeadlessSessionEvent,
  HeadlessMessageEvent,
  HeadlessRequestEvent,
  HeadlessRuntimeStatusEvent,
  HeadlessControlEvent,
} from "./headless/event.js"

export type {
  HeadlessRuntimeCommand,
  HeadlessRuntimeCommandMode,
  HeadlessRuntimeCommandResult,
  HeadlessRuntimeModel,
  HeadlessRuntimePart,
  HeadlessPromptBody,
  HeadlessCommandBody,
  HeadlessShellBody,
  HeadlessPermissionReplyBody,
  HeadlessQuestionReplyBody,
} from "./headless/command.js"
export { commandAcceptsAsyncMode } from "./headless/command.js"
