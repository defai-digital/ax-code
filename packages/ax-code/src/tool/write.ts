import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { createTwoFilesPatch } from "diff"
import DESCRIPTION from "./write.txt"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { trimDiff } from "./edit"
import { assertExternalDirectory } from "./external-directory"
import { notifyFileEdited, collectDiagnostics } from "./diagnostics"
import { Isolation } from "@/isolation"

export const WriteTool = Tool.define("write", {
  description: DESCRIPTION,
  parameters: z.object({
    content: z.string().describe("The content to write to the file"),
    filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
  }),
  async execute(params, ctx) {
    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filepath)
    Isolation.assertWrite(ctx.extra?.isolation, filepath, Instance.directory, Instance.worktree)

    // Read + assert + diff computation must all happen inside the lock,
    // otherwise a concurrent tool call or external process modifying
    // the file between `Filesystem.readText` and `Filesystem.write`
    // would make the diff shown to the user stale — they'd approve
    // one change and see a different one applied. `edit.ts` already
    // does all of this inside its lock; `write.ts` was inconsistent.
    let exists = false
    await FileTime.withLock(filepath, async () => {
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
    })

    const { diagnostics, output: diagOutput } = await collectDiagnostics([filepath], { includeProjectDiagnostics: true })
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
