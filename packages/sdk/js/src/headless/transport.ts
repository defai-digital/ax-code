import type { Event } from "../v2/index.js"
import type { HeadlessRuntimeCommand, HeadlessRuntimeCommandResult } from "./command.js"

export type HeadlessTransportRequest = {
  path: string
  method: "GET" | "POST" | "DELETE"
  query?: Record<string, string | number | boolean | undefined>
  body?: Record<string, unknown>
}

export type HeadlessTransportSubscribeOptions = {
  signal?: AbortSignal
}

/**
 * Transport-agnostic interface for headless runtime communication.
 *
 * The existing HTTP/SSE path and the new IPC path both implement this
 * interface so that `createHeadlessClient` can stay transport-neutral.
 */
export interface HeadlessTransport {
  /** Send a JSON request and return the parsed JSON response. */
  requestJson<TResult>(request: HeadlessTransportRequest): Promise<TResult>

  /** Send a headless runtime command (prompt, command, permission reply, etc.). */
  sendCommand(command: HeadlessRuntimeCommand): Promise<HeadlessRuntimeCommandResult>

  /** Subscribe to the runtime event stream. */
  subscribe(options?: HeadlessTransportSubscribeOptions): AsyncIterable<Event>

  /** Optional cleanup. Safe to call multiple times. */
  close?(): Promise<void>
}

export type HeadlessTransportSessionCreateInput = {
  title?: string
}

export type HeadlessTransportSessionCreateResult = {
  id: string
}

/**
 * Minimal helper used by transport implementations to create a session
 * without depending on the full generated client.
 */
export type HeadlessTransportSession = {
  create(input?: HeadlessTransportSessionCreateInput): Promise<HeadlessTransportSessionCreateResult>
}
