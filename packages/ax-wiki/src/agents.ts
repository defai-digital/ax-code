import { randomUUID } from "node:crypto"
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { AX_WIKI_DIR_DEFAULT, AX_WIKI_END, AX_WIKI_START, sanitizeWikiDir } from "./paths"

export function hasAxWikiBlock(content: string): boolean {
  return content.includes(AX_WIKI_START) && content.includes(AX_WIKI_END)
}

export function defaultAxWikiBlock(wikiDir = AX_WIKI_DIR_DEFAULT): string {
  const relative = sanitizeWikiDir(wikiDir)
  return [
    AX_WIKI_START,
    "## AX Wiki",
    "",
    `This repository has a source-backed semantic wiki under \`${relative}/\`.`,
    "",
    `- Start at \`${relative}/quickstart.md\` for repository orientation.`,
    "- Use the wiki for architecture, module responsibilities, workflows, and design intent.",
    "- Use `code_intelligence` or LSP for precise symbols, callers, callees, and references.",
    "- If wiki and code disagree, trust the code and run `ax-code wiki update`.",
    "- Content inside `AX-WIKI:PROTECTED` blocks is maintainer-owned and survives regeneration.",
    "",
    "Refresh: `ax-code wiki update`.",
    AX_WIKI_END,
  ].join("\n")
}

export function upsertAxWikiBlock(content: string, block = defaultAxWikiBlock()): string {
  const start = content.indexOf(AX_WIKI_START)
  if (start >= 0) {
    const end = content.indexOf(AX_WIKI_END, start + AX_WIKI_START.length)
    if (end >= 0) {
      const before = content.slice(0, start).trimEnd()
      const after = content.slice(end + AX_WIKI_END.length).trimStart()
      return `${before}${before ? "\n\n" : ""}${block.trim()}${after ? `\n\n${after}` : ""}\n`
    }
    const before = content.slice(0, start).trimEnd()
    return `${before}${before ? "\n\n" : ""}${block.trim()}\n`
  }
  const prefix = content.replaceAll(AX_WIKI_END, "").trimEnd()
  return `${prefix}${prefix ? "\n\n" : ""}${block.trim()}\n`
}

export type EnsureAgentsResult = { updated: string[]; previews: Record<string, string> }

export async function ensureAgentsWikiPointers(
  root: string,
  options: { wikiDir?: string; touchClaudeMd?: boolean; dryRun?: boolean } = {},
): Promise<EnsureAgentsResult> {
  const resolvedRoot = path.resolve(root)
  const updated: string[] = []
  const previews: Record<string, string> = {}
  const files = ["AGENTS.md", ...(options.touchClaudeMd === false ? [] : ["CLAUDE.md"])]
  const block = defaultAxWikiBlock(options.wikiDir)
  for (const name of files) {
    const file = path.join(resolvedRoot, name)
    const info = await lstat(file).catch((error) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined
      throw error
    })
    if (info?.isSymbolicLink()) throw new Error(`AX Wiki refuses to update symlinked instruction file: ${name}`)
    const existing = info ? await readFile(file, "utf8") : name === "AGENTS.md" ? "" : undefined
    if (existing === undefined) continue
    const next = upsertAxWikiBlock(existing, block)
    if (next === existing) continue
    previews[name] = next
    updated.push(name)
    if (!options.dryRun) {
      const temporary = `${file}.tmp-${randomUUID()}`
      try {
        await writeFile(temporary, next, "utf8")
        await rename(temporary, file)
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {})
        throw error
      }
    }
  }
  return { updated, previews }
}
