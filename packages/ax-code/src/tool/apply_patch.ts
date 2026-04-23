import z from "zod"
import * as path from "path"
import * as fs from "fs/promises"
import { Tool } from "./tool"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Instance } from "../project/instance"
import { Patch } from "../patch"
import { createTwoFilesPatch, diffLines } from "diff"
import { assertExternalDirectory } from "./external-directory"
import { trimDiff } from "./edit"
import { Isolation } from "@/isolation"
import { Filesystem } from "../util/filesystem"
import { FileTime } from "../file/time"
import DESCRIPTION from "./apply_patch.txt"
import { collectDiagnostics } from "./diagnostics"

const PatchParams = z.object({
  patchText: z.string().describe("The full patch text that describes all changes to be made"),
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
      // `${error}` on an Error produces "Error: <msg>" (ugly prefix)
      // and on a non-Error plain object produces "[object Object]".
      // Extract .message for Error instances, String() everything
      // else. `{ cause }` still carries the full original for
      // downstream handlers that inspect it.
      const msg = error instanceof Error ? error.message : String(error)
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
      diff: string
      additions: number
      deletions: number
    }> = []

    let totalDiff = ""

    for (const hunk of hunks) {
      const filePath = path.resolve(Instance.directory, hunk.path)
      await assertExternalDirectory(ctx, filePath)
      // Resolve symlinks and re-check containment so a symlink inside
      // the project pointing to e.g. `~/.ssh/authorized_keys` cannot
      // be patched through the symlink. Only enforce when the target
      // was inside the project; external patches go through the
      // external-directory permission flow.
      // BUG-293 DEFERRED: The symlink check and subsequent file write
      // are not atomic (TOCTOU). A true atomic fix requires OS-level
      // primitives (e.g. O_NOFOLLOW + openat). The existing check is
      // defense-in-depth and sufficient for the threat model.
      if (Filesystem.contains(Instance.directory, filePath)) {
        const realFilePath = await fs.realpath(filePath).catch(() => null)
        if (realFilePath && !Filesystem.contains(Instance.directory, realFilePath)) {
          throw new Error("Access denied: symlink target escapes project directory")
        }
      }
      Isolation.assertWrite(ctx.extra?.isolation, filePath, Instance.directory, Instance.worktree)

      switch (hunk.type) {
        case "add": {
          const existed = await fs.stat(filePath).then((stats) => !stats.isDirectory()).catch(() => false)
          const oldContent = existed ? await fs.readFile(filePath, "utf-8").catch(() => "") : ""
          const newContent =
            hunk.contents.length === 0 || hunk.contents.endsWith("\n") ? hunk.contents : `${hunk.contents}\n`
          const diff = trimDiff(createTwoFilesPatch(filePath, filePath, oldContent, newContent))

          let additions = 0
          let deletions = 0
          for (const change of diffLines(oldContent, newContent)) {
            if (change.added) additions += change.count || 0
            if (change.removed) deletions += change.count || 0
          }

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
            const stats = await fs.stat(filePath)
            if (stats.isDirectory()) throw new Error("is directory")
            oldContent = await fs.readFile(filePath, "utf-8")
          } catch {
            throw new Error(`apply_patch verification failed: Failed to read file to update: ${filePath}`)
          }
          let newContent = oldContent

          // Apply the update chunks to get new content
          try {
            const fileUpdate = Patch.deriveNewContentsFromChunks(filePath, hunk.chunks)
            newContent = fileUpdate.content
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            throw new Error(`apply_patch verification failed: ${msg}`, { cause: error })
          }

          const diff = trimDiff(createTwoFilesPatch(filePath, filePath, oldContent, newContent))

          let additions = 0
          let deletions = 0
          for (const change of diffLines(oldContent, newContent)) {
            if (change.added) additions += change.count || 0
            if (change.removed) deletions += change.count || 0
          }

          const movePath = hunk.move_path ? path.resolve(Instance.directory, hunk.move_path) : undefined
          await assertExternalDirectory(ctx, movePath)
          const moveExisted = movePath ? await fs.stat(movePath).then((stats) => !stats.isDirectory()).catch(() => false) : undefined
          const moveOldContent = moveExisted ? await fs.readFile(movePath!, "utf-8").catch(() => "") : undefined
          if (movePath && Filesystem.contains(Instance.directory, movePath)) {
            const moveStat = await fs.lstat(movePath).catch(() => null)
            if (moveStat?.isSymbolicLink()) {
              const realMove = await fs.realpath(movePath).catch(() => null)
              if (!realMove || !Filesystem.contains(Instance.directory, realMove)) {
                throw new Error("Access denied: move_path symlink target escapes project directory")
              }
            }
            const parentDir = path.dirname(movePath)
            const realParent = await fs.realpath(parentDir).catch(() => parentDir)
            if (!Filesystem.contains(Instance.directory, realParent)) {
              throw new Error("Access denied: move_path parent directory escapes project directory")
            }
          }
          if (movePath) Isolation.assertWrite(ctx.extra?.isolation, movePath, Instance.directory, Instance.worktree)

          fileChanges.push({
            filePath,
            oldContent,
            newContent,
            type: hunk.move_path ? "move" : "update",
            movePath,
            moveOldContent,
            existed: true,
            moveExisted,
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
          const deleteStats = await fs.stat(filePath).catch(() => null)
          if (deleteStats?.isDirectory()) {
            throw new Error(`apply_patch: cannot delete a directory: ${filePath}`)
          }
          const contentToDelete = await fs.readFile(filePath, "utf-8").catch((error) => {
            const msg = error instanceof Error ? error.message : String(error)
            throw new Error(`apply_patch verification failed: ${msg}`, { cause: error })
          })
          const deleteDiff = trimDiff(createTwoFilesPatch(filePath, filePath, contentToDelete, ""))

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
      relativePath: path.relative(Instance.worktree, change.movePath ?? change.filePath).replaceAll("\\", "/"),
      type: change.type,
      diff: change.diff,
      before: change.oldContent,
      after: change.newContent,
      additions: change.additions,
      deletions: change.deletions,
      movePath: change.movePath,
    }))

    // Check permissions if needed
    const relativePaths = fileChanges.map((c) => path.relative(Instance.worktree, c.filePath).replaceAll("\\", "/"))
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
    let activeChange: (typeof fileChanges)[number] | undefined
    let activeDirty = false
    const rollback = async (changes: typeof fileChanges) => {
      for (const change of [...changes].reverse()) {
        if (change.type === "move" && change.movePath) {
          const dest = change.movePath
          const [first, second] = [change.filePath, dest].sort()
          await FileTime.withLock(first, async () => {
            await FileTime.withLock(second, async () => {
              await fs.mkdir(path.dirname(change.filePath), { recursive: true })
              await fs.writeFile(change.filePath, change.oldContent, "utf-8")
              if (change.moveExisted) {
                await fs.mkdir(path.dirname(dest), { recursive: true })
                await fs.writeFile(dest, change.moveOldContent ?? "", "utf-8")
                return
              }
              await fs.unlink(dest).catch(() => undefined)
            })
          })
          continue
        }
        await FileTime.withLock(change.filePath, async () => {
          if (!change.existed && change.type === "add") {
            await fs.unlink(change.filePath).catch(() => undefined)
            return
          }
          await fs.mkdir(path.dirname(change.filePath), { recursive: true })
          await fs.writeFile(change.filePath, change.oldContent, "utf-8")
        }).catch((err) => {
          log.warn("apply_patch rollback failed for file", { file: change.filePath, error: err })
        })
      }
    }

    try {
      for (const change of fileChanges) {
        activeChange = change
        activeDirty = false
        const edited = change.type === "delete" ? undefined : (change.movePath ?? change.filePath)
        switch (change.type) {
          case "add":
            await fs.mkdir(path.dirname(change.filePath), { recursive: true })
            await FileTime.withLock(change.filePath, async () => {
              const current = await fs.readFile(change.filePath, "utf-8").catch(() => undefined)
              if (!change.existed && current !== undefined) {
                throw new Error(`apply_patch conflict: ${change.filePath} was created between verification and write`)
              }
              if (change.existed && current !== change.oldContent) {
                throw new Error(`apply_patch conflict: ${change.filePath} was modified between verification and write`)
              }
              activeDirty = true
              await Filesystem.write(change.filePath, change.newContent)
            })
            await FileTime.read(ctx.sessionID, change.filePath)
            updates.push({ file: change.filePath, event: change.existed ? "change" : "add" })
            break

          case "update":
            await FileTime.withLock(change.filePath, async () => {
              const current = await fs.readFile(change.filePath, "utf-8").catch(() => undefined)
              if (current !== undefined && current !== change.oldContent)
                throw new Error(`apply_patch conflict: ${change.filePath} was modified between verification and write`)
              activeDirty = true
              await Filesystem.write(change.filePath, change.newContent)
            })
            await FileTime.read(ctx.sessionID, change.filePath)
            updates.push({ file: change.filePath, event: "change" })
            break

          case "move":
            if (change.movePath) {
              const dest = change.movePath
              await fs.mkdir(path.dirname(dest), { recursive: true })
              const [first, second] = [change.filePath, dest].sort()
              if (first === second) {
                await FileTime.withLock(first, async () => {
                  const current = await fs.readFile(change.filePath, "utf-8").catch(() => undefined)
                  if (current !== change.oldContent) {
                    throw new Error(`apply_patch conflict: ${change.filePath} was modified between verification and write`)
                  }
                  activeDirty = true
                  await Filesystem.write(dest, change.newContent)
                  if (dest !== change.filePath) await fs.unlink(change.filePath)
                })
              } else {
                await FileTime.withLock(first, async () => {
                  await FileTime.withLock(second, async () => {
                    const currentSource = await fs.readFile(change.filePath, "utf-8").catch(() => undefined)
                    if (currentSource !== change.oldContent) {
                      throw new Error(
                        `apply_patch conflict: ${change.filePath} was modified between verification and write`,
                      )
                    }
                    const currentDest = await fs.readFile(dest, "utf-8").catch(() => undefined)
                    if (!change.moveExisted && currentDest !== undefined) {
                      throw new Error(`apply_patch conflict: ${dest} was created between verification and write`)
                    }
                    if (change.moveExisted && currentDest !== change.moveOldContent) {
                      throw new Error(`apply_patch conflict: ${dest} was modified between verification and write`)
                    }
                    activeDirty = true
                    await Filesystem.write(dest, change.newContent)
                    if (dest !== change.filePath) await fs.unlink(change.filePath)
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
              activeDirty = true
              await fs.unlink(change.filePath)
            })
            updates.push({ file: change.filePath, event: "unlink" })
            break
        }

        appliedChanges.push(change)
        activeChange = undefined
        activeDirty = false
        if (edited) {
          await Bus.publish(File.Event.Edited, {
            file: edited,
          })
        }
      }
    } catch (error) {
      const rollbackChanges = activeChange && activeDirty ? [...appliedChanges, activeChange] : appliedChanges
      await rollback(rollbackChanges)
      throw error
    }

    // Publish file change events
    for (const update of updates) {
      await Bus.publish(FileWatcher.Event.Updated, update)
    }

    // Generate output summary
    const summaryLines = fileChanges.map((change) => {
      if (change.type === "add") {
        return `A ${path.relative(Instance.worktree, change.filePath).replaceAll("\\", "/")}`
      }
      if (change.type === "delete") {
        return `D ${path.relative(Instance.worktree, change.filePath).replaceAll("\\", "/")}`
      }
      const target = change.movePath ?? change.filePath
      return `M ${path.relative(Instance.worktree, target).replaceAll("\\", "/")}`
    })

    const changedFiles = fileChanges
      .filter((c) => c.type !== "delete")
      .map((c) => c.movePath ?? c.filePath)
    const { diagnostics, output: diagOutput } = await collectDiagnostics(changedFiles)
    let output = `Success. Updated the following files:\n${summaryLines.join("\n")}` + diagOutput

    return {
      title: output,
      metadata: {
        diff: totalDiff,
        files,
        diagnostics,
      },
      output,
    }
  },
})
