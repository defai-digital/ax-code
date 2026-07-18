export const AX_WIKI_SCHEMA_VERSION = 1 as const
export const AX_WIKI_GENERATOR = "ax-wiki" as const

export type WikiAction = "generate" | "update"

export type WikiSource = {
  path: string
  hash: string
  bytes: number
  category: "code" | "documentation" | "configuration" | "test" | "workflow" | "other"
  language?: string
}

export type WikiPlanPage = {
  path: string
  title: string
  purpose: string
  selectors: string[]
  kind: "quickstart" | "architecture" | "development" | "module" | "custom"
}

export type WikiPlan = {
  schemaVersion: typeof AX_WIKI_SCHEMA_VERSION
  pages: WikiPlanPage[]
  modules: Array<{ name: string; prefix: string; fileCount: number }>
  sourceCount: number
}

export type WikiPageGenerationRequest = {
  action: WikiAction
  root: string
  wikiDir: string
  page: WikiPlanPage
  plan: WikiPlan
  sources: Array<WikiSource & { content: string; truncated: boolean }>
  sourceInventory: WikiSource[]
  graphContext?: string
  instructions?: string
  previousContent?: string
}

export type WikiPageGenerationResult = {
  body: string
  summary: string
  symbols?: string[]
}

export type WikiPageGenerator = (request: WikiPageGenerationRequest) => Promise<WikiPageGenerationResult>

export type WikiGraphContextProvider = (input: {
  page: WikiPlanPage
  sources: WikiSource[]
}) => Promise<string | undefined>

export type WikiPageConfig = {
  path: string
  title: string
  purpose: string
  selectors: string[]
}

export type AxWikiConfig = {
  include?: string[]
  exclude?: string[]
  pages?: WikiPageConfig[]
  maxPages?: number
  maxSourcesPerPage?: number
  maxSourceBytes?: number
  maxPageSourceBytes?: number
  instructions?: string
}

export type WikiManifestPage = {
  title: string
  purpose: string
  selectors: string[]
  sources: string[]
  sourceHashes: Record<string, string>
  summary: string
  symbols: string[]
  contentHash: string
  managedHash: string
  generatedAt: string
}

export type WikiManifest = {
  schemaVersion: typeof AX_WIKI_SCHEMA_VERSION
  generator: typeof AX_WIKI_GENERATOR
  generatedAt: string
  repositoryHead?: string
  model?: string
  planHash: string
  sources: Record<string, string>
  pages: Record<string, WikiManifestPage>
}

export type WikiValidationIssue = {
  level: "error" | "warning"
  code: string
  message: string
  page?: string
}

export type WikiValidationReport = {
  ok: boolean
  issues: WikiValidationIssue[]
  stats: {
    pageCount: number
    sourceCount: number
    symbolCount: number
    protectedSectionCount: number
  }
}

export type WikiBuildProgress =
  | { type: "discover"; sourceCount: number }
  | { type: "plan"; pageCount: number }
  | { type: "page_start"; path: string; index: number; total: number }
  | { type: "page_complete"; path: string; index: number; total: number }
  | { type: "validate"; issueCount: number }
  | { type: "write"; path: string }

export type WikiBuildInput = {
  root: string
  wikiDir?: string
  action: WikiAction
  generator: WikiPageGenerator
  graphContext?: WikiGraphContextProvider
  config?: AxWikiConfig
  model?: string
  repositoryHead?: string
  force?: boolean
  now?: () => Date
  onProgress?: (progress: WikiBuildProgress) => void
}

export type WikiBuildResult = {
  action: WikiAction
  root: string
  wikiDir: string
  plan: WikiPlan
  generatedPages: string[]
  unchangedPages: string[]
  removedPages: string[]
  conflicts: string[]
  manifest: WikiManifest
  validation: WikiValidationReport
}

export type WikiPage = {
  path: string
  relativePath: string
  title: string
  summary?: string
  symbols: string[]
  sources: string[]
  body: string
  content: string
}

export type WikiCard = {
  path: string
  title: string
  summary?: string
  symbols: string[]
  sources: string[]
}
