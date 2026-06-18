import { createOpencodeClient, type Event } from "@ax-code/sdk/v2"
import type { HeadlessRuntimeCommand, HeadlessRuntimeCommandResult } from "./command"
import { parseJsonResult } from "../../util/json-value"

export type HeadlessAgentRuntimeInput = {
  baseUrl: string
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
}

export type HeadlessAgentRuntime = ReturnType<typeof createHeadlessAgentRuntime>

export function createHeadlessAgentRuntime(input: HeadlessAgentRuntimeInput) {
  const fetchFn = input.fetch ?? fetch
  const client = createOpencodeClient({
    baseUrl: input.baseUrl,
    directory: input.directory,
    fetch: fetchFn,
    headers: input.headers,
  })

  return {
    client,
    async createSession(input?: { title?: string }) {
      const result = await client.session.create(input ?? {})
      const session = result.data
      if (!session?.id) throw new Error("Failed to create headless session: response did not include id")
      return session
    },
    send(command: HeadlessRuntimeCommand) {
      return sendHeadlessRuntimeCommand({
        command,
        baseUrl: input.baseUrl,
        fetch: fetchFn,
        headers: input.headers,
        directory: input.directory,
        client,
      })
    },
    async subscribe(input: { signal: AbortSignal; onEvent: (event: Event) => void | Promise<void> }) {
      const subscription = await client.event.subscribe({}, { signal: input.signal })
      for await (const event of subscription.stream) {
        await input.onEvent(event)
      }
    },
  }
}

async function sendHeadlessRuntimeCommand(input: {
  command: HeadlessRuntimeCommand
  baseUrl: string
  fetch: typeof fetch
  headers?: RequestInit["headers"]
  directory?: string
  client: ReturnType<typeof createOpencodeClient>
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
      ...headlessHeaders(input),
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
  const parsed = parseJsonResult(text)
  if (!parsed.ok) {
    throw new Error(`Headless runtime returned invalid JSON: ${text.slice(0, 200)}`, { cause: parsed.error })
  }
  return parsed.value
}

function headersToRecord(headers: RequestInit["headers"] | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return { ...headers }
}

function headlessHeaders(input: { headers?: RequestInit["headers"]; directory?: string }): Record<string, string> {
  const headers = headersToRecord(input.headers)
  if (input.directory) {
    const encodedDirectory = /[^\x00-\x7F]/.test(input.directory)
      ? encodeURIComponent(input.directory)
      : input.directory
    headers["x-ax-code-directory"] = encodedDirectory
    headers["x-opencode-directory"] = encodedDirectory
  }
  return headers
}
