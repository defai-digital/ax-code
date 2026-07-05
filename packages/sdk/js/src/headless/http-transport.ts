import { createAxCodeClient } from "../v2/client.js"
import { headersToRecord, withDirectoryHeaders, withWorkspaceHeaders } from "../protocol.js"
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

type HttpTransportResponse = {
  status: number
  body: unknown
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

  const request = async (request: HeadlessTransportRequest): Promise<HttpTransportResponse> => {
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
    return {
      status: response.status,
      body: parseHeadlessRuntimeResponseBody(await response.text()),
    }
  }

  const requestJson = async <TResult>(requestInput: HeadlessTransportRequest): Promise<TResult> =>
    (await request(requestInput)).body as TResult

  const sendCommand = (command: HeadlessRuntimeCommand): Promise<HeadlessRuntimeCommandResult> =>
    sendHeadlessRuntimeCommand({ command, request })

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
  request: (request: HeadlessTransportRequest) => Promise<HttpTransportResponse>
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
      return commandResult(
        await input.request({
          path: "/permission/reply",
          method: "POST",
          body: input.command.body as Record<string, unknown>,
        }),
      )

    case "question.reply":
      return commandResult(
        await input.request({
          path: "/question/reply",
          method: "POST",
          body: input.command.body as Record<string, unknown>,
        }),
      )
  }
}

function postSessionCommand(
  input: { request: (request: HeadlessTransportRequest) => Promise<HttpTransportResponse> },
  command: {
    sessionID: string
    route: "message" | "prompt_async" | "command" | "command_async" | "shell" | "shell_async"
    body: Record<string, unknown>
  },
) {
  return postJson(input, `/session/${encodeURIComponent(command.sessionID)}/${command.route}`, command.body)
}

async function postJson(
  input: { request: (request: HeadlessTransportRequest) => Promise<HttpTransportResponse> },
  path: string,
  body: Record<string, unknown> | undefined,
): Promise<HeadlessRuntimeCommandResult> {
  const response = await input.request({
    path,
    method: "POST",
    body,
  })
  return commandResult(response)
}

function commandResult(response: HttpTransportResponse): HeadlessRuntimeCommandResult {
  if (response.status === 202) return { accepted: true, status: 202 }
  return { accepted: true, status: 200, body: response.body }
}

export function headlessHeaders(input: {
  headers?: RequestInit["headers"]
  directory?: string
  experimental_workspaceID?: string
}): Record<string, string> {
  const headers = headersToRecord(input.headers)
  if (input.directory) {
    Object.assign(headers, withDirectoryHeaders(undefined, input.directory))
  }
  if (input.experimental_workspaceID) {
    Object.assign(headers, withWorkspaceHeaders(undefined, input.experimental_workspaceID))
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
