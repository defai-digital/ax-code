export type LspProfileMethod =
  | "hover"
  | "definition"
  | "references"
  | "implementation"
  | "documentSymbol"
  | "workspaceSymbol"
  | "callHierarchy"

export type BuiltinServerProfile = {
  semantic?: boolean
  prewarm?: boolean
  priority?: number
  concurrency?: number
  capabilityHints?: Partial<Record<LspProfileMethod, boolean>>
}

const NO_SEMANTIC_HINTS: BuiltinServerProfile["capabilityHints"] = Object.freeze({
  hover: false,
  definition: false,
  references: false,
  implementation: false,
  documentSymbol: false,
  workspaceSymbol: false,
  callHierarchy: false,
})

const AUXILIARY_LINT_PROFILE: BuiltinServerProfile = Object.freeze({
  semantic: false,
  priority: -100,
  concurrency: 1,
  capabilityHints: NO_SEMANTIC_HINTS,
})

const PRIMARY_SEMANTIC_PROFILE: BuiltinServerProfile = Object.freeze({
  priority: 100,
  concurrency: 2,
})

const SECONDARY_SEMANTIC_PROFILE: BuiltinServerProfile = Object.freeze({
  priority: 80,
  concurrency: 1,
})

const STARTUP_DEFERRED_SEMANTIC_PROFILE: BuiltinServerProfile = Object.freeze({
  priority: 80,
  concurrency: 1,
  prewarm: false,
})

const HEAVY_SEMANTIC_PROFILE: BuiltinServerProfile = Object.freeze({
  priority: 100,
  concurrency: 1,
})

// Static control-plane defaults for built-in servers.
//
// These values should be conservative:
// - `semantic: false` is only used for clearly auxiliary lint servers.
// - `prewarm: false` keeps fragile or low-value servers available on demand
//   without letting startup hydration launch them speculatively.
// - `priority` only matters when multiple matching servers survive the
//   semantic/method filter.
// - `concurrency` is intentionally low for heavyweight servers that tend to
//   cold-start slowly or consume substantial memory.
// - capability hints are only set to `false` when we are confident the server
//   should never be queried for semantic navigation.
export const BuiltinServerProfiles: Record<string, BuiltinServerProfile> = {
  deno: PRIMARY_SEMANTIC_PROFILE,
  typescript: PRIMARY_SEMANTIC_PROFILE,
  vue: SECONDARY_SEMANTIC_PROFILE,
  eslint: AUXILIARY_LINT_PROFILE,
  oxlint: AUXILIARY_LINT_PROFILE,
  biome: AUXILIARY_LINT_PROFILE,
  gopls: PRIMARY_SEMANTIC_PROFILE,
  "ruby-lsp": SECONDARY_SEMANTIC_PROFILE,
  ty: PRIMARY_SEMANTIC_PROFILE,
  pyright: PRIMARY_SEMANTIC_PROFILE,
  "elixir-ls": SECONDARY_SEMANTIC_PROFILE,
  zls: SECONDARY_SEMANTIC_PROFILE,
  csharp: HEAVY_SEMANTIC_PROFILE,
  fsharp: HEAVY_SEMANTIC_PROFILE,
  "sourcekit-lsp": HEAVY_SEMANTIC_PROFILE,
  rust: PRIMARY_SEMANTIC_PROFILE,
  clangd: HEAVY_SEMANTIC_PROFILE,
  svelte: SECONDARY_SEMANTIC_PROFILE,
  astro: SECONDARY_SEMANTIC_PROFILE,
  jdtls: HEAVY_SEMANTIC_PROFILE,
  "kotlin-ls": HEAVY_SEMANTIC_PROFILE,
  "yaml-ls": SECONDARY_SEMANTIC_PROFILE,
  "lua-ls": SECONDARY_SEMANTIC_PROFILE,
  "php intelephense": SECONDARY_SEMANTIC_PROFILE,
  prisma: SECONDARY_SEMANTIC_PROFILE,
  dart: SECONDARY_SEMANTIC_PROFILE,
  "ocaml-lsp": SECONDARY_SEMANTIC_PROFILE,
  bash: STARTUP_DEFERRED_SEMANTIC_PROFILE,
  terraform: SECONDARY_SEMANTIC_PROFILE,
  texlab: SECONDARY_SEMANTIC_PROFILE,
  dockerfile: SECONDARY_SEMANTIC_PROFILE,
  gleam: SECONDARY_SEMANTIC_PROFILE,
  "clojure-lsp": SECONDARY_SEMANTIC_PROFILE,
  nixd: SECONDARY_SEMANTIC_PROFILE,
  tinymist: SECONDARY_SEMANTIC_PROFILE,
  "haskell-language-server": SECONDARY_SEMANTIC_PROFILE,
  julials: HEAVY_SEMANTIC_PROFILE,
}
