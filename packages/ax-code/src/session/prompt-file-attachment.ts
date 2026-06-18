import path from "path"
import fs from "fs/promises"
import { fileURLToPath } from "url"
import { NamedError } from "@ax-code/util/error"
import { Instance } from "../project/instance"
import { LSP } from "../lsp"
import { Session } from "."
import { FileTime } from "../file/time"
import { ReadTool } from "../tool/read"
import { Tool } from "../tool/tool"
import { Filesystem } from "../util/filesystem"
import { decodeDataUrl } from "../util/data-url"
import { Log } from "../util/log"
import { MessageV2 } from "./message-v2"
import { MessageID, type SessionID } from "./schema"
import { attachmentLineRange, readToolCallText } from "./prompt-file-reference"
import { maybeResizeImage } from "./image-resize"
import { Config } from "@/config/config"

const log = Log.create({ service: "session.prompt" })

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

function createReadToolContext(input: { sessionID: SessionID; messageID: MessageID; agentName: string }): Tool.Context {
  return {
    sessionID: input.sessionID,
    abort: AbortSignal.timeout(30_000),
    agent: input.agentName,
    messageID: input.messageID,
    extra: { bypassCwdCheck: true },
    messages: [],
    metadata: async () => {},
    ask: async () => {},
  }
}

export async function resolveFileAttachmentPart(input: {
  sessionID: SessionID
  messageID: MessageID
  agentName: string
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
  const readToolContext = () =>
    createReadToolContext({
      sessionID: input.sessionID,
      messageID: input.messageID,
      agentName: input.agentName,
    })

  const part = input.part
  const url = new URL(part.url)
  switch (url.protocol) {
    case "data:":
      if (part.mime === "text/plain") {
        return [
          draftReadToolCallPart({ filePath: part.filename }),
          input.draftSyntheticTextPart(decodeDataUrl(part.url)),
          input.attachDraftContext(part),
        ]
      }
      break
    case "file:":
      log.info("file", {
        command: "session.prompt.fileAttach",
        status: "started",
        sessionID: input.sessionID,
        mime: part.mime,
      })
      // Have to normalize; symbol search returns absolute paths.
      const filepath = fileURLToPath(part.url)

      if (!Instance.containsPath(filepath)) {
        log.warn("file attachment outside project", {
          command: "session.prompt.fileAttach",
          status: "denied",
          sessionID: input.sessionID,
          filepath,
        })
        return [input.draftSyntheticTextPart(`Access denied: file path is outside the project directory: ${filepath}`)]
      }
      const realFilepath = await fs.realpath(filepath).catch(() => null)
      if (realFilepath && !Instance.containsPath(realFilepath)) {
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

      const s = Filesystem.stat(filepath)

      if (s?.isDirectory()) {
        part.mime = "application/x-directory"
      }
      if (part.mime === "text/plain") {
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
        const args = { filePath: filepath, offset, limit }

        const pieces: DraftPart[] = [draftReadToolCallPart(args)]
        await ReadTool.init()
          .then(async (t) => {
            const result = await t.execute(args, readToolContext())
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
        const args = { filePath: filepath }
        return await ReadTool.init()
          .then(async (t) => {
            const result = await t.execute(args, readToolContext())
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

      try {
        await FileTime.read(input.sessionID, filepath)

        let dataUrl: string
        let finalMime = part.mime
        {
          const buffer = await Filesystem.readBytes(filepath)
          if (buffer.length > 50 * 1024 * 1024) throw new Error(`Attachment too large: ${buffer.length} bytes`)

          if (MessageV2.isMedia(part.mime) && part.mime.startsWith("image/")) {
            const cfg = await Config.get()
            const resizeResult = await maybeResizeImage({ buffer, mime: part.mime, config: cfg.attachment?.image })
            if (resizeResult.resized) {
              dataUrl = `data:${resizeResult.mime};base64,` + resizeResult.data
              finalMime = resizeResult.mime
            } else {
              dataUrl = `data:${part.mime};base64,` + buffer.toString("base64")
            }
          } else {
            dataUrl = `data:${part.mime};base64,` + buffer.toString("base64")
          }
        }

        return [
          draftReadToolCallPart({ filePath: filepath }),
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
