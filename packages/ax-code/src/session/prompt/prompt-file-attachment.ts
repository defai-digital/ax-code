import path from "path"
import os from "os"
import fs from "fs/promises"
import { fileURLToPath } from "url"
import { NamedError } from "@ax-code/util/error"
import { Instance } from "../../project/instance"
import { LSP } from "@ax-code/ax-code-intel"
import { Permission } from "../../permission"
import { Session } from ".."
import { FileTime } from "../../file/time"
import { isSupportedImageAttachment } from "../../tool/file-content"
import { assertExternalDirectory } from "../../tool/external-directory"
import { ReadTool } from "../../tool/read"
import { Tool } from "../../tool/tool"
import { Filesystem } from "../../util/filesystem"
import { decodeDataUrl } from "../../util/data-url"
import { Log } from "../../util/log"
import { MessageV2 } from "../message-v2"
import { MessageID, type SessionID } from "../schema"
import { attachmentLineRange, readToolCallText } from "./prompt-file-reference"
import { isTextualMimeType } from "./prompt-mcp-resource"
import { maybeResizeImage } from "../image-resize"
import { Config } from "@/config/config"

const log = Log.create({ service: "session.prompt" })

// Attachments are embedded as base64 data URLs, so bound the file before
// reading it: loading a multi-GB file just to reject it would exhaust memory
// before the post-read check runs.
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

const UNSUPPORTED_IMAGE_TEXT = (mime: string) => `Unsupported image mime type: ${mime}`

function normalizedMediaType(mime: string): string {
  return mime.split(";")[0]?.trim().toLowerCase() || "application/octet-stream"
}

function unsupportedImageMime(mime: string): string | undefined {
  const mediaType = normalizedMediaType(mime)
  if (!mediaType.startsWith("image/")) return undefined
  return isSupportedImageAttachment(mediaType) ? undefined : mediaType
}

type Draft<T> = T extends MessageV2.Part ? Omit<T, "id"> & { id?: string } : never
type DraftTextPart = Draft<MessageV2.TextPart>
type DraftPart = Draft<MessageV2.Part>
type AttachmentFilePart = Omit<MessageV2.FilePart, "id" | "messageID" | "sessionID"> & {
  id?: string
}

type AttachDraftContext = <T extends object>(part: T) => T & { messageID: MessageID; sessionID: SessionID }

export function normalizeDocumentSymbolEnvelopeData<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : []
}

async function documentSymbolsForRangeExpansion(
  uri: string,
): Promise<Awaited<ReturnType<typeof LSP.documentSymbolEnvelope>>["data"]> {
  const cached = await LSP.documentSymbolCachedEnvelope(uri).catch((error) => {
    log.debug("cached document symbols unavailable for range expansion", { uri, error })
    return undefined
  })
  if (cached) return normalizeDocumentSymbolEnvelopeData(cached.data)

  const live = await LSP.documentSymbolEnvelope(uri, { cache: true }).catch((error) => {
    log.debug("document symbols unavailable for range expansion", { uri, error })
    return undefined
  })
  return normalizeDocumentSymbolEnvelopeData(live?.data)
}

function createReadToolContext(input: {
  sessionID: SessionID
  messageID: MessageID
  agentName: string
  permission?: Permission.Ruleset
}): Tool.Context {
  const permission = input.permission
  return {
    sessionID: input.sessionID,
    abort: AbortSignal.timeout(30_000),
    agent: input.agentName,
    messageID: input.messageID,
    // External-directory approval for a home reference is requested once,
    // explicitly, before any file/read dispatch. The read tool must not ask
    // again, but its read-permission ask still goes through real evaluation.
    extra: { bypassCwdCheck: true },
    messages: [],
    metadata: async () => {},
    ask: permission
      ? async (request) => {
          await Permission.ask({
            ...request,
            sessionID: input.sessionID,
            ruleset: permission,
            agent: input.agentName,
          })
        }
      : async () => {},
  }
}

export async function resolveFileAttachmentPart(input: {
  sessionID: SessionID
  messageID: MessageID
  agentName: string
  agentPermission?: Permission.Ruleset
  part: AttachmentFilePart
  draftSyntheticTextPart: (text: string) => DraftTextPart
  attachDraftContext: AttachDraftContext
}): Promise<DraftPart[]> {
  const draftReadToolCallPart = (args: Parameters<typeof readToolCallText>[0]) =>
    input.draftSyntheticTextPart(readToolCallText(args))
  const createReadFailurePart = (options: { error: unknown; filepath: string }) => {
    const message = NamedError.message(options.error)
    Session.publishError({ sessionID: input.sessionID, message })
    return input.draftSyntheticTextPart(
      `Read tool failed to read ${options.filepath} with the following error: ${message}`,
    )
  }
  const readToolContext = async (options?: { externalHome?: boolean }) => {
    if (!options?.externalHome) {
      return createReadToolContext({
        sessionID: input.sessionID,
        messageID: input.messageID,
        agentName: input.agentName,
      })
    }
    const session = await Session.get(input.sessionID)
    const permission = Permission.merge(input.agentPermission ?? [], session.permission ?? [])
    return createReadToolContext({
      sessionID: input.sessionID,
      messageID: input.messageID,
      agentName: input.agentName,
      permission,
    })
  }

  const part = input.part
  let url: URL
  try {
    url = new URL(part.url)
  } catch {
    return [input.draftSyntheticTextPart(`Invalid file URL: ${part.url}`)]
  }
  switch (url.protocol) {
    case "data:": {
      const mime = normalizedMediaType(part.mime)
      if (isTextualMimeType(mime)) {
        part.mime = "text/plain"
        return [
          draftReadToolCallPart({ filePath: part.filename }),
          input.draftSyntheticTextPart(decodeDataUrl(part.url)),
          input.attachDraftContext(part),
        ]
      }
      const unsupported = unsupportedImageMime(mime)
      if (unsupported) return [input.draftSyntheticTextPart(UNSUPPORTED_IMAGE_TEXT(unsupported))]
      if (mime !== "application/pdf" && !mime.startsWith("image/")) {
        return [input.draftSyntheticTextPart(`[Binary content: ${mime}]`)]
      }
      break
    }
    case "file:":
      log.info("file", {
        command: "session.prompt.fileAttach",
        status: "started",
        sessionID: input.sessionID,
        mime: part.mime,
      })
      // Have to normalize; symbol search returns absolute paths.
      let filepath: string
      try {
        filepath = fileURLToPath(part.url)
      } catch {
        return [input.draftSyntheticTextPart(`Invalid file URL: ${part.url}`)]
      }

      const realFilepath = await fs.realpath(filepath).catch(() => null)
      // A source marker of "@~/" identifies a reference the runner resolved
      // from the user's home directory. It may live outside the project, but
      // only when both the requested path and its real target stay in home.
      const homeReference =
        part.source?.type === "file" &&
        (part.source.text.value.startsWith("@~/") || part.source.text.value.startsWith("@file:~/"))
      const externalHome = homeReference && !Instance.containsPath(filepath)
      if (!Instance.containsPath(filepath)) {
        const insideHome =
          externalHome &&
          realFilepath !== null &&
          Filesystem.contains(os.homedir(), filepath) &&
          Filesystem.contains(os.homedir(), realFilepath)
        if (!insideHome) {
          log.warn("file attachment outside project", {
            command: "session.prompt.fileAttach",
            status: "denied",
            sessionID: input.sessionID,
            filepath,
            realFilepath,
          })
          return [
            input.draftSyntheticTextPart(`Access denied: file path is outside the project directory: ${filepath}`),
          ]
        }
      } else if (realFilepath && !Instance.containsPath(realFilepath)) {
        log.warn("file attachment symlink escapes project", {
          command: "session.prompt.fileAttach",
          status: "denied",
          sessionID: input.sessionID,
          filepath,
          realFilepath,
        })
        return [
          input.draftSyntheticTextPart(`Access denied: symlink target is outside the project directory: ${filepath}`),
        ]
      }

      const unsupported = unsupportedImageMime(part.mime)
      if (unsupported) {
        return [input.draftSyntheticTextPart(UNSUPPORTED_IMAGE_TEXT(unsupported))]
      }

      const s = Filesystem.stat(filepath)

      if (s?.isDirectory()) {
        part.mime = "application/x-directory"
      }
      const mime = normalizedMediaType(part.mime)
      // Use the canonical target for every read after approval so a symlink
      // swapped during the approval window cannot redirect the read.
      const readPath = externalHome && realFilepath ? realFilepath : filepath
      // One context serves the external-directory check and both read paths;
      // for an external home reference it carries the merged ruleset.
      const toolContext = await readToolContext({ externalHome })
      if (externalHome) {
        try {
          await assertExternalDirectory(toolContext, filepath, {
            kind: s?.isDirectory() ? "directory" : "file",
          })
        } catch (error) {
          return [createReadFailurePart({ error, filepath })]
        }
      }
      if (isTextualMimeType(mime)) {
        part.mime = "text/plain"
        let offset: number | undefined = undefined
        let limit: number | undefined = undefined
        const range = attachmentLineRange({
          start: url.searchParams.get("start"),
          end: url.searchParams.get("end"),
        })
        if (range) {
          const filePathURI = part.url.split("?")[0]
          let { start, end } = range
          // Some LSP servers (eg, gopls) return a single-line workspace symbol
          // range, so expand it from document symbols when possible.
          if (start !== undefined && start === end) {
            const symbols = await documentSymbolsForRangeExpansion(filePathURI)
            for (const symbol of symbols) {
              let range: LSP.Range | undefined
              if ("range" in symbol) {
                range = symbol.range
              } else if ("location" in symbol) {
                range = symbol.location.range
              }
              if (range?.start?.line != null && range?.start?.line === start) {
                start = range.start.line
                end = range?.end?.line ?? start
                break
              }
            }
          }
          if (start !== undefined) {
            offset = start + 1
            if (end !== undefined) {
              limit = end - start + 1
            }
          }
        }
        const args = { filePath: readPath, offset, limit }

        const pieces: DraftPart[] = [draftReadToolCallPart(args)]
        await ReadTool.init()
          .then(async (t) => {
            const result = await t.execute(args, toolContext)
            pieces.push(input.draftSyntheticTextPart(result.output))
            if (result.attachments?.length) {
              pieces.push(
                ...result.attachments.map((attachment) => ({
                  ...input.attachDraftContext(attachment),
                  synthetic: true,
                  filename: attachment.filename ?? part.filename,
                })),
              )
            } else {
              pieces.push(input.attachDraftContext(part))
            }
          })
          .catch((error) => {
            log.error("failed to read file", {
              command: "session.prompt.readFile",
              status: "error",
              errorCode: "FILE_READ",
              sessionID: input.sessionID,
              error,
            })
            pieces.push(createReadFailurePart({ error, filepath }))
          })

        return pieces
      }

      if (part.mime === "application/x-directory") {
        const args = { filePath: readPath }
        return await ReadTool.init()
          .then(async (t) => {
            const result = await t.execute(args, toolContext)
            return [
              draftReadToolCallPart(args),
              input.draftSyntheticTextPart(result.output),
              input.attachDraftContext(part),
            ]
          })
          .catch((error) => {
            log.error("failed to read directory", {
              command: "session.prompt.readDir",
              status: "error",
              errorCode: "DIR_READ",
              sessionID: input.sessionID,
              error,
            })
            return [createReadFailurePart({ error, filepath })]
          })
      }

      if (mime !== "application/pdf" && !mime.startsWith("image/")) {
        return [input.draftSyntheticTextPart(`[Binary content: ${mime}]`)]
      }
      part.mime = mime

      try {
        await FileTime.read(input.sessionID, readPath)

        let dataUrl: string
        let finalMime = part.mime
        {
          // Reject oversized files from the stat before reading; the
          // post-read check below still guards growth between stat and read.
          if (s && s.size > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment too large: ${s.size} bytes`)
          const buffer = await Filesystem.readBytes(readPath)
          if (buffer.length > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment too large: ${buffer.length} bytes`)

          if (MessageV2.isMedia(part.mime) && part.mime.startsWith("image/")) {
            const cfg = await Config.get()
            const resizeResult = await maybeResizeImage({ buffer, mime: part.mime, config: cfg.attachment?.image })
            if (resizeResult.resized) {
              dataUrl = `data:${resizeResult.mime};base64,` + resizeResult.data
              finalMime = resizeResult.mime
            } else if ("error" in resizeResult && resizeResult.error === "too_large") {
              // The image is still over the caller's budget (auto_resize off,
              // no photon, an undecodable file, or every candidate too big).
              // Embedding the original here would silently defeat the limit.
              // Base64 length is 4 * ceil(bytes / 3): do not re-encode up to
              // 50MB just to measure the string this error message needs.
              throw new Error(`Attachment too large: ${Math.ceil((buffer.length * 4) / 3)} base64 bytes`)
            } else {
              dataUrl = `data:${part.mime};base64,` + buffer.toString("base64")
            }
          } else {
            dataUrl = `data:${part.mime};base64,` + buffer.toString("base64")
          }
        }

        return [
          draftReadToolCallPart({ filePath: readPath }),
          {
            id: part.id,
            messageID: input.messageID,
            sessionID: input.sessionID,
            type: "file",
            url: dataUrl,
            mime: finalMime,
            filename: part.filename ?? path.basename(filepath),
            source: part.source,
          },
        ]
      } catch (error) {
        log.error("failed to read binary file", {
          command: "session.prompt.readBinaryFile",
          status: "error",
          errorCode: "BINARY_READ",
          sessionID: input.sessionID,
          error,
        })
        return [createReadFailurePart({ error, filepath })]
      }
    default:
      return [input.draftSyntheticTextPart(`Unsupported file protocol: ${url.protocol}`)]
  }

  return [input.attachDraftContext(part)]
}
