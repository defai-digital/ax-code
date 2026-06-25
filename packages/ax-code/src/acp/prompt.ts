import type { Role, Usage } from "@agentclientprotocol/sdk"
import type { AssistantMessage } from "@ax-code/sdk/v2"
import { parseUri } from "./agent-adapter"
import { isHttpUri } from "./utils"

export type PromptPart =
  | { type: "text"; text: string; synthetic?: boolean; ignored?: boolean }
  | { type: "file"; url: string; filename: string; mime: string }

export function parsePromptParts(
  prompt: ReadonlyArray<{
    type: string
    text?: string | null
    data?: string | null
    uri?: string | null
    mimeType?: string | null
    name?: string | null
    annotations?: { audience?: Role[] | null } | null
    resource?: { text?: string | null; blob?: string | null; mimeType?: string | null; uri?: string | null }
  }>,
): PromptPart[] {
  const parts: PromptPart[] = []
  for (const part of prompt) {
    switch (part.type) {
      case "text": {
        const audience = part.annotations?.audience
        const forAssistant = audience?.length === 1 && audience[0] === "assistant"
        const forUser = audience?.length === 1 && audience[0] === "user"
        parts.push({
          type: "text" as const,
          text: part.text!,
          ...(forAssistant && { synthetic: true }),
          ...(forUser && { ignored: true }),
        })
        break
      }
      case "image": {
        const parsed = parseUri(part.uri ?? "")
        const filename = parsed.type === "file" ? parsed.filename : "image"
        if (part.data) {
          parts.push({
            type: "file",
            url: `data:${part.mimeType};base64,${part.data}`,
            filename,
            mime: part.mimeType!,
          })
        } else if (part.uri && isHttpUri(part.uri)) {
          parts.push({
            type: "file",
            url: part.uri,
            filename,
            mime: part.mimeType!,
          })
        }
        break
      }
      case "resource_link": {
        const parsed = parseUri(part.uri!)
        if (part.name && parsed.type === "file") {
          parsed.filename = part.name
        }
        parts.push(parsed as PromptPart)
        break
      }
      case "resource": {
        const resource = part.resource
        if (resource && "text" in resource && resource.text) {
          parts.push({
            type: "text",
            text: resource.text,
          })
        } else if (resource && "blob" in resource && resource.blob && resource.mimeType) {
          const parsed = parseUri(resource.uri ?? "")
          const filename = parsed.type === "file" ? parsed.filename : "file"
          parts.push({
            type: "file",
            url: `data:${resource.mimeType};base64,${resource.blob}`,
            filename,
            mime: resource.mimeType,
          })
        }
        break
      }
    }
  }
  return parts
}

export function parseSlashCommand(text: string): { name: string; args: string } | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith("/")) return undefined
  const [name, ...rest] = trimmed.slice(1).split(/\s+/)
  return { name, args: rest.join(" ").trim() }
}

export function buildUsage(msg: AssistantMessage): Usage {
  return {
    totalTokens:
      msg.tokens.input +
      msg.tokens.output +
      msg.tokens.reasoning +
      (msg.tokens.cache?.read ?? 0) +
      (msg.tokens.cache?.write ?? 0),
    inputTokens: msg.tokens.input,
    outputTokens: msg.tokens.output,
    // `??` (not `||`) so that a legitimate `0` count is reported
    // to the ACP client as zero rather than being coerced to
    // undefined ("unknown"). See BUG-70.
    thoughtTokens: msg.tokens.reasoning ?? undefined,
    cachedReadTokens: msg.tokens.cache?.read ?? undefined,
    cachedWriteTokens: msg.tokens.cache?.write ?? undefined,
  }
}
