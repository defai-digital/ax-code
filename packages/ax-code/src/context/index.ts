/**
 * AX.md context system
 * Ported from ax-cli — generates project context for AI comprehension
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

  /**
   * Initialize AX.md for a project
   * Analyzes the project and generates context file
   */
  export async function init(opts: InitOptions): Promise<InitResult> {
    const root = opts.root
    const depth = opts.depth ?? "standard"
    const outputPath = path.join(root, "AX.md")

    log.info("analyzing project", { root, depth })

    // Check if AX.md already exists
    const file = Bun.file(outputPath)
    if ((await file.exists()) && !opts.force) {
      log.info("AX.md already exists, use --force to regenerate")
      const content = await file.text()
      const info = await analyze(root)
      return { path: outputPath, content, info, created: false }
    }

    // Analyze the project
    const info = await analyze(root)

    // Generate AX.md content
    const content = generate(info, { depth })

    if (opts.dryRun) {
      log.info("dry run — not writing file")
      return { path: outputPath, content, info, created: false }
    }

    // Write the file
    await Bun.write(outputPath, content)
    log.info("wrote AX.md", { path: outputPath, lines: content.split("\n").length })

    return { path: outputPath, content, info, created: true }
  }

  /**
   * Read existing AX.md content for prompt injection
   * Returns null if no AX.md exists
   */
  export async function read(root: string): Promise<string | null> {
    const file = Bun.file(path.join(root, "AX.md"))
    if (!(await file.exists())) return null
    return file.text()
  }

  /**
   * Refresh an existing AX.md with fresh analysis
   */
  export async function refresh(root: string, depth?: DepthLevel): Promise<InitResult> {
    return init({ root, depth, force: true })
  }
}
