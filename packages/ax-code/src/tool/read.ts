import z from "zod"
import { createReadStream } from "fs"
import * as fs from "fs/promises"
import * as path from "path"
import { createInterface } from "readline"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { FileTime } from "../file/time"
import DESCRIPTION from "./read.txt"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import { InstructionPrompt } from "../session/instruction"
import { Filesystem } from "../util/filesystem"
import { DEFAULT_READ_LIMIT, MAX_LINE_LENGTH, MAX_LINE_SUFFIX, MAX_BYTES, MAX_BYTES_LABEL } from "@/constants/tool"
import { Log } from "@/util/log"
import { isHarmlessEffectInterrupt } from "@/effect/interrupt"

const log = Log.create({ service: "tool.read" })

function readError(name: string, message: string, cause?: unknown) {
  const error = cause instanceof Error ? new Error(message, { cause }) : new Error(message)
  error.name = name
  return error
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function warmSemanticLsp(filepath: string) {
  const directory = Instance.directory
  const handle = (err: unknown) => {
    if (isHarmlessEffectInterrupt(err)) return
    log.warn("opportunistic lsp warmup failed", {
      filepath,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const task = Instance.bind(async () => {
    // Skip deferred warmup if the project instance was already disposed.
    if (!Instance.list().includes(directory)) return
    Promise.resolve()
      .then(async () => {
        const available = await LSP.hasClients(filepath, { mode: "semantic" })
        if (!available) return
        if (!Instance.list().includes(directory)) return
        await LSP.touchFile(filepath, false, { mode: "semantic" })
      })
      .catch(handle)
  })
  const timer = setTimeout(task, 0)
  timer.unref?.()
}

export const ReadTool = Tool.define("read", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file or directory to read"),
    offset: z.coerce.number().int().min(1).describe("The line number to start reading from (1-indexed)").optional(),
    limit: z.coerce.number().max(10000).describe("The maximum number of lines to read (defaults to 2000)").optional(),
  }),
  async execute(params, ctx) {
    if (params.filePath.includes("\x00")) throw readError("ReadInvalidPathError", "File path contains null byte")
    if (params.offset !== undefined && params.offset < 1) {
      throw readError("ReadInvalidOffsetError", "offset must be greater than or equal to 1")
    }
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(Instance.directory, filepath)
    }
    const title = path.relative(Instance.worktree, filepath)
    try {
      const stat = Filesystem.stat(filepath)

      await assertExternalDirectory(ctx, filepath, {
        bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
        kind: stat?.isDirectory() ? "directory" : "file",
      })

      // Resolve symlinks and re-check containment so a symlink inside
      // the project pointing at e.g. `/etc/shadow` or `~/.ssh/id_rsa`
      // can't be read through the symlink. Only enforce the check when
      // the original path was inside the project — external reads are
      // a separate workflow gated by `assertExternalDirectory` above
      // and must still be allowed after the permission grant.
      if (stat && Filesystem.contains(Instance.directory, filepath)) {
        const realFilepath = await fs.realpath(filepath).catch(() => null)
        if (realFilepath && !Filesystem.contains(Instance.directory, realFilepath)) {
          throw readError("ReadSymlinkEscapeError", "Access denied: symlink target escapes project directory")
        }
      }

      await ctx.ask({
        permission: "read",
        patterns: [filepath],
        always: ["*"],
        metadata: {},
      })

      if (!stat) {
        const dir = path.dirname(filepath)
        const base = path.basename(filepath)

        const suggestions = await fs
          .readdir(dir)
          .then((entries) =>
            entries
              .filter(
                (entry) =>
                  entry.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(entry.toLowerCase()),
              )
              .map((entry) => path.join(dir, entry))
              .slice(0, 3),
          )
          .catch(() => [])

        if (suggestions.length > 0) {
          throw readError(
            "ReadFileNotFoundError",
            `File not found: ${filepath}\n\nDid you mean one of these?\n${suggestions.join("\n")}`,
          )
        }

        throw readError("ReadFileNotFoundError", `File not found: ${filepath}`)
      }

      if (stat.isDirectory()) {
        const dirents = await fs.readdir(filepath, { withFileTypes: true })
        const entries = await Promise.all(
          dirents.map(async (dirent) => {
            if (dirent.isDirectory()) return dirent.name + "/"
            if (dirent.isSymbolicLink()) {
              const target = await fs.stat(path.join(filepath, dirent.name)).catch(() => undefined)
              if (target?.isDirectory()) return dirent.name + "/"
            }
            return dirent.name
          }),
        )
        entries.sort((a, b) => a.localeCompare(b))

        const limit = params.limit ?? DEFAULT_READ_LIMIT
        const offset = params.offset ?? 1
        const start = offset - 1
        const sliced = entries.slice(start, start + limit)
        const truncated = start + sliced.length < entries.length

        const output = [
          `<path>${filepath}</path>`,
          `<type>directory</type>`,
          `<entries>`,
          sliced.join("\n"),
          truncated
            ? `\n(Showing ${sliced.length} of ${entries.length} entries. Use 'offset' parameter to read beyond entry ${offset + sliced.length})`
            : `\n(${entries.length} entries)`,
          `</entries>`,
        ].join("\n")

        return {
          title,
          output,
          metadata: {
            preview: sliced.slice(0, 20).join("\n"),
            truncated,
            loaded: [] as string[],
          },
        }
      }

      const instructions = await InstructionPrompt.resolve(ctx.messages, filepath, ctx.messageID)

      // Exclude SVG (XML-based) and vnd.fastbidsheet (.fbs extension, commonly FlatBuffers schema files)
      const mime = Filesystem.mimeType(filepath)
      const isImage = mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"
      const isPdf = mime === "application/pdf"
      if (isImage || isPdf) {
        const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
        if (Number(stat.size) > MAX_ATTACHMENT_BYTES) {
          throw readError(
            "ReadAttachmentTooLargeError",
            `File too large to read as attachment: ${Number(stat.size)} bytes (max ${MAX_ATTACHMENT_BYTES})`,
          )
        }
        const msg = `${isImage ? "Image" : "PDF"} read successfully`
        return {
          title,
          output: msg,
          metadata: {
            preview: msg,
            truncated: false,
            loaded: instructions.map((i) => i.filepath),
          },
          attachments: [
            {
              type: "file",
              mime,
              url: `data:${mime};base64,${Buffer.from(await Filesystem.readBytes(filepath)).toString("base64")}`,
            },
          ],
        }
      }

      const isBinary = await isBinaryFile(filepath, Number(stat.size))
      if (isBinary) throw readError("ReadBinaryFileError", `Cannot read binary file: ${filepath}`)

      const stream = createReadStream(filepath, { encoding: "utf8" })
      const rl = createInterface({
        input: stream,
        // Note: we use the crlfDelay option to recognize all instances of CR LF
        // ('\r\n') in file as a single line break.
        crlfDelay: Infinity,
      })

      const limit = params.limit ?? DEFAULT_READ_LIMIT
      const offset = params.offset ?? 1
      const start = offset - 1
      const raw: string[] = []
      let bytes = 0
      let lines = 0
      let firstLine = true
      let truncatedByBytes = false
      let hasMoreLines = false
      try {
        for await (const text of rl) {
          const normalizedText = firstLine && text.startsWith("\uFEFF") ? text.slice(1) : text
          firstLine = false
          lines += 1
          if (lines <= start) continue

          if (raw.length >= limit) {
            hasMoreLines = true
            continue
          }

          const line =
            normalizedText.length > MAX_LINE_LENGTH
              ? normalizedText.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX
              : normalizedText
          const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)
          if (bytes + size > MAX_BYTES) {
            truncatedByBytes = true
            hasMoreLines = true
            break
          }

          raw.push(line)
          bytes += size
        }
      } finally {
        rl.close()
        stream.destroy()
      }

      if (lines < offset && !(lines === 0 && offset === 1)) {
        throw readError("ReadOffsetOutOfRangeError", `Offset ${offset} is out of range for this file (${lines} lines)`)
      }

      const content = raw.map((line, index) => {
        return `${index + offset}: ${line}`
      })
      const preview = raw.slice(0, 20).join("\n")

      let output = [`<path>${filepath}</path>`, `<type>file</type>`, "<content>"].join("\n")
      output += content.join("\n")

      const totalLines = lines
      const lastReadLine = offset + raw.length - 1
      const nextOffset = lastReadLine + 1
      const truncated = hasMoreLines || truncatedByBytes

      if (truncatedByBytes) {
        output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${offset}-${lastReadLine} of file. Use offset=${nextOffset} to continue.)`
      } else if (hasMoreLines) {
        output += `\n\n(Showing lines ${offset}-${lastReadLine} of ${totalLines}. Use offset=${nextOffset} to continue.)`
      } else {
        output += `\n\n(End of file - total ${totalLines} lines)`
      }
      output += "\n</content>"

      await FileTime.read(ctx.sessionID, filepath)

      if (instructions.length > 0) {
        output += `\n\n<system-reminder>\n${instructions.map((i) => i.content).join("\n\n")}\n</system-reminder>`
      }

      // Opportunistic warmup for later semantic navigation. Schedule it
      // after the read's last awaited work so current output is not held
      // behind best-effort LSP startup.
      warmSemanticLsp(filepath)

      return {
        title,
        output,
        metadata: {
          preview,
          truncated,
          loaded: instructions.map((i) => i.filepath),
        },
      }
    } catch (error) {
      log.error("read failed", {
        sessionID: ctx.sessionID,
        filePath: filepath,
        errorCode: error instanceof Error ? error.name : "Unknown",
        errorMessage: readErrorMessage(error),
      })
      throw error
    }
  },
})

async function isBinaryFile(filepath: string, fileSize: number): Promise<boolean> {
  const ext = path.extname(filepath).toLowerCase()
  // binary check for common non-text extensions
  switch (ext) {
    case ".zip":
    case ".tar":
    case ".gz":
    case ".exe":
    case ".dll":
    case ".so":
    case ".class":
    case ".jar":
    case ".war":
    case ".7z":
    case ".doc":
    case ".docx":
    case ".xls":
    case ".xlsx":
    case ".ppt":
    case ".pptx":
    case ".odt":
    case ".ods":
    case ".odp":
    case ".bin":
    case ".dat":
    case ".obj":
    case ".o":
    case ".a":
    case ".lib":
    case ".wasm":
    case ".pyc":
    case ".pyo":
      return true
    default:
      break
  }

  if (fileSize === 0) return false

  const fh = await fs.open(filepath, "r")
  try {
    const sampleSize = Math.min(4096, fileSize)
    const bytes = Buffer.alloc(sampleSize)
    const result = await fh.read(bytes, 0, sampleSize, 0)
    if (result.bytesRead === 0) return false

    let nonPrintableCount = 0
    for (let i = 0; i < result.bytesRead; i++) {
      if (bytes[i] === 0) return true
      if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
        nonPrintableCount++
      }
    }
    // If >30% non-printable characters, consider it binary
    return nonPrintableCount / result.bytesRead > 0.3
  } finally {
    await fh.close()
  }
}
