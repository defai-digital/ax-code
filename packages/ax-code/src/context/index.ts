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
  export const LEGACY_FILENAME = "AX.md"

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
    legacyPath?: string
  }

  export async function init(opts: InitOptions): Promise<InitResult> {
    const root = opts.root
    const depth = opts.depth ?? "standard"
    const outputPath = path.join(root, OUTPUT_FILENAME)
    const legacyPath = path.join(root, LEGACY_FILENAME)

    log.info("analyzing project", { root, depth })

    const legacyFile = Bun.file(legacyPath)
    const legacyExists = await legacyFile.exists()

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
        legacyPath: legacyExists ? legacyPath : undefined,
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
        legacyPath: legacyExists ? legacyPath : undefined,
      }
    }

    await Bun.write(outputPath, content)
    log.info("wrote AGENTS.md", { path: outputPath, lines: content.split("\n").length })

    return {
      path: outputPath,
      content,
      info,
      created: true,
      legacyPath: legacyExists ? legacyPath : undefined,
    }
  }

  export async function read(root: string): Promise<string | null> {
    const primary = Bun.file(path.join(root, OUTPUT_FILENAME))
    if (await primary.exists()) return primary.text()
    const legacy = Bun.file(path.join(root, LEGACY_FILENAME))
    if (await legacy.exists()) return legacy.text()
    return null
  }

  export async function refresh(root: string, depth?: DepthLevel): Promise<InitResult> {
    return init({ root, depth, force: true })
  }
}
