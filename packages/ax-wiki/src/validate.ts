import path from "node:path"
import { symbolGrounded } from "./grounding.js"
import { parseFrontmatter } from "./frontmatter.js"
import { extractProtectedSections, managedContentHash, protectedSectionsBalanced } from "./protected.js"
import { AX_WIKI_GENERATOR } from "./types.js"
import type { WikiManifest, WikiPlan, WikiSource, WikiValidationIssue, WikiValidationReport } from "./types.js"

function markdownLinkTargets(content: string): string[] {
  const targets: string[] = []
  let from = 0
  while (from < content.length) {
    const mid = content.indexOf("](", from)
    if (mid < 0) break
    const open = content.lastIndexOf("[", mid)
    if (open < 0 || content.indexOf("]", open + 1) !== mid) {
      from = mid + 2
      continue
    }
    const close = content.indexOf(")", mid + 2)
    if (close < 0) break
    targets.push(content.slice(mid + 2, close))
    from = close + 1
  }
  return targets
}

/** Validate relative links against all planned paths before sibling pages exist. */
export function validateWikiPageLinks(
  pagePath: string,
  content: string,
  knownPages: ReadonlySet<string>,
): WikiValidationIssue[] {
  const issues: WikiValidationIssue[] = []
  for (const href of markdownLinkTargets(content)) {
    const target = href.split("#")[0]!
    if (!target || /^(https?:|mailto:|#)/.test(target) || target.startsWith("/")) continue
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(pagePath), target))
    if (target.endsWith(".md") && !knownPages.has(resolved)) {
      issues.push({
        level: "error",
        code: "wiki.link_broken",
        page: pagePath,
        message: `${pagePath} links to missing page: ${target}`,
      })
    }
  }
  return issues
}

export function validateWikiCandidate(input: {
  plan: WikiPlan
  pages: Map<string, string>
  sources: WikiSource[]
  manifest?: WikiManifest
  /** Bounded source excerpts, keyed by relative path, used for grounding checks. */
  sourceContents?: ReadonlyMap<string, string>
  /**
   * Pages whose generation failed this build and were therefore not written
   * (ADR-156 partial update). They are reported by the build itself, so the
   * "planned page is missing" error is suppressed for exactly these paths.
   */
  missingAllowed?: readonly string[]
}): WikiValidationReport {
  const issues: WikiValidationIssue[] = []
  const knownSources = new Set(input.sources.map((source) => source.path))
  const knownPages = new Set(input.pages.keys())
  const missingAllowed = new Set(input.missingAllowed ?? [])
  let symbolCount = 0
  let protectedSectionCount = 0

  if (!input.pages.has("quickstart.md") && !missingAllowed.has("quickstart.md")) {
    issues.push({ level: "error", code: "wiki.quickstart_missing", message: "AX Wiki requires quickstart.md" })
  }

  for (const planned of input.plan.pages) {
    if (!input.pages.has(planned.path) && !missingAllowed.has(planned.path)) {
      issues.push({
        level: "error",
        code: "wiki.page_missing",
        page: planned.path,
        message: `Planned page is missing: ${planned.path}`,
      })
    }
  }

  for (const [pagePath, content] of input.pages) {
    const meta = parseFrontmatter(content)
    if (meta.generatedBy !== AX_WIKI_GENERATOR) {
      issues.push({
        level: "error",
        code: "wiki.generator_missing",
        page: pagePath,
        message: `${pagePath} is missing generated_by: ax-wiki`,
      })
    }
    if (!meta.title?.trim() || !meta.summary?.trim()) {
      issues.push({
        level: "error",
        code: "wiki.metadata_incomplete",
        page: pagePath,
        message: `${pagePath} requires title and summary frontmatter`,
      })
    }
    if (meta.body.trim().length < 80) {
      issues.push({
        level: "error",
        code: "wiki.page_too_thin",
        page: pagePath,
        message: `${pagePath} is too short to be useful`,
      })
    }
    if (!protectedSectionsBalanced(content)) {
      issues.push({
        level: "error",
        code: "wiki.protected_unbalanced",
        page: pagePath,
        message: `${pagePath} has unbalanced protected markers`,
      })
    }
    const protectedSections = extractProtectedSections(content)
    protectedSectionCount += protectedSections.length
    const protectedIDs = protectedSections.map((section) => section.id)
    if (new Set(protectedIDs).size !== protectedIDs.length) {
      issues.push({
        level: "error",
        code: "wiki.protected_duplicate",
        page: pagePath,
        message: `${pagePath} contains duplicate protected section IDs`,
      })
    }
    symbolCount += meta.symbols.length
    if (meta.sources.length === 0) {
      issues.push({
        level: "warning",
        code: "wiki.sources_empty",
        page: pagePath,
        message: `${pagePath} has no source evidence`,
      })
    }
    for (const source of meta.sources) {
      if (!knownSources.has(source)) {
        issues.push({
          level: "error",
          code: "wiki.source_missing",
          page: pagePath,
          message: `${pagePath} cites missing source: ${source}`,
        })
      }
    }
    // Deterministic symbol grounding: a listed symbol should occur in at least
    // one cited source. Only runs when bounded source excerpts were supplied;
    // the excerpt prefix can be shorter than the file, so this is a warning.
    if (input.sourceContents && meta.symbols.length > 0) {
      const contents = meta.sources
        .map((source) => input.sourceContents?.get(source))
        .filter((value): value is string => value !== undefined)
      if (contents.length > 0) {
        for (const symbol of meta.symbols) {
          if (symbol.trim() && !symbolGrounded(symbol, contents)) {
            issues.push({
              level: "warning",
              code: "wiki.ungrounded_symbol",
              page: pagePath,
              message: `${pagePath} lists a symbol not found in its cited sources: ${symbol}`,
            })
          }
        }
      }
    }
    // Gloss names should come from the recorded symbols array; a gloss for
    // an unlisted name is kept but flagged, mirroring ungrounded_symbol.
    if (meta.symbolSummaries.length > 0) {
      const listed = new Set(meta.symbols.map((symbol) => symbol.trim()).filter(Boolean))
      for (const gloss of meta.symbolSummaries) {
        if (!listed.has(gloss.name)) {
          issues.push({
            level: "warning",
            code: "wiki.gloss_unlisted_symbol",
            page: pagePath,
            message: `${pagePath} glosses a symbol not in its symbols array: ${gloss.name}`,
          })
        }
      }
    }
    issues.push(...validateWikiPageLinks(pagePath, content, knownPages))
  }

  if (input.manifest) {
    for (const [page, manifestPage] of Object.entries(input.manifest.pages)) {
      if (!knownPages.has(page)) {
        issues.push({
          level: "warning",
          code: "wiki.manifest_orphan",
          page,
          message: `Manifest references absent page: ${page}`,
        })
        continue
      }
      if (managedContentHash(input.pages.get(page)!) !== manifestPage.managedHash) {
        issues.push({
          level: "error",
          code: "wiki.page_modified",
          page,
          message: `${page} was modified outside AX-WIKI:PROTECTED sections`,
        })
      }
    }
  }

  return {
    ok: !issues.some((issue) => issue.level === "error"),
    issues,
    stats: {
      pageCount: input.pages.size,
      sourceCount: input.sources.length,
      symbolCount,
      protectedSectionCount,
    },
  }
}
