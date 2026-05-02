import z from "zod"
import * as path from "path"
import * as fs from "fs"
import { Tool } from "./tool"
import { createTwoFilesPatch, diffLines } from "diff"
import DESCRIPTION from "./write.txt"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { trimDiff } from "./edit"
import { assertExternalDirectory, assertSymlinkInsideProject } from "./external-directory"
import { notifyFileEdited, collectDiagnostics } from "./diagnostics"
import { Isolation } from "@/isolation"
import { BlastRadius } from "@/session/blast-radius"

export const WriteTool = Tool.define("write", {
  description: DESCRIPTION,
  parameters: z.object({
    content: z.string().describe("The content to write to the file"),
    filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
  }),
  async execute(params, ctx) {
    if (params.filePath.includes("\x00")) {
      throw new Error("File path contains null byte")
    }

    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    const bytes = Buffer.byteLength(params.content, "utf-8")
    if (bytes > 5 * 1024 * 1024) throw new Error(`Write content too large: ${bytes} bytes (max 5MB)`)
    await assertExternalDirectory(ctx, filepath)
    Isolation.assertWrite(ctx.extra?.isolation, filepath, Instance.directory, Instance.worktree)
    BlastRadius.assertWritable(ctx.sessionID, path.relative(Instance.worktree, filepath))

    // Read + assert + diff computation must all happen inside the lock,
    // otherwise a concurrent tool call or external process modifying
    // the file between `Filesystem.readText` and `Filesystem.write`
    // would make the diff shown to the user stale — they'd approve
    // one change and see a different one applied. `edit.ts` already
    // does all of this inside its lock; `write.ts` was inconsistent.
    let exists = false
    await FileTime.withLock(filepath, async () => {
      // Keep the symlink and directory validation inside the same lock as
      // the read/permission/write flow so the checked path cannot be
      // swapped between validation and write.
      await assertSymlinkInsideProject(filepath)

      const stats = await fs.promises.stat(filepath).catch(() => null)
      if (stats?.isDirectory()) throw new Error(`Path is a directory, not a file: ${filepath}`)

      exists = await Filesystem.exists(filepath)
      const contentOld = exists ? await Filesystem.readText(filepath) : ""
      if (exists) await FileTime.assert(ctx.sessionID, filepath)

      const diff = trimDiff(createTwoFilesPatch(filepath, filepath, contentOld, params.content))
      await ctx.ask({
        permission: "edit",
        patterns: [path.relative(Instance.worktree, filepath)],
        always: ["*"],
        metadata: {
          filepath,
          diff,
        },
      })

      await Filesystem.write(filepath, params.content)
      await notifyFileEdited(filepath, exists ? "change" : "add")
      await FileTime.read(ctx.sessionID, filepath)
      // Match edit/multiedit/apply_patch: feed BlastRadius the diff churn
      // (additions + deletions), not raw line counts. Summing old + new
      // line counts double-charged unchanged lines and inflated the cap
      // by up to 2x for full overwrites of mostly-identical content
      // (BUG-119).
      let additions = 0
      let deletions = 0
      for (const change of diffLines(contentOld, params.content)) {
        if (change.added) additions += change.count || 0
        else if (change.removed) deletions += change.count || 0
      }
      BlastRadius.recordWriteAndAssert(ctx.sessionID, filepath, additions + deletions)
    })

    const { diagnostics, output: diagOutput } = await collectDiagnostics([filepath], {
      includeProjectDiagnostics: true,
    })
    let output = "Wrote file successfully." + diagOutput

    return {
      title: path.relative(Instance.worktree, filepath),
      metadata: {
        diagnostics,
        filepath,
        exists: exists,
      },
      output,
    }
  },
})
