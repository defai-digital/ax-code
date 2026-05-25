import { createAxCodeClient } from "../v2/client.js"
import type { Event } from "../v2/index.js"
import type {
  HeadlessCommandBody,
  HeadlessPermissionReplyBody,
  HeadlessPromptBody,
  HeadlessQuestionReplyBody,
  HeadlessRuntimeCommand,
  HeadlessRuntimeCommandResult,
  HeadlessShellBody,
} from "./command.js"

export type HeadlessClientOptions = {
  baseUrl: string
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  experimental_workspaceID?: string
}

export type HeadlessSubscribeOptions = {
  signal?: AbortSignal
}

export type HeadlessCreateSessionInput = {
  title?: string
}

export type HeadlessClient = ReturnType<typeof createHeadlessClient>

export function createHeadlessClient(input: HeadlessClientOptions) {
  const fetchFn = input.fetch ?? fetch
  const client = createAxCodeClient({
    baseUrl: input.baseUrl,
    directory: input.directory,
    fetch: fetchFn,
    headers: input.headers,
    experimental_workspaceID: input.experimental_workspaceID,
  })
  const send = (command: HeadlessRuntimeCommand) =>
    sendHeadlessRuntimeCommand({
      command,
      baseUrl: input.baseUrl,
      fetch: fetchFn,
      headers: input.headers,
      client,
    })

  return {
    client,
    async createSession(session?: HeadlessCreateSessionInput) {
      const result = await client.session.create(session ?? {})
      const created = result.data
      if (!created?.id) throw new Error("Failed to create headless session: response did not include id")
      return created
    },
    send,
    sendPrompt(sessionID: string, body: HeadlessPromptBody, options?: { mode?: "sync" | "async" }) {
      return send({ type: "session.prompt", mode: options?.mode ?? "async", sessionID, body })
    },
    sendCommand(sessionID: string, body: HeadlessCommandBody, options?: { mode?: "sync" | "async" }) {
      return send({ type: "session.command", mode: options?.mode ?? "async", sessionID, body })
    },
    sendShell(sessionID: string, body: HeadlessShellBody, options?: { mode?: "sync" | "async" }) {
      return send({ type: "session.shell", mode: options?.mode ?? "async", sessionID, body })
    },
    abort(sessionID: string) {
      return send({ type: "session.abort", sessionID })
    },
    replyPermission(body: HeadlessPermissionReplyBody) {
      return send({ type: "permission.reply", body })
    },
    replyQuestion(body: HeadlessQuestionReplyBody) {
      return send({ type: "question.reply", body })
    },
    async *subscribe(options: HeadlessSubscribeOptions = {}): AsyncGenerator<Event> {
      const subscription = await client.event.subscribe({}, { signal: options.signal })
      for await (const event of subscription.stream) {
        yield event
      }
    },
  }
}

async function sendHeadlessRuntimeCommand(input: {
  command: HeadlessRuntimeCommand
  baseUrl: string
  fetch: typeof fetch
  headers?: RequestInit["headers"]
  client: ReturnType<typeof createAxCodeClient>
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
      return { accepted: true, status: 200, body: await input.client.permission.reply(input.command.body as any) }

    case "question.reply":
      return { accepted: true, status: 200, body: await input.client.question.reply(input.command.body as any) }
  }
}

function postSessionCommand(
  input: Parameters<typeof sendHeadlessRuntimeCommand>[0],
  command: {
    sessionID: string
    route: "message" | "prompt_async" | "command" | "command_async" | "shell" | "shell_async"
    body: Record<string, unknown>
  },
) {
  return postJson(input, `/session/${encodeURIComponent(command.sessionID)}/${command.route}`, command.body)
}

async function postJson(
  input: Parameters<typeof sendHeadlessRuntimeCommand>[0],
  path: string,
  body: Record<string, unknown> | undefined,
): Promise<HeadlessRuntimeCommandResult> {
  const response = await input.fetch(new URL(path, input.baseUrl), {
    method: "POST",
    headers: {
      ...headersToRecord(input.headers),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Headless runtime command failed (${response.status}): ${text || response.statusText}`)
  }
  if (response.status === 202) return { accepted: true, status: 202 }
  const text = await response.text()
  return {
    accepted: true,
    status: 200,
    body: parseHeadlessRuntimeResponseBody(text),
  }
}

export function parseHeadlessRuntimeResponseBody(text: string): unknown {
  if (!text) return true
  return parseHeadlessRuntimeJsonBody(text)
}

export function parseHeadlessRuntimeJsonBody(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new Error(`Headless runtime returned invalid JSON: ${text.slice(0, 200)}`, { cause })
  }
}

function headersToRecord(headers: RequestInit["headers"] | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return headers
}
