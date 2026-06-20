import { createAxCodeClient } from "../v2/client.js"
import { AX_CODE_WORKSPACE_HEADER, LEGACY_OPENCODE_WORKSPACE_HEADER } from "../protocol.js"
import type { Event } from "../v2/index.js"
import type { HeadlessRuntimeCommand, HeadlessRuntimeCommandResult } from "./command.js"
import type {
  HeadlessTransport,
  HeadlessTransportRequest,
  HeadlessTransportSession,
  HeadlessTransportSessionCreateInput,
  HeadlessTransportSessionCreateResult,
  HeadlessTransportSubscribeOptions,
} from "./transport.js"
import { parseHeadlessRuntimeResponseBody } from "./util.js"

export type HttpSseTransportOptions = {
  baseUrl: string
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  experimental_workspaceID?: string
}

/**
 * HTTP/SSE implementation of the headless transport interface.
 *
 * This is the legacy transport path used by CLI/TUI and external consumers.
 * It wraps the OpenAPI-generated v2 client for SSE subscriptions and uses
 * raw fetch for command and request routing.
 */
export function createHttpSseTransport(options: HttpSseTransportOptions): HeadlessTransport {
  const fetchFn = options.fetch ?? fetch
  const client = createAxCodeClient({
    baseUrl: options.baseUrl,
    directory: options.directory,
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    headers: options.headers,
    experimental_workspaceID: options.experimental_workspaceID,
  })

  const requestJson = async <TResult>(request: HeadlessTransportRequest): Promise<TResult> => {
    const url = new URL(request.path, options.baseUrl)
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }

    const response = await fetchFn(url, {
      method: request.method,
      headers: {
        ...headlessHeaders(options),
        ...(request.body ? { "Content-Type": "application/json" } : {}),
      },
      body: request.body ? JSON.stringify(request.body) : undefined,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(`Headless runtime request failed (${response.status}): ${text || response.statusText}`)
    }
    return parseHeadlessRuntimeResponseBody(await response.text()) as TResult
  }

  const sendCommand = (command: HeadlessRuntimeCommand): Promise<HeadlessRuntimeCommandResult> =>
    sendHeadlessRuntimeCommand({ command, requestJson })

  return {
    requestJson,
    sendCommand,
    async *subscribe(options?: HeadlessTransportSubscribeOptions): AsyncGenerator<Event> {
      const subscription = await client.event.subscribe({}, { signal: options?.signal })
      for await (const event of subscription.stream) {
        yield event
      }
    },
  }
}

async function sendHeadlessRuntimeCommand(input: {
  command: HeadlessRuntimeCommand
  requestJson: <TResult>(request: HeadlessTransportRequest) => Promise<TResult>
}): Promise<HeadlessRuntimeCommandResult> {
  switch (input.command.type) {
    case "session.prompt":
      return postSessionCommand(input, {
        sessionID: input.command.sessionID,
        route: input.command.mode === "sync" ? "message" : "prompt_async",
        body: input.command.body,
      })

    case "session.command":
      return postSessionCommand(input, {
        sessionID: input.command.sessionID,
        route: input.command.mode === "sync" ? "command" : "command_async",
        body: input.command.body,
      })

    case "session.shell":
      return postSessionCommand(input, {
        sessionID: input.command.sessionID,
        route: input.command.mode === "sync" ? "shell" : "shell_async",
        body: input.command.body,
      })

    case "session.abort":
      return postJson(input, `/session/${encodeURIComponent(input.command.sessionID)}/abort`, undefined)

    case "permission.reply":
      return {
        accepted: true,
        status: 200,
        body: await input.requestJson({
          path: "/permission/reply",
          method: "POST",
          body: input.command.body as Record<string, unknown>,
        }),
      }

    case "question.reply":
      return {
        accepted: true,
        status: 200,
        body: await input.requestJson({
          path: "/question/reply",
          method: "POST",
          body: input.command.body as Record<string, unknown>,
        }),
      }
  }
}

function postSessionCommand(
  input: { requestJson: <TResult>(request: HeadlessTransportRequest) => Promise<TResult> },
  command: {
    sessionID: string
    route: "message" | "prompt_async" | "command" | "command_async" | "shell" | "shell_async"
    body: Record<string, unknown>
  },
) {
  return postJson(input, `/session/${encodeURIComponent(command.sessionID)}/${command.route}`, command.body)
}

async function postJson(
  input: { requestJson: <TResult>(request: HeadlessTransportRequest) => Promise<TResult> },
  path: string,
  body: Record<string, unknown> | undefined,
): Promise<HeadlessRuntimeCommandResult> {
  const response = await input.requestJson<unknown>({
    path,
    method: "POST",
    body,
  })
  return { accepted: true, status: 200, body: response }
}

function headersToRecord(headers: RequestInit["headers"] | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return { ...headers }
}

export function headlessHeaders(input: {
  headers?: RequestInit["headers"]
  directory?: string
  experimental_workspaceID?: string
}): Record<string, string> {
  const headers = headersToRecord(input.headers)
  if (input.directory) {
    const encodedDirectory = /[^\x00-\x7F]/.test(input.directory)
      ? encodeURIComponent(input.directory)
      : input.directory
    headers["x-ax-code-directory"] = encodedDirectory
    headers["x-opencode-directory"] = encodedDirectory
  }
  if (input.experimental_workspaceID) {
    headers[AX_CODE_WORKSPACE_HEADER] = input.experimental_workspaceID
    headers[LEGACY_OPENCODE_WORKSPACE_HEADER] = input.experimental_workspaceID
  }
  return headers
}

export function createHttpSseTransportSession(
  requestJson: <TResult>(request: HeadlessTransportRequest) => Promise<TResult>,
): HeadlessTransportSession {
  return {
    async create(input?: HeadlessTransportSessionCreateInput): Promise<HeadlessTransportSessionCreateResult> {
      const result = await requestJson<{ id?: string }>({ path: "/session", method: "POST", body: input ?? {} })
      if (!result.id) throw new Error("Failed to create headless session: response did not include id")
      return { id: result.id }
    },
  }
}
