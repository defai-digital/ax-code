import { NamedError } from "@ax-code/util/error"
import { MCP } from "../../mcp"
import { Permission } from "../../permission"
import { Truncate } from "../../tool/truncate"
import { Log } from "../../util/log"
import { MessageV2 } from "../message-v2"
import {
  MAX_MCP_ATTACHMENT_BASE64,
  MAX_MCP_ATTACHMENTS_TOTAL_BASE64,
  MCP_IMAGE_TYPES,
  mcpImageMagicOkRaw,
  measureBase64,
} from "./prompt-mcp-content"
import type { SessionID } from "../schema"

const log = Log.create({ service: "session.prompt" })

const PDF_MAGIC = Buffer.from("%PDF-", "latin1")

function isTextualMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType.endsWith("+json") ||
    mimeType === "application/xml" ||
    mimeType.endsWith("+xml") ||
    mimeType === "application/javascript" ||
    mimeType === "application/x-javascript"
  )
}

function pdfMagicOkRaw(data: string): boolean {
  let head = ""
  for (let index = 0; index < data.length && head.length < 8; index++) {
    const char = data[index]
    if (char === undefined) break
    if (char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f" || char === "\v") continue
    head += char
  }
  if (head.length < 8) return false
  try {
    return Buffer.from(head, "base64").subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)
  } catch {
    return false
  }
}

function dataUrl(mimeType: string, compact: string): string {
  return `data:${mimeType};base64,${compact}`
}

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
    let totalBase64 = 0
    for (const content of contents) {
      if ("text" in content && content.text) {
        const text = `[Untrusted MCP resource content from ${clientName} (${uri})]\n\n${content.text as string}`
        const truncated = await Truncate.output(text)
        pieces.push(input.draftSyntheticTextPart(truncated.content))
      } else if ("blob" in content && content.blob) {
        // MIME types are case-insensitive; normalize before matching so an
        // uppercase declaration cannot bypass the textual/image allowlists.
        const mimeType = ("mimeType" in content && content.mimeType ? content.mimeType : input.part.mime).toLowerCase()
        const blob = content.blob
        // Validate before any decode or data-URL copy: invalid base64 would
        // throw or persist a broken attachment, and an over-cap payload must
        // not allocate a full copy. Neither is decoded or attached; the
        // blob degrades to its binary label only.
        const measured = measureBase64(blob)
        if (!measured || measured.length > MAX_MCP_ATTACHMENT_BASE64) {
          pieces.push(input.draftSyntheticTextPart(`[Binary content: ${mimeType}]`))
          continue
        }
        const compact = measured.hasWhitespace ? blob.replace(/\s/g, "") : blob
        if (isTextualMimeType(mimeType)) {
          const text = `[Untrusted MCP resource content from ${clientName} (${uri})]\n\n${Buffer.from(
            compact,
            "base64",
          ).toString("utf8")}`
          const truncated = await Truncate.output(text)
          pieces.push(input.draftSyntheticTextPart(truncated.content))
          continue
        }
        const imageKind = MCP_IMAGE_TYPES[mimeType]
        const attachable =
          (imageKind !== undefined && mcpImageMagicOkRaw(imageKind, compact)) ||
          (mimeType === "application/pdf" && pdfMagicOkRaw(compact))
        if (attachable) {
          if (totalBase64 + measured.length > MAX_MCP_ATTACHMENTS_TOTAL_BASE64) {
            pieces.push(input.draftSyntheticTextPart(`[Binary content: ${mimeType}]`))
            continue
          }
          totalBase64 += measured.length
          pieces.push(input.attachDraftContext({ ...input.part, mime: mimeType, url: dataUrl(mimeType, compact) }))
          continue
        }
        pieces.push(input.draftSyntheticTextPart(`[Binary content: ${mimeType}]`))
      }
    }
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
