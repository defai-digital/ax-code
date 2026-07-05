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
import { readFile, writeFile } from "fs/promises"

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

    let existingContent: string | undefined
    if (!opts.force) {
      try {
        log.info("AGENTS.md already exists, use --force to regenerate")
        existingContent = await readFile(outputPath, "utf-8")
        const info = await analyze(root)
        return {
          path: outputPath,
          content: existingContent,
          info,
          created: false,
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") throw error
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

    await writeFile(outputPath, content, "utf-8")
    log.info("wrote AGENTS.md", { path: outputPath, lines: content.split("\n").length })

    return {
      path: outputPath,
      content,
      info,
      created: true,
    }
  }

  export async function read(root: string): Promise<string | null> {
    const outputPath = path.join(root, OUTPUT_FILENAME)
    try {
      return await readFile(outputPath, "utf-8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") throw error
      return null
    }
  }

  export async function refresh(root: string, depth?: DepthLevel): Promise<InitResult> {
    return init({ root, depth, force: true })
  }
}
