import z from "zod"
import * as path from "path"
import * as fs from "fs/promises"
import { LSP } from "@ax-code/ax-code-intel"
import { Tool } from "./tool"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Instance } from "../project/instance"
import { Patch } from "../patch"
import { diffPreview } from "./diff-preview"
import { assertExternalDirectory, assertSymlinkInsideProject } from "./external-directory"
import { trimDiff } from "./edit"
import { Isolation } from "@/isolation"
import { Filesystem } from "../util/filesystem"
import { FileTime } from "../file/time"
import DESCRIPTION from "./apply_patch.txt"
import { collectDiagnostics } from "./diagnostics"
import { appendPostEditDependentsNotice } from "./post-edit-dependents"
import { InstructionPrompt } from "@/session/instruction"
import { toErrorMessage, errorCode } from "@/util/error-message"
import { Log } from "../util/log"
import { BlastRadius } from "@/session/blast-radius"
import { normalizeToWorkspacePath, resolveToolFilePath } from "./file-path"

const log = Log.create({ service: "tool.apply_patch" })

/**
 * Whether two paths name the same file on disk. A case-only rename on a
 * case-insensitive filesystem (readme.md -> README.md) compares unequal as
 * strings while resolving to one inode; treating it as a move would write the
 * new content and then unlink that same inode.
 */
async function sameFile(a: string, b: string): Promise<boolean> {
  if (a === b) return true
  try {
    const [first, second] = await Promise.all([fs.stat(a), fs.stat(b)])
    return first.dev === second.dev && first.ino === second.ino
  } catch {
    return false
  }
}

/** Remove the move source after the destination was written, unless both are one file. */
async function finishMove(source: string, dest: string) {
  if (dest === source) return
  if (await sameFile(source, dest)) {
    // Case-only rename on a case-insensitive filesystem: the content is
    // already in place; only the directory entry's case needs to change. Let a
    // failure propagate so the tool cannot report success when the directory
    // entry was not actually renamed.
    await fs.rename(source, dest)
    return
  }
  await fs.unlink(source).catch((error: unknown) => {
    if (errorCode(error) !== "ENOENT") throw error
  })
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
  return fs.readFile(filePath, "utf-8").catch((err: NodeJS.ErrnoException) => {
    if (err?.code === "ENOENT") return undefined
    throw err
  })
}

async function fileMode(filePath: string): Promise<number | undefined> {
  return fs
    .stat(filePath)
    .then((stats) => stats.mode & 0o777)
    .catch(() => undefined)
}

/** Literal link target when `filePath` is a symlink; undefined for regular files. */
async function fileSymlink(filePath: string): Promise<string | undefined> {
  return fs
    .lstat(filePath)
    .then((stats) => (stats.isSymbolicLink() ? fs.readlink(filePath) : undefined))
    .catch(() => undefined)
}

const PatchParams = z.object({
  patchText: z
    .string()
    .max(5 * 1024 * 1024)
    .describe("The full patch text that describes all changes to be made"),
})

export const ApplyPatchTool = Tool.define("apply_patch", {
  description: DESCRIPTION,
  parameters: PatchParams,
  async execute(params, ctx) {
    if (!params.patchText) {
      throw new Error("patchText is required")
    }

    // Parse the patch to get hunks
    let hunks: Patch.Hunk[]
    try {
      const parseResult = Patch.parsePatch(params.patchText)
      hunks = parseResult.hunks
    } catch (error) {
      // Keep `{ cause }` as the full original for downstream handlers
      // while normalizing the user-facing verification message.
      const msg = toErrorMessage(error)
      throw new Error(`apply_patch verification failed: ${msg}`, { cause: error })
    }

    if (hunks.length === 0) {
      const normalized = params.patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
      if (normalized === "*** Begin Patch\n*** End Patch") {
        throw new Error("patch rejected: empty patch")
      }
      throw new Error("apply_patch verification failed: no hunks found")
    }

    // Validate file paths and check permissions
    const fileChanges: Array<{
      filePath: string
      oldContent: string
      newContent: string
      type: "add" | "update" | "delete" | "move"
      movePath?: string
      moveOldContent?: string
      existed: boolean
      moveExisted?: boolean
      /** Source/destination modes captured at verification for move/rollback. */
      sourceMode?: number
      moveMode?: number
      /** Delete rollback must recreate the link, not a regular file holding its target. */
      sourceLink?: string
      /** Source and destination resolve to the same file (case-only rename). */
      moveSameFile?: boolean
      diff: string
      additions: number
      deletions: number
    }> = []

    let totalDiff = ""

    const resolvePatchPath = (filePath: string) => resolveToolFilePath(filePath, Instance.directory)
    const seenPaths = new Set<string>()

    for (const hunk of hunks) {
      const filePath = resolvePatchPath(hunk.path)
      // Repeated operations derive from the same snapshot and cannot apply
      // cleanly in sequence. Reject them before prompting, matching
      // Patch.maybeParseApplyPatchVerified; chunks within one update stay valid.
      if (seenPaths.has(filePath)) {
        throw new Error(`apply_patch verification failed: Multiple operations target the same path: ${hunk.path}`)
      }
      seenPaths.add(filePath)
      const movePath = hunk.type === "update" && hunk.move_path ? resolvePatchPath(hunk.move_path) : undefined
      if (movePath && movePath !== filePath) {
        if (seenPaths.has(movePath)) {
          throw new Error(`apply_patch verification failed: Multiple operations target the same path: ${movePath}`)
        }
        seenPaths.add(movePath)
      }
      await assertExternalDirectory(ctx, filePath)
      await assertSymlinkInsideProject(filePath)
      Isolation.assertWrite(ctx.extra?.isolation, filePath, Instance.directory, Instance.worktree)
      const fileRelativePath = normalizeToWorkspacePath(filePath, Instance.worktree)
      BlastRadius.assertWritable(ctx.sessionID, fileRelativePath)
      if (movePath) {
        await assertExternalDirectory(ctx, movePath)
        await assertSymlinkInsideProject(movePath)
        Isolation.assertWrite(ctx.extra?.isolation, movePath, Instance.directory, Instance.worktree)
        const moveRelativePath = normalizeToWorkspacePath(movePath, Instance.worktree)
        BlastRadius.assertWritable(ctx.sessionID, moveRelativePath)
      }

      switch (hunk.type) {
        case "add": {
          let existed = false
          let oldContent = ""
          try {
            oldContent = await fs.readFile(filePath, "utf-8")
            existed = true
          } catch (error: unknown) {
            const code = Filesystem.errnoCode(error)
            if (code === "ENOENT") {
              existed = false
            } else if (code === "EISDIR") {
              throw new Error(`Path is a directory: ${filePath}`)
            } else if (code === "ENOTDIR") {
              throw new Error(`apply_patch verification failed: parent path is not a directory: ${filePath}`)
            } else {
              throw new Error(`apply_patch verification failed: Failed to read existing file: ${filePath}`)
            }
          }
          if (existed) {
            // Add File against an existing file overwrites it — enforce the
            // same must-read-before-write / modified-since-read protection
            // as the update and delete branches.
            await FileTime.assert(ctx.sessionID, filePath)
          }
          const newContent =
            hunk.contents.length === 0 || hunk.contents.endsWith("\n") ? hunk.contents : `${hunk.contents}\n`
          const preview = await diffPreview(filePath, oldContent, newContent, ctx.abort)
          const diff = trimDiff(preview.diff)
          const { additions, deletions } = preview

          fileChanges.push({
            filePath,
            oldContent,
            newContent,
            type: "add",
            existed,
            diff,
            additions,
            deletions,
          })

          totalDiff += diff + "\n"
          break
        }

        case "update": {
          await FileTime.assert(ctx.sessionID, filePath)
          let oldContent: string
          try {
            oldContent = await fs.readFile(filePath, "utf-8")
          } catch (error) {
            if (Filesystem.errnoCode(error) === "EISDIR") throw new Error(`Path is a directory: ${filePath}`)
            throw new Error(`apply_patch verification failed: Failed to read file to update: ${filePath}`)
          }
          const sourceMode = await fileMode(filePath)
          // A move unlinks the source and writes a regular file at the
          // destination, so rollback must know whether the source was a
          // symlink; writing its target's text would not restore the link.
          const sourceLink = hunk.move_path ? await fileSymlink(filePath) : undefined
          let newContent: string

          // Apply the update chunks to get new content
          try {
            newContent = await Patch.deriveContentFromChunksAsync(oldContent, filePath, hunk.chunks, ctx.abort)
          } catch (error) {
            ctx.abort.throwIfAborted()
            const msg = toErrorMessage(error)
            throw new Error(`apply_patch verification failed: ${msg}`, { cause: error })
          }

          const preview = await diffPreview(filePath, oldContent, newContent, ctx.abort)
          const diff = trimDiff(preview.diff)
          const { additions, deletions } = preview

          const movePath = hunk.move_path ? resolvePatchPath(hunk.move_path) : undefined
          await assertExternalDirectory(ctx, movePath)
          if (movePath) await assertSymlinkInsideProject(movePath)
          let moveMode: number | undefined
          const moveExisted = movePath
            ? await fs
                .stat(movePath)
                .then((stats) => {
                  if (stats.isDirectory()) throw new Error(`Path is a directory: ${movePath}`)
                  moveMode = stats.mode & 0o777
                  return true
                })
                .catch((error: unknown) => {
                  const code = Filesystem.errnoCode(error)
                  if (code === "ENOENT") return false
                  if (code === "ENOTDIR") {
                    throw new Error(`apply_patch verification failed: parent path is not a directory: ${movePath}`)
                  }
                  throw error
                })
            : undefined
          let moveOldContent: string | undefined
          const moveSameFile = moveExisted ? await sameFile(filePath, movePath!) : false
          // Overwriting an existing destination discards its content, so the
          // destination needs the same must-read-before-write protection as
          // the source. A case-only rename names one inode twice, so it has no
          // separate destination to protect.
          if (moveExisted && !moveSameFile) await FileTime.assert(ctx.sessionID, movePath!)
          if (moveExisted) {
            try {
              moveOldContent = await fs.readFile(movePath!, "utf-8")
            } catch {
              throw new Error(`apply_patch verification failed: Failed to read move destination: ${movePath!}`)
            }
          }
          if (movePath) Isolation.assertWrite(ctx.extra?.isolation, movePath, Instance.directory, Instance.worktree)
          if (movePath) {
            const moveRelativePath = normalizeToWorkspacePath(movePath, Instance.worktree)
            BlastRadius.assertWritable(ctx.sessionID, moveRelativePath)
          }

          fileChanges.push({
            filePath,
            oldContent,
            newContent,
            type: hunk.move_path ? "move" : "update",
            movePath,
            moveOldContent,
            existed: true,
            moveExisted,
            moveSameFile,
            sourceMode,
            sourceLink,
            moveMode,
            diff,
            additions,
            deletions,
          })

          totalDiff += diff + "\n"
          break
        }

        case "delete": {
          await FileTime.assert(ctx.sessionID, filePath)
          // Match the update branch: reject directories explicitly so
          // a delete against a directory fails with a clear error
          // instead of a raw EISDIR from readFile/unlink.
          const contentToDelete = await fs.readFile(filePath, "utf-8").catch((error) => {
            if (Filesystem.errnoCode(error) === "EISDIR") {
              throw new Error(`apply_patch: cannot delete a directory: ${filePath}`)
            }
            const msg = toErrorMessage(error)
            throw new Error(`apply_patch verification failed: ${msg}`, { cause: error })
          })
          const deleteDiff = trimDiff((await diffPreview(filePath, contentToDelete, "", ctx.abort)).diff)
          const sourceMode = await fileMode(filePath)
          const sourceLink = await fileSymlink(filePath)

          // Count actual lines, not `split("\n").length`. For content
          // "hello\nworld\n", split yields ["hello", "world", ""]
          // (length 3), but the file has 2 lines. Empty file → 0
          // deletions. Content without trailing newline → split length
          // equals line count, which is also what we want.
          const deletions =
            contentToDelete.length === 0
              ? 0
              : contentToDelete.endsWith("\n")
                ? contentToDelete.split("\n").length - 1
                : contentToDelete.split("\n").length

          fileChanges.push({
            filePath,
            oldContent: contentToDelete,
            newContent: "",
            type: "delete",
            existed: true,
            sourceMode,
            sourceLink,
            diff: deleteDiff,
            additions: 0,
            deletions,
          })

          totalDiff += deleteDiff + "\n"
          break
        }
      }
    }

    // Build per-file metadata for UI rendering (used for both permission and result)
    const files = fileChanges.map((change) => ({
      filePath: change.filePath,
      relativePath: normalizeToWorkspacePath(change.movePath ?? change.filePath, Instance.worktree),
      type: change.type,
      diff: change.diff,
      before: change.oldContent,
      after: change.newContent,
      additions: change.additions,
      deletions: change.deletions,
      movePath: change.movePath,
    }))

    // Check permissions if needed
    // A move writes its destination as well as its source: both paths must
    // pass the edit permission rules, not only isolation and blast radius.
    const relativePaths = [
      ...new Set(
        fileChanges.flatMap((c) =>
          [c.filePath, ...(c.movePath ? [c.movePath] : [])].map((p) => normalizeToWorkspacePath(p, Instance.worktree)),
        ),
      ),
    ]
    ctx.abort.throwIfAborted()
    await ctx.ask({
      permission: "edit",
      patterns: relativePaths,
      always: ["*"],
      metadata: {
        filepath: relativePaths.join(", "),
        diff: totalDiff,
        files,
      },
    })

    // Apply the changes
    const updates: Array<{ file: string; event: "add" | "change" | "unlink" }> = []
    const appliedChanges: typeof fileChanges = []
    const editedFiles = new Set<string>()
    let activeChange: (typeof fileChanges)[number] | undefined
    let activeDirty = false
    // Rollback errors used to be `.catch()`d and silently logged, leaving
    // the user with an opaque "patch failed" message and a partially-
    // rolled-back filesystem. Collect them here so the outer catch can
    // surface them in the thrown error (BUG-107).
    const rollbackErrors: Array<{ file: string; error: unknown }> = []

    const rollback = async (changes: typeof fileChanges) => {
      for (const change of [...changes].reverse()) {
        const target = change.type === "move" ? (change.movePath ?? change.filePath) : change.filePath
        try {
          if (change.type === "move" && change.movePath) {
            const dest = change.movePath
            const [first, second] = [change.filePath, dest].sort()
            const restoreMove = async () => {
              // Re-check both endpoints inside the lock; a symlink swapped in
              // after the failure must not redirect the rollback outside the
              // project.
              await assertSymlinkInsideProject(change.filePath)
              await assertSymlinkInsideProject(dest)
              // A case-only rename names one inode twice, so there is no
              // second path to reconcile — but the shared file can still be
              // edited externally after the move landed. Refuse to overwrite
              // that edit, then restore the original entry spelling.
              if (change.moveSameFile) {
                const current = await readFileIfExists(change.filePath)
                if (current !== undefined && current !== change.oldContent && current !== change.newContent)
                  throw new Error(`Cannot roll back apply_patch: ${change.filePath} was modified externally`)
                await fs.mkdir(path.dirname(change.filePath), { recursive: true })
                await Filesystem.write(change.filePath, change.oldContent, change.sourceMode, { followSymlink: true })
                if (change.moveExisted) {
                  // Writing content does not undo the case-only rename.
                  if (current !== undefined) await fs.rename(dest, change.filePath)
                  return
                }
                await fs.unlink(dest).catch(() => undefined)
                return
              }
              const sourceCurrent = await readFileIfExists(change.filePath)
              const destCurrent = await readFileIfExists(dest)
              if (sourceCurrent !== undefined && sourceCurrent !== change.oldContent)
                throw new Error(`Cannot roll back apply_patch: ${change.filePath} was modified externally`)
              const destStates = change.moveExisted
                ? [change.newContent, change.moveOldContent ?? ""]
                : [change.newContent]
              if (destCurrent !== undefined && !destStates.includes(destCurrent))
                throw new Error(`Cannot roll back apply_patch: ${dest} was modified externally`)

              if (sourceCurrent === undefined) {
                await fs.mkdir(path.dirname(change.filePath), { recursive: true })
                // A moved symlink must come back as a link; writing the old
                // target text would materialize a regular file.
                if (change.sourceLink !== undefined) await fs.symlink(change.sourceLink, change.filePath)
                else
                  await Filesystem.write(change.filePath, change.oldContent, change.sourceMode, { followSymlink: true })
              }
              if (change.moveExisted) {
                // moveOldContent means the move never landed; newContent means
                // it did and the pre-move destination must come back.
                if (destCurrent === change.newContent) {
                  await fs.mkdir(path.dirname(dest), { recursive: true })
                  await Filesystem.write(dest, change.moveOldContent ?? "", change.moveMode, { followSymlink: true })
                }
              } else if (destCurrent === change.newContent) {
                await fs.unlink(dest).catch(() => undefined)
              }
            }
            if (first === second) await FileTime.withLock(first, restoreMove)
            else await FileTime.withLock(first, () => FileTime.withLock(second, restoreMove))
            continue
          }
          await FileTime.withLock(change.filePath, async () => {
            // A symlink swapped in after the failure must not redirect the
            // rollback outside the project. Refuse and report the partial rollback.
            await assertSymlinkInsideProject(change.filePath)
            const current = await readFileIfExists(change.filePath)
            if (!change.existed && change.type === "add") {
              if (current === undefined) return
              if (current !== change.newContent)
                throw new Error(`Cannot roll back apply_patch: ${change.filePath} was modified externally`)
              await fs.unlink(change.filePath)
              return
            }
            if (change.type === "delete") {
              if (current === undefined) {
                await fs.mkdir(path.dirname(change.filePath), { recursive: true })
                // A deleted symlink must come back as a link; writing its
                // target's text would replace the link with a regular file.
                if (change.sourceLink !== undefined) await fs.symlink(change.sourceLink, change.filePath)
                else
                  await Filesystem.write(change.filePath, change.oldContent, change.sourceMode, {
                    followSymlink: true,
                  })
                return
              }
              if (current === change.oldContent) return
              throw new Error(`Cannot roll back apply_patch: ${change.filePath} was recreated after the delete`)
            }
            // The change may fail before its write (current === oldContent) or
            // after it (current === newContent). Anything else is an external
            // edit that rollback must not overwrite.
            if (current === change.oldContent) return
            if (current !== change.newContent)
              throw new Error(`Cannot roll back apply_patch: ${change.filePath} was modified externally`)
            await fs.mkdir(path.dirname(change.filePath), { recursive: true })
            await Filesystem.write(change.filePath, change.oldContent, change.sourceMode, { followSymlink: true })
          })
          if (change.type === "delete") {
            await FileTime.read(ctx.sessionID, change.filePath)
          }
        } catch (err) {
          rollbackErrors.push({ file: target, error: err })
          log.warn("apply_patch rollback failed for file", { file: target, error: err })
        }
      }
    }

    try {
      for (const change of fileChanges) {
        if (ctx.abort.aborted) throw new DOMException("Patch application aborted", "AbortError")
        activeChange = change
        activeDirty = false
        const edited = change.movePath ?? change.filePath
        switch (change.type) {
          case "add":
            await FileTime.withLock(change.filePath, async () => {
              await assertSymlinkInsideProject(change.filePath)

              const current = await readFileIfExists(change.filePath)
              if (!change.existed && current !== undefined) {
                throw new Error(`apply_patch conflict: ${change.filePath} was created between verification and write`)
              }
              if (change.existed && current !== change.oldContent) {
                throw new Error(`apply_patch conflict: ${change.filePath} was modified between verification and write`)
              }
              // Create parents only after the containment re-check: a symlinked
              // parent swapped during approval must not be followed outside.
              await fs.mkdir(path.dirname(change.filePath), { recursive: true })
              activeDirty = true
              await Filesystem.write(change.filePath, change.newContent, undefined, { followSymlink: true })
            })
            await FileTime.read(ctx.sessionID, change.filePath)
            updates.push({ file: change.filePath, event: change.existed ? "change" : "add" })
            break

          case "update":
            await FileTime.withLock(change.filePath, async () => {
              await assertSymlinkInsideProject(change.filePath)

              const current = await readFileIfExists(change.filePath)
              // Match the move/delete branches: an update target must still
              // exist with the verified content. A file deleted between
              // verification and write is a conflict, not something to
              // silently recreate.
              if (current !== change.oldContent)
                throw new Error(`apply_patch conflict: ${change.filePath} was modified between verification and write`)
              activeDirty = true
              await Filesystem.write(change.filePath, change.newContent, undefined, { followSymlink: true })
            })
            await FileTime.read(ctx.sessionID, change.filePath)
            updates.push({ file: change.filePath, event: "change" })
            break

          case "move":
            if (change.movePath) {
              const dest = change.movePath
              const [first, second] = [change.filePath, dest].sort()
              if (first === second) {
                await FileTime.withLock(first, async () => {
                  await assertSymlinkInsideProject(change.filePath)
                  await assertSymlinkInsideProject(dest)

                  const current = await readFileIfExists(change.filePath)
                  if (current !== change.oldContent) {
                    throw new Error(
                      `apply_patch conflict: ${change.filePath} was modified between verification and write`,
                    )
                  }
                  activeDirty = true
                  await Filesystem.write(dest, change.newContent, change.sourceMode, { followSymlink: true })
                  await finishMove(change.filePath, dest)
                })
              } else {
                await FileTime.withLock(first, async () => {
                  await FileTime.withLock(second, async () => {
                    await assertSymlinkInsideProject(change.filePath)
                    await assertSymlinkInsideProject(dest)
                    await fs.mkdir(path.dirname(dest), { recursive: true })

                    const currentSource = await readFileIfExists(change.filePath)
                    if (currentSource !== change.oldContent) {
                      throw new Error(
                        `apply_patch conflict: ${change.filePath} was modified between verification and write`,
                      )
                    }
                    const currentDest = await readFileIfExists(dest)
                    if (!change.moveExisted && currentDest !== undefined) {
                      throw new Error(`apply_patch conflict: ${dest} was created between verification and write`)
                    }
                    if (change.moveExisted && currentDest !== change.moveOldContent) {
                      throw new Error(`apply_patch conflict: ${dest} was modified between verification and write`)
                    }
                    activeDirty = true
                    await Filesystem.write(dest, change.newContent, change.sourceMode, { followSymlink: true })
                    await finishMove(change.filePath, dest)
                  })
                })
              }
              await FileTime.read(ctx.sessionID, dest)
              updates.push({ file: change.filePath, event: "unlink" })
              updates.push({ file: dest, event: "add" })
            }
            break

          case "delete":
            await FileTime.withLock(change.filePath, async () => {
              await assertSymlinkInsideProject(change.filePath)

              const current = await readFileIfExists(change.filePath)
              if (current !== change.oldContent) {
                throw new Error(`apply_patch conflict: ${change.filePath} was modified between verification and delete`)
              }

              activeDirty = true
              await fs.unlink(change.filePath).catch((error: unknown) => {
                if (errorCode(error) !== "ENOENT") throw error
              })
              await FileTime.read(ctx.sessionID, change.filePath)
            })
            updates.push({ file: change.filePath, event: "unlink" })
            break
        }

        appliedChanges.push(change)
        activeChange = undefined
        activeDirty = false
        if (edited) {
          editedFiles.add(edited)
        }
      }
    } catch (error) {
      const rollbackChanges = activeChange && activeDirty ? [...appliedChanges, activeChange] : appliedChanges
      await rollback(rollbackChanges)
      if (rollbackErrors.length > 0) {
        // Surface partial-rollback to the user instead of silently logging.
        // The original error is still the proximate cause, but rollback
        // failures mean the filesystem is in an inconsistent state that
        // the caller needs to know about (BUG-107).
        const files = rollbackErrors.map((e) => e.file).join(", ")
        const wrapped = new Error(
          `apply_patch failed and rollback was incomplete for: ${files}. Original error: ${toErrorMessage(error)}`,
          { cause: error },
        )
        throw wrapped
      }
      throw error
    }

    // Retire deleted/renamed-away server documents only after the transaction
    // succeeds. Diagnostics must not retain buffers for files that no longer exist.
    let cleanupIncomplete = false
    const closeDeadline = Date.now() + 2000
    for (const update of updates) {
      if (update.event !== "unlink") continue
      try {
        // A later operation in the patch may recreate a removed source path.
        if (
          await fs
            .lstat(update.file)
            .then(() => true)
            .catch((error: unknown) => {
              if (errorCode(error) === "ENOENT") return false
              throw error
            })
        )
          continue
        if (Date.now() >= closeDeadline) {
          cleanupIncomplete = true
          break
        }
        await LSP.closeFile(update.file, true, closeDeadline)
      } catch (error) {
        cleanupIncomplete = true
        log.warn("failed to close removed LSP document", { file: update.file, error })
      }
    }

    for (const file of editedFiles) {
      await Bus.publish(File.Event.Edited, { file })
    }

    // Publish file change events
    for (const update of updates) {
      await Bus.publish(FileWatcher.Event.Updated, update)
    }

    // Autonomous accounting: only the changes we successfully applied count.
    // A move onto an existing destination also discards that destination's
    // content, which the source-side diff never sees; charge those lines too.
    for (const change of appliedChanges) {
      const target = change.movePath ?? change.filePath
      // Same line count rule as the delete branch: a trailing newline does not
      // start another line.
      const overwritten =
        change.moveExisted &&
        !change.moveSameFile &&
        typeof change.moveOldContent === "string" &&
        change.moveOldContent.length > 0
          ? change.moveOldContent.split("\n").length - (change.moveOldContent.endsWith("\n") ? 1 : 0)
          : 0
      await BlastRadius.recordWriteAndAssert(
        ctx.sessionID,
        target,
        (change.additions ?? 0) + (change.deletions ?? 0) + overwritten,
      )
    }

    // Generate output summary
    const summaryLines = fileChanges.map((change) => {
      if (change.type === "add") {
        return `A ${normalizeToWorkspacePath(change.filePath, Instance.worktree)}`
      }
      if (change.type === "delete") {
        return `D ${normalizeToWorkspacePath(change.filePath, Instance.worktree)}`
      }
      const target = change.movePath ?? change.filePath
      return `M ${normalizeToWorkspacePath(target, Instance.worktree)}`
    })

    const changedFiles = fileChanges.filter((c) => c.type !== "delete").map((c) => c.movePath ?? c.filePath)
    const { diagnostics, output: diagOutput } = await collectDiagnostics(changedFiles)
    let output = `Success. Updated the following files:\n${summaryLines.join("\n")}` + diagOutput
    if (cleanupIncomplete)
      output +=
        "\n\nLSP document cleanup was incomplete. File changes were saved; run a full project type check to verify diagnostics."
    output = await appendPostEditDependentsNotice(output, ctx, changedFiles)
    // Nested AGENTS.md and path-scoped rules (ADR-219) discovered for the
    // changed files; per-message claims dedupe a rule matched by several
    // files in one patch.
    const instructions: { filepath: string; content: string }[] = []
    for (const file of changedFiles) {
      instructions.push(...(await InstructionPrompt.resolve(ctx.messages, file, ctx.messageID)))
    }
    output += InstructionPrompt.renderReminder(instructions)

    return {
      title: output,
      metadata: {
        diff: totalDiff,
        files,
        diagnostics,
        loaded: instructions.map((i) => i.filepath),
      },
      output,
    }
  },
})
