import z from "zod"
import * as fs from "fs/promises"
import type { BigIntStats } from "fs"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "@ax-code/ax-code-intel"
import { speculativeLspPrewarmEnabled } from "@ax-code/ax-code-intel/prewarm-profile"
import { FileTime } from "../file/time"
import DESCRIPTION from "./read.txt"
import { Instance } from "../project/instance"
import { assertExternalDirectory, assertSymlinkInsideProject } from "./external-directory"
import { InstructionPrompt } from "../session/instruction"
import { Filesystem } from "../util/filesystem"
import { DEFAULT_READ_LIMIT } from "@/constants/tool"
import { toErrorMessage } from "@/util/error-message"
import { Log } from "@/util/log"
import { isHarmlessInterrupt } from "@/util/harmless-interrupt"
import { NULL_BYTE_PATH_ERROR, normalizeToWorkspacePath, resolveToolFilePath, withFilePathAliases } from "./file-path"
import { isBinaryFile } from "./file-content"
import { detectOfficeKind, extractOfficeText } from "./office-text"
import { ToolNumber } from "./schema"
import { CanonicalOutput } from "./canonical-output"

import { EvidenceCache } from "../evidence/cache"
import { evidenceCacheMode } from "../evidence/mode"
import { readSourceSnapshot, ReadTextResult, renderReadText, sameReadSource } from "./read-text"

const log = Log.create({ service: "tool.read" })

function readError(name: string, message: string, cause?: unknown) {
  const error = cause instanceof Error ? new Error(message, { cause }) : new Error(message)
  error.name = name
  return error
}

/** The path was re-checked before approval; verify the bytes came from that
 *  same source and that a replaced path is not an escaping symlink. */
async function assertReadSourceStable(filepath: string, before: BigIntStats) {
  const after = await fs.stat(filepath, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR")
      throw readError("ReadSourceChangedError", "File changed while reading; retry the read", error)
    throw error
  })
  if (!sameReadSource(before, after))
    throw readError("ReadSourceChangedError", "File changed while reading; retry the read")
  if (Instance.containsPath(filepath)) {
    await assertSymlinkInsideProject(filepath).catch((error) => {
      throw readError("ReadSymlinkEscapeError", toErrorMessage(error), error)
    })
  }
}

function warmSemanticLsp(filepath: string, signal?: AbortSignal) {
  if (!speculativeLspPrewarmEnabled()) return
  const directory = Instance.directory
  let cancelled = false
  const handle = (err: unknown) => {
    if (isHarmlessInterrupt(err)) return
    log.warn("opportunistic lsp warmup failed", {
      filepath,
      error: toErrorMessage(err),
    })
  }

  const task = Instance.bind(async () => {
    if (cancelled || signal?.aborted) return
    // Skip deferred warmup if the project instance was already disposed.
    if (!Instance.list().includes(directory)) return
    await Promise.resolve()
      .then(async () => {
        if (cancelled || signal?.aborted) return
        const available = await LSP.hasClients(filepath, { mode: "semantic" })
        if (!available) return
        if (cancelled || signal?.aborted) return
        if (!Instance.list().includes(directory)) return
        await LSP.touchFile(filepath, false, { mode: "semantic" })
      })
      .catch(handle)
  })
  const cancel = () => {
    cancelled = true
    clearTimeout(timer)
    signal?.removeEventListener("abort", cancel)
    unsubscribe()
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", cancel)
    if (signal?.aborted) return
    void task().finally(unsubscribe).catch(handle)
  }, 0)
  // Disposal may await native close while the instance is still listed. Stop
  // background admission at lifecycle start, including disposeAll's later entries.
  const unsubscribe = Instance.onLifecycle((event) => {
    if (
      event.kind === "dispose_all.start" ||
      (event.directory === directory && (event.kind === "dispose.start" || event.kind === "reload.start"))
    )
      cancel()
  })
  timer.unref?.()
  if (signal?.aborted) {
    cancel()
    return
  }
  signal?.addEventListener("abort", cancel, { once: true })
}

export const ReadTool = Tool.define("read", {
  description: DESCRIPTION,
  parameters: withFilePathAliases(
    z.object({
      filePath: z.string().min(1).describe("The absolute path to the file or directory to read"),
      offset: ToolNumber(z.number().int().min(1))
        .describe("The line number to start reading from (1-indexed)")
        .optional(),
      limit: ToolNumber(z.number().int().min(1).max(10000))
        .describe("The maximum number of lines to read (defaults to 2000)")
        .optional(),
    }),
  ),
  concurrencySafe: () => true,
  outputSchema: CanonicalOutput.Read,
  async execute(params, ctx) {
    if (params.filePath.includes("\x00")) throw readError("ReadInvalidPathError", NULL_BYTE_PATH_ERROR)
    if (params.offset !== undefined && params.offset < 1) {
      throw readError("ReadInvalidOffsetError", "offset must be greater than or equal to 1")
    }
    if (params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 1)) {
      throw readError("ReadInvalidLimitError", "limit must be an integer greater than or equal to 1")
    }
    const filepath = resolveToolFilePath(params.filePath, Instance.directory)
    const title = normalizeToWorkspacePath(filepath, Instance.worktree)
    try {
      // Async stat: every read paid a synchronous statSync here just to tell a
      // directory from a file. A missing path still yields undefined; only real
      // errors (EACCES, ELOOP, …) propagate, matching Filesystem.stat's
      // throwIfNoEntry behavior for ENOENT/ENOTDIR.
      const stat = await fs.stat(filepath).catch((error: NodeJS.ErrnoException) => {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return undefined
        throw error
      })

      await assertExternalDirectory(ctx, filepath, {
        bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
        kind: stat?.isDirectory() ? "directory" : "file",
      })

      // Resolve symlinks and re-check containment so a symlink inside
      // the project/worktree pointing at e.g. `/etc/shadow` or
      // `~/.ssh/id_rsa` can't be read through the symlink. Only enforce
      // the check when the original path was inside the project boundary
      // — external reads are a separate workflow gated by
      // `assertExternalDirectory` above and must still be allowed after
      // the permission grant.
      if (stat && Instance.containsPath(filepath)) {
        await assertSymlinkInsideProject(filepath).catch((error) => {
          throw readError("ReadSymlinkEscapeError", toErrorMessage(error), error)
        })
      }

      // Permission rules and policies name files workspace-relatively
      // (`src/**`, `.env`, `*.key`), so the ask has to use the same domain as
      // the write and edit tools. An absolute pattern never matches those
      // anchored rules, which left a deny or ask rule silently unenforced.
      await ctx.ask({
        permission: "read",
        patterns: [title || filepath],
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
        const before = await fs.stat(filepath, { bigint: true })
        const dirents = await fs.readdir(filepath, { withFileTypes: true })
        await assertReadSourceStable(filepath, before)
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
        if (entries.length < offset && !(entries.length === 0 && offset === 1)) {
          throw readError(
            "ReadOffsetOutOfRangeError",
            `Offset ${offset} is out of range for this directory (${entries.length} entries)`,
          )
        }
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
          data: { kind: "directory", text: output, truncated },
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
        const before = await fs.stat(filepath, { bigint: true })
        if (Number(before.size) > MAX_ATTACHMENT_BYTES) {
          throw readError(
            "ReadAttachmentTooLargeError",
            `File too large to read as attachment: ${Number(before.size)} bytes (max ${MAX_ATTACHMENT_BYTES})`,
          )
        }
        const bytes = await Filesystem.readBytes(filepath)
        await assertReadSourceStable(filepath, before)
        return {
          title,
          output: msg,
          data: { kind: "media", text: msg, truncated: false },
          metadata: {
            preview: msg,
            truncated: false,
            loaded: instructions.map((i) => i.filepath),
          },
          attachments: [
            {
              type: "file",
              mime,
              url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
            },
          ],
        }
      }

      const isBinary = await isBinaryFile(filepath)
      if (isBinary) {
        // ADR-238: extract plain text from Office Open XML files before
        // rejecting as binary. zip-encrypted or malformed archives return a
        // short reason and the same binary refusal shape.
        const office = detectOfficeKind(filepath)
        if (office) {
          const bigStat = await fs.stat(filepath, { bigint: true })
          const result = await extractOfficeText(filepath)
          await assertReadSourceStable(filepath, bigStat)
          if (result.reason) {
            throw readError("ReadOfficeExtractionError", result.reason)
          }
          const out = result.text
          const note = result.truncated ? "\n(truncated to 200 KB)" : ""
          ctx.abort.throwIfAborted()
          await FileTime.read(ctx.sessionID, filepath, {
            mtime: Number(bigStat.mtimeMs),
            ctime: Number(bigStat.ctimeMs),
            size: Number(bigStat.size),
            mtimeNs: bigStat.mtimeNs.toString(),
            ctimeNs: bigStat.ctimeNs.toString(),
            dev: bigStat.dev.toString(),
            ino: bigStat.ino.toString(),
          })
          return {
            title,
            output: out + note,
            data: { kind: "text", text: out, truncated: Boolean(result.truncated) },
            metadata: {
              preview: out.slice(0, 200),
              truncated: Boolean(result.truncated),
              loaded: instructions.map((i) => i.filepath),
            },
          }
        }
        throw readError("ReadBinaryFileError", `Cannot read binary file: ${filepath}`)
      }

      const limit = params.limit ?? DEFAULT_READ_LIMIT
      const offset = params.offset ?? 1
      const before = await fs.stat(filepath, { bigint: true })
      const snapshot =
        evidenceCacheMode() !== "off" && Instance.containsPath(filepath)
          ? await readSourceSnapshot(filepath, ctx.abort)
          : undefined
      const cacheKey = snapshot
        ? EvidenceCache.key("read-v1", filepath, EvidenceCache.digest(snapshot.bytes), offset, limit)
        : undefined
      const cached = cacheKey ? await EvidenceCache.get(cacheKey, ReadTextResult) : undefined
      const rendered =
        cached ?? (await renderReadText(filepath, offset, limit, ctx.abort, snapshot?.bytes.toString("utf8")))
      const observed = snapshot?.stamp ?? before
      const after = await fs.stat(filepath, { bigint: true })
      if (!sameReadSource(observed, after))
        throw readError("ReadSourceChangedError", "File changed while reading; retry the read")
      if (Instance.containsPath(filepath)) await assertSymlinkInsideProject(filepath)
      ctx.abort.throwIfAborted()
      if (cacheKey && !cached) await EvidenceCache.put(cacheKey, rendered)
      ctx.abort.throwIfAborted()
      await FileTime.read(ctx.sessionID, filepath, {
        mtime: Number(observed.mtimeMs),
        ctime: Number(observed.ctimeMs),
        size: Number(observed.size),
        // `observed` is the BigIntStats the read itself validated, so the
        // nanosecond times and file identity are exact.
        mtimeNs: observed.mtimeNs.toString(),
        ctimeNs: observed.ctimeNs.toString(),
        dev: observed.dev.toString(),
        ino: observed.ino.toString(),
      })
      const { preview, truncated } = rendered
      let output = rendered.output

      output += InstructionPrompt.renderReminder(instructions)

      // Opportunistic warmup for later semantic navigation. Schedule it
      // after the read's last awaited work so current output is not held
      // behind best-effort LSP startup.
      warmSemanticLsp(filepath, ctx.abort)

      return {
        title,
        output,
        data: { kind: "text", text: output, truncated },
        metadata: {
          preview,
          truncated,
          ...(cacheKey ? { evidenceCache: cached ? "hit" : "miss" } : {}),
          loaded: instructions.map((i) => i.filepath),
        },
      }
    } catch (error) {
      log.error("read failed", {
        sessionID: ctx.sessionID,
        filePath: filepath,
        errorCode: error instanceof Error ? error.name : "Unknown",
        errorMessage: toErrorMessage(error),
      })
      throw error
    }
  },
})
