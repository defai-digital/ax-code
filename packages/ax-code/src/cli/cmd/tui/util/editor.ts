import { defer } from "@/util/defer"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliRenderer } from "@opentui/core"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"

export namespace Editor {
  function parseCommand(input: string) {
    const parts: string[] = []
    let current = ""
    let quote: '"' | "'" | undefined
    let escape = false

    for (const char of input) {
      if (escape) {
        current += char
        escape = false
        continue
      }
      if (char === "\\") {
        escape = true
        continue
      }
      if (quote) {
        if (char === quote) {
          quote = undefined
          continue
        }
        current += char
        continue
      }
      if (char === '"' || char === "'") {
        quote = char
        continue
      }
      if (/\s/.test(char)) {
        if (current) {
          parts.push(current)
          current = ""
        }
        continue
      }
      current += char
    }

    if (escape) current += "\\"
    if (current) parts.push(current)
    return parts
  }

  export async function open(opts: { value: string; renderer: CliRenderer }): Promise<string | undefined> {
    const editor = process.env["VISUAL"] || process.env["EDITOR"]
    if (!editor) return

    const filepath = join(tmpdir(), `${Date.now()}-${crypto.randomUUID()}.md`)
    await using _ = defer(async () => rm(filepath, { force: true }))

    await Filesystem.write(filepath, opts.value)
    opts.renderer.suspend()
    opts.renderer.currentRenderBuffer.clear()
    try {
      const parts = parseCommand(editor)
      if (parts.length === 0) return
      const proc = Process.spawn([...parts, filepath], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        shell: process.platform === "win32",
      })
      await proc.exited
      const content = await Filesystem.readText(filepath)
      return content || undefined
    } finally {
      opts.renderer.currentRenderBuffer.clear()
      opts.renderer.resume()
      opts.renderer.requestRender()
    }
  }
}
