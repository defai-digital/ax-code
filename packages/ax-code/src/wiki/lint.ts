/**
 * Wiki health lint: stale vs HEAD, missing index, empty pages, frontmatter link coverage.
 */

import { execFile } from "child_process"
import { promisify } from "util"
import { detectWiki, type WikiDetectResult } from "./detect"
import { loadWikiPages } from "./pages"
import { buildSymbolIndex } from "./links"

const execFileAsync = promisify(execFile)

export type WikiLintLevel = "error" | "warn" | "info"

export type WikiLintIssue = {
  level: WikiLintLevel
  code: string
  message: string
}

export type WikiLintReport = {
  root: string
  wikiDirRelative: string
  ok: boolean
  headCommit?: string
  wikiCommit?: string
  stale: boolean
  issues: WikiLintIssue[]
  stats: {
    pageCount: number
    linkedPageCount: number
    symbolCount: number
    emptySummaryCount: number
  }
}

export async function gitHeadCommit(root: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      timeout: 10_000,
      windowsHide: true,
    })
    const sha = stdout.trim()
    return sha || undefined
  } catch {
    return undefined
  }
}

/** True when wiki cursor commit does not match current HEAD (prefix-aware). */
export function isWikiStale(wikiCommit: string | undefined, headCommit: string | undefined): boolean {
  if (!wikiCommit || !headCommit) return false
  const a = wikiCommit.trim().toLowerCase()
  const b = headCommit.trim().toLowerCase()
  if (!a || !b) return false
  return !(b.startsWith(a) || a.startsWith(b))
}

export function evaluateLint(input: {
  det: WikiDetectResult
  headCommit?: string
  pageCount: number
  linkedPageCount: number
  symbolCount: number
  emptySummaryCount: number
  hasEmptyBodies: number
}): WikiLintReport {
  const issues: WikiLintIssue[] = []
  const wikiCommit = input.det.lastUpdate?.commit
  const stale = isWikiStale(wikiCommit, input.headCommit)

  if (!input.det.wikiExists) {
    issues.push({
      level: "error",
      code: "wiki.missing",
      message: `No wiki directory at ${input.det.wikiDirRelative}/. Run: ax-code wiki generate`,
    })
  } else {
    if (!input.det.hasIndex) {
      issues.push({
        level: "error",
        code: "wiki.no_index",
        message: "Missing index page (quickstart.md / index.md / README.md).",
      })
    }
    if (input.pageCount === 0) {
      issues.push({
        level: "error",
        code: "wiki.empty",
        message: "Wiki directory has no markdown pages.",
      })
    }
    if (stale) {
      issues.push({
        level: "warn",
        code: "wiki.stale",
        message: `Wiki last-update commit (${wikiCommit}) differs from HEAD (${input.headCommit}). Run: ax-code wiki update`,
      })
    } else if (!wikiCommit) {
      issues.push({
        level: "info",
        code: "wiki.no_cursor",
        message: "No openwiki/.last-update.json commit cursor; cannot detect staleness automatically.",
      })
    }
    if (input.pageCount > 0 && input.linkedPageCount === 0) {
      issues.push({
        level: "info",
        code: "wiki.no_symbol_links",
        message:
          "No pages declare frontmatter `symbols:`. Add symbols for wiki↔graph cross-links (ax-code wiki related <name>).",
      })
    }
    if (input.emptySummaryCount > 0) {
      issues.push({
        level: "info",
        code: "wiki.thin_summaries",
        message: `${input.emptySummaryCount} page(s) lack a usable summary paragraph.`,
      })
    }
    if (input.hasEmptyBodies > 0) {
      issues.push({
        level: "warn",
        code: "wiki.empty_bodies",
        message: `${input.hasEmptyBodies} page(s) have empty bodies.`,
      })
    }
  }

  const hasError = issues.some((i) => i.level === "error")
  return {
    root: input.det.root,
    wikiDirRelative: input.det.wikiDirRelative,
    ok: !hasError && input.det.wikiExists,
    headCommit: input.headCommit,
    wikiCommit,
    stale,
    issues,
    stats: {
      pageCount: input.pageCount,
      linkedPageCount: input.linkedPageCount,
      symbolCount: input.symbolCount,
      emptySummaryCount: input.emptySummaryCount,
    },
  }
}

export async function lintWiki(input: {
  root: string
  dir?: string
  command?: string
}): Promise<WikiLintReport> {
  const det = await detectWiki({ root: input.root, dir: input.dir, command: input.command })
  const headCommit = await gitHeadCommit(input.root)

  if (!det.wikiExists) {
    return evaluateLint({
      det,
      headCommit,
      pageCount: 0,
      linkedPageCount: 0,
      symbolCount: 0,
      emptySummaryCount: 0,
      hasEmptyBodies: 0,
    })
  }

  const pages = await loadWikiPages({ root: det.root, wikiDir: det.wikiDir })
  const index = buildSymbolIndex(pages)
  const emptySummaryCount = pages.filter((p) => !p.summary.trim()).length
  const hasEmptyBodies = pages.filter((p) => !p.body.trim()).length

  return evaluateLint({
    det,
    headCommit,
    pageCount: pages.length,
    linkedPageCount: index.linkedPageCount,
    symbolCount: index.symbolCount,
    emptySummaryCount,
    hasEmptyBodies,
  })
}
