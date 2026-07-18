import path from "node:path"
import { matchesGlob } from "./glob"
import { safeRelativePath } from "./paths"
import type { AxWikiConfig, WikiPlan, WikiPlanPage, WikiSource } from "./types"

const RESERVED_DIRS = new Set(["docs", "test", "tests", ".github", "scripts", "script", "tools", "examples"])

function slug(input: string): string {
  return (
    input
      .replace(/^@/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "module"
  )
}

function title(input: string): string {
  return input
    .replace(/^@/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function domainPrefix(file: string): { name: string; prefix: string } | undefined {
  const parts = file.split("/")
  if (parts.length < 2) return undefined
  if (["packages", "crates", "apps", "services", "modules"].includes(parts[0]!) && parts[1]) {
    return { name: parts[1], prefix: `${parts[0]}/${parts[1]}/` }
  }
  if (["src", "lib", "app"].includes(parts[0]!) && parts[1] && parts.length > 2) {
    return { name: parts[1], prefix: `${parts[0]}/${parts[1]}/` }
  }
  if (!RESERVED_DIRS.has(parts[0]!)) return { name: parts[0]!, prefix: `${parts[0]}/` }
  return undefined
}

function customPages(config: AxWikiConfig): WikiPlanPage[] | undefined {
  if (!config.pages?.length) return undefined
  const pages: WikiPlanPage[] = []
  for (const page of config.pages) {
    const relative = safeRelativePath(page.path)
    if (!relative || !relative.endsWith(".md")) throw new Error(`Invalid AX Wiki page path: ${page.path}`)
    if (!page.title.trim() || !page.purpose.trim() || page.selectors.length === 0) {
      throw new Error(`AX Wiki custom page requires title, purpose, and selectors: ${page.path}`)
    }
    pages.push({ ...page, path: relative, kind: "custom" })
  }
  if (!pages.some((page) => page.path === "quickstart.md")) {
    throw new Error("AX Wiki custom pages must include quickstart.md")
  }
  return pages
}

export function createWikiPlan(sources: WikiSource[], config: AxWikiConfig = {}): WikiPlan {
  const configured = customPages(config)
  const counts = new Map<string, { name: string; prefix: string; fileCount: number }>()
  for (const source of sources) {
    const domain = domainPrefix(source.path)
    if (!domain) continue
    const current = counts.get(domain.prefix) ?? { ...domain, fileCount: 0 }
    current.fileCount++
    counts.set(domain.prefix, current)
  }
  const modules = [...counts.values()].sort(
    (left, right) => right.fileCount - left.fileCount || left.prefix.localeCompare(right.prefix),
  )
  const maxPages = Math.max(3, Math.min(40, config.maxPages ?? 12))
  const usedPaths = new Set<string>()

  const pages: WikiPlanPage[] = configured ?? [
    {
      path: "quickstart.md",
      title: "Repository Quickstart",
      purpose:
        "Orient a new contributor: purpose, stack, entrypoints, setup, and the shortest path to productive work.",
      selectors: [
        "README*",
        "AGENTS.md",
        "package.json",
        "Cargo.toml",
        "go.mod",
        "pyproject.toml",
        "pnpm-workspace.yaml",
        "docs/start-here.md",
      ],
      kind: "quickstart",
    },
    {
      path: "architecture/overview.md",
      title: "Architecture Overview",
      purpose:
        "Explain system boundaries, major components, runtime flow, data flow, and important architectural decisions.",
      selectors: [
        "README*",
        "**/package.json",
        "**/Cargo.toml",
        "**/go.mod",
        "**/pyproject.toml",
        "docs/architecture*.md",
        "docs/specs/**",
      ],
      kind: "architecture",
    },
    {
      path: "development/workflows.md",
      title: "Development Workflows",
      purpose: "Document build, test, release, CI, debugging, and safe change workflows.",
      selectors: [
        "AGENTS.md",
        "CONTRIBUTING*",
        "package.json",
        "**/package.json",
        "Makefile",
        ".github/**",
        "**/test/**",
        "**/tests/**",
        "**/*.test.*",
        "**/*.spec.*",
      ],
      kind: "development",
    },
  ]

  if (!configured) {
    for (const module of modules) {
      if (pages.length >= maxPages) break
      let pagePath = `modules/${slug(module.name)}.md`
      let suffix = 2
      while (usedPaths.has(pagePath) || pages.some((page) => page.path === pagePath)) {
        pagePath = `modules/${slug(module.name)}-${suffix++}.md`
      }
      pages.push({
        path: pagePath,
        title: `${title(module.name)} Module`,
        purpose: `Explain the responsibilities, public surface, internal flow, dependencies, and change guidance for ${module.prefix}.`,
        selectors: [`${module.prefix}**`],
        kind: "module",
      })
      usedPaths.add(pagePath)
    }
  }

  const seen = new Set<string>()
  for (const page of pages) {
    if (seen.has(page.path)) throw new Error(`Duplicate AX Wiki page path: ${page.path}`)
    seen.add(page.path)
  }

  return {
    schemaVersion: 1,
    pages,
    modules: modules.slice(0, 40),
    sourceCount: sources.length,
  }
}

export function sourceMatchesPage(source: WikiSource | string, page: WikiPlanPage): boolean {
  const file = typeof source === "string" ? source : source.path
  return page.selectors.some((selector) => matchesGlob(file, selector))
}

function sourceScore(source: WikiSource): number {
  const basename = path.posix.basename(source.path).toLowerCase()
  let score = 0
  if (basename.startsWith("readme")) score += 100
  if (["package.json", "cargo.toml", "go.mod", "pyproject.toml", "agents.md", "contributing.md"].includes(basename))
    score += 80
  if (/(^|\/)(index|main|mod|lib)\.[^.]+$/.test(source.path.toLowerCase())) score += 50
  if (source.category === "documentation") score += 35
  if (source.category === "configuration") score += 25
  if (source.category === "code") score += 20
  score -= Math.min(20, Math.floor(source.bytes / 20_000))
  return score
}

export function selectPageSources(sources: WikiSource[], page: WikiPlanPage, maxSources = 80): WikiSource[] {
  return sources
    .filter((source) => sourceMatchesPage(source, page))
    .sort((left, right) => sourceScore(right) - sourceScore(left) || left.path.localeCompare(right.path))
    .slice(0, Math.max(1, maxSources))
}
