import { NamedError } from "@ax-code/util/error"
import { MCP } from "../mcp"
import { Permission } from "../permission"
import { Truncate } from "../tool/truncate"
import { Log } from "../util/log"
import { MessageV2 } from "./message-v2"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

type Draft<T> = T extends MessageV2.Part ? Omit<T, "id"> & { id?: string } : never
type DraftTextPart = Draft<MessageV2.TextPart>
type DraftFilePart = Draft<MessageV2.FilePart>
type ResourceSource = Extract<NonNullable<MessageV2.FilePart["source"]>, { type: "resource" }>
type ResourceFilePart = Omit<MessageV2.FilePart, "id" | "messageID" | "sessionID" | "source"> & {
  id?: string
  source: ResourceSource
}

export async function resolveMcpResourcePart(input: {
  sessionID: SessionID
  agentName: string
  agentPermission: Permission.Ruleset
  part: ResourceFilePart
  draftSyntheticTextPart: (text: string) => DraftTextPart
  attachDraftContext: (part: ResourceFilePart) => DraftFilePart
}): Promise<Array<DraftTextPart | DraftFilePart>> {
  const { clientName, uri } = input.part.source
  log.info("mcp resource", {
    command: "session.prompt.mcpResource",
    status: "started",
    sessionID: input.sessionID,
    clientName,
    uri,
    mime: input.part.mime,
  })

  const pieces: Array<DraftTextPart | DraftFilePart> = [
    input.draftSyntheticTextPart(`Reading MCP resource: ${input.part.filename} (${uri})`),
  ]

  try {
    const pattern = `uri:${uri}`
    await Permission.ask({
      sessionID: input.sessionID,
      permission: MCP.permissionKey("mcp_resource", clientName),
      patterns: [pattern],
      always: [pattern],
      metadata: {
        mcp: true,
        kind: "resource",
        clientName,
        uri,
        filename: input.part.filename,
      },
      ruleset: input.agentPermission,
      agent: input.agentName,
    })

    const resourceContent = await MCP.readResource(clientName, uri)
    if (!resourceContent) {
      throw new Error(`Resource not found: ${clientName}/${uri}`)
    }

    const contents = Array.isArray(resourceContent.contents) ? resourceContent.contents : [resourceContent.contents]
    for (const content of contents) {
      if ("text" in content && content.text) {
        const text = `[Untrusted MCP resource content from ${clientName} (${uri})]\n\n${content.text as string}`
        const truncated = await Truncate.output(text)
        pieces.push(input.draftSyntheticTextPart(truncated.content))
      } else if ("blob" in content && content.blob) {
        const mimeType = "mimeType" in content ? content.mimeType : input.part.mime
        pieces.push(input.draftSyntheticTextPart(`[Binary content: ${mimeType}]`))
      }
    }

    pieces.push(input.attachDraftContext(input.part))
  } catch (error: unknown) {
    log.error("failed to read MCP resource", {
      command: "session.prompt.mcpResource",
      status: "error",
      errorCode: "MCP_RESOURCE_READ",
      sessionID: input.sessionID,
      error,
      clientName,
      uri,
    })
    const message = NamedError.message(error)
    pieces.push(input.draftSyntheticTextPart(`Failed to read MCP resource ${input.part.filename}: ${message}`))
  }

  return pieces
}
