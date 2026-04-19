import { createTwoFilesPatch, diffLines } from "diff"
import path from "path"
import fs from "fs"
import z from "zod"
import { FileTime } from "../file/time"
import { Instance } from "../project/instance"
import { Snapshot } from "@/snapshot"
import { Filesystem } from "../util/filesystem"
import { Tool } from "./tool"
import { assertExternalDirectory } from "./external-directory"
import { notifyFileEdited, collectDiagnostics } from "./diagnostics"
import { replace, trimDiff } from "./edit"
import { Isolation } from "@/isolation"
import DESCRIPTION from "./multiedit.txt"
import { Log } from "@/util/log"

const log = Log.create({ service: "multiedit-tool" })

export const MultiEditTool = Tool.define("multiedit", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    edits: z
      .array(
        z.object({
          filePath: z.string().describe("The absolute path to the file to modify"),
          oldString: z.string().describe("The text to replace"),
          newString: z.string().describe("The text to replace it with (must be different from oldString)"),
          replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
        }),
      )
      .min(1)
      .describe("Array of edit operations to perform sequentially on the file"),
  }),
  async execute(params, ctx) {
    const files = Array.from(new Set(params.edits.map((edit) => path.resolve(edit.filePath ?? params.filePath)))).sort()
    const original = new Map<string, string>()
    const current = new Map<string, string>()
    const results: Array<{
      output: string
      metadata: {
        diff: string
        filediff: Snapshot.FileDiff
      }
    }> = []

    for (const file of files) {
      await assertExternalDirectory(ctx, file)
      if (Filesystem.contains(Instance.directory, file)) {
        const realFile = await fs.promises.realpath(file).catch(() => null)
        if (realFile && !Filesystem.contains(Instance.directory, realFile)) {
          throw new Error("Access denied: symlink target escapes project directory")
        }
      }
      Isolation.assertWrite(ctx.extra?.isolation, file, Instance.directory, Instance.worktree)
    }

    const lock = async <T>(idx: number, fn: () => Promise<T>): Promise<T> => {
      const file = files[idx]
      if (!file) return fn()
      return FileTime.withLock(file, async () => lock(idx + 1, fn))
    }

    await lock(0, async () => {
      for (const file of files) {
        await FileTime.assert(ctx.sessionID, file)
        const text = await Filesystem.readText(file)
        original.set(file, text)
        current.set(file, text)
      }

      try {
        for (const edit of params.edits) {
          const file = path.resolve(edit.filePath ?? params.filePath)
          if (edit.oldString === edit.newString) {
            throw new Error("No changes to apply: oldString and newString are identical.")
          }
          const before = current.get(file)
          if (before === undefined) {
            throw new Error(`File ${file} not found`)
          }
          const after = replace(before, edit.oldString, edit.newString, edit.replaceAll)
          const diff = trimDiff(
            createTwoFilesPatch(file, file, before.replaceAll("\r\n", "\n"), after.replaceAll("\r\n", "\n")),
          )
          await ctx.ask({
            permission: "edit",
            patterns: [path.relative(Instance.worktree, file)],
            always: ["*"],
            metadata: {
              filepath: file,
              diff,
            },
          })
          current.set(file, after)

          const filediff: Snapshot.FileDiff = {
            file,
            before,
            after,
            additions: 0,
            deletions: 0,
          }
          for (const change of diffLines(before, after)) {
            if (change.added) filediff.additions += change.count || 0
            if (change.removed) filediff.deletions += change.count || 0
          }

          results.push({
            output: "Edit applied successfully.",
            metadata: {
              diff,
              filediff,
            },
          })
        }

        for (const file of files) {
          const next = current.get(file)
          const prev = original.get(file)
          if (next === undefined || prev === undefined || next === prev) continue
          await Filesystem.write(file, next)
          await notifyFileEdited(file, "change")
          await FileTime.read(ctx.sessionID, file)
        }
      } catch (error) {
        const rollbackErrors: { file: string; error: unknown }[] = []
        await Promise.all(
          files.map((file) => {
            const text = original.get(file)
            if (text === undefined) return Promise.resolve()
            return Filesystem.write(file, text).catch((rollbackError) => {
              rollbackErrors.push({ file, error: rollbackError })
              log.error("failed to roll back multiedit file", { file, error: rollbackError })
            })
          }),
        )
        if (rollbackErrors.length > 0) {
          const message = rollbackErrors.map((item) => item.file).join(", ")
          throw new Error(`Multiedit failed and rollback also failed for: ${message}`, { cause: error })
        }
        throw error
      }
    })

    const changed = files.filter((file) => current.get(file) !== original.get(file))
    const { diagnostics } = await collectDiagnostics(changed)

    return {
      title: path.relative(Instance.worktree, params.filePath),
      metadata: {
        diagnostics,
        results: results.map((r) => r.metadata),
      },
      output: results.at(-1)?.output ?? "",
    }
  },
})
