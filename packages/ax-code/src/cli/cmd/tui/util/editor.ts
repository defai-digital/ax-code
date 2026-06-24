import { defer } from "@/util/defer"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliRenderer } from "@opentui/core"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { parseShellArgs } from "@/util/shell-args"
import { pickFirstEnvValue } from "./env"

export namespace Editor {
  export type OpenResult = { status: "saved"; content: string } | { status: "cancelled" } | { status: "missing-editor" }

  export async function open(opts: { value: string; renderer: CliRenderer }): Promise<OpenResult> {
    const editor = pickFirstEnvValue({ env: process.env, names: ["VISUAL", "EDITOR"] })
    if (!editor) return { status: "missing-editor" }

    const filepath = join(tmpdir(), `${Date.now()}-${crypto.randomUUID()}.md`)
    await using _ = defer(async () => rm(filepath, { force: true }))

    await Filesystem.write(filepath, opts.value)
    let suspended = false
    try {
      opts.renderer.suspend()
      suspended = true
      opts.renderer.currentRenderBuffer.clear()
      const parts = parseShellArgs(editor)
      if (parts.length === 0) return { status: "missing-editor" }
      const proc = Process.spawn([...parts, filepath], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        shell: process.platform === "win32",
      })
      await proc.exited
      const content = await Filesystem.readText(filepath)
      return content ? { status: "saved", content } : { status: "cancelled" }
    } finally {
      opts.renderer.currentRenderBuffer.clear()
      if (suspended) opts.renderer.resume()
      opts.renderer.requestRender()
    }
  }
}
