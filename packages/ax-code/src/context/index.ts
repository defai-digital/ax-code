/**
 * AGENTS.md context system
 *
 * Usage:
 *   import { Context } from "./context"
 *   const result = await Context.init({ root: process.cwd(), depth: "standard" })
 */

import path from "path"
import { analyze, type DepthLevel, type ProjectInfo } from "./analyzer"
import { generate } from "./generator"
import { Log } from "../util/log"

export { type DepthLevel, type ProjectInfo } from "./analyzer"

export namespace Context {
  const log = Log.create({ service: "context" })

  export const OUTPUT_FILENAME = "AGENTS.md"

  export interface InitOptions {
    root: string
    depth?: DepthLevel
    force?: boolean
    dryRun?: boolean
  }

  export interface InitResult {
    path: string
    content: string
    info: ProjectInfo
    created: boolean
  }

  export async function init(opts: InitOptions): Promise<InitResult> {
    const root = opts.root
    const depth = opts.depth ?? "standard"
    const outputPath = path.join(root, OUTPUT_FILENAME)

    log.info("analyzing project", { root, depth })

    const file = Bun.file(outputPath)
    if ((await file.exists()) && !opts.force) {
      log.info("AGENTS.md already exists, use --force to regenerate")
      const content = await file.text()
      const info = await analyze(root)
      return {
        path: outputPath,
        content,
        info,
        created: false,
      }
    }

    const info = await analyze(root)
    const content = generate(info, { depth })

    if (opts.dryRun) {
      log.info("dry run — not writing file")
      return {
        path: outputPath,
        content,
        info,
        created: false,
      }
    }

    await Bun.write(outputPath, content)
    log.info("wrote AGENTS.md", { path: outputPath, lines: content.split("\n").length })

    return {
      path: outputPath,
      content,
      info,
      created: true,
    }
  }

  export async function read(root: string): Promise<string | null> {
    const primary = Bun.file(path.join(root, OUTPUT_FILENAME))
    if (await primary.exists()) return primary.text()
    return null
  }

  export async function refresh(root: string, depth?: DepthLevel): Promise<InitResult> {
    return init({ root, depth, force: true })
  }
}
