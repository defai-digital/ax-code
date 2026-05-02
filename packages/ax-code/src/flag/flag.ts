import { Config } from "effect"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

export namespace Flag {
  export const AX_CODE_AUTO_SHARE = truthy("AX_CODE_AUTO_SHARE")
  export const AX_CODE_GIT_BASH_PATH = process.env["AX_CODE_GIT_BASH_PATH"]
  export const AX_CODE_CONFIG = process.env["AX_CODE_CONFIG"]
  export declare const AX_CODE_TUI_CONFIG: string | undefined
  export declare const AX_CODE_CONFIG_DIR: string | undefined
  export const AX_CODE_CONFIG_CONTENT = process.env["AX_CODE_CONFIG_CONTENT"]
  export const AX_CODE_DISABLE_AUTOUPDATE = truthy("AX_CODE_DISABLE_AUTOUPDATE")
  export const AX_CODE_ALWAYS_NOTIFY_UPDATE = truthy("AX_CODE_ALWAYS_NOTIFY_UPDATE")
  export const AX_CODE_DISABLE_PRUNE = truthy("AX_CODE_DISABLE_PRUNE")
  export const AX_CODE_DISABLE_TERMINAL_TITLE = truthy("AX_CODE_DISABLE_TERMINAL_TITLE")
  // OpenTUI's full terminal setup enables alternate-screen, capability
  // probes, Kitty keyboard negotiation, and a native render thread. Keep
  // that profile opt-in until it is stable across direct-TTY environments.
  export const AX_CODE_TUI_ADVANCED_TERMINAL = truthy("AX_CODE_TUI_ADVANCED_TERMINAL")
  export const AX_CODE_PERMISSION = process.env["AX_CODE_PERMISSION"]
  export const AX_CODE_DISABLE_DEFAULT_PLUGINS = truthy("AX_CODE_DISABLE_DEFAULT_PLUGINS")
  export const AX_CODE_DISABLE_LSP_DOWNLOAD = truthy("AX_CODE_DISABLE_LSP_DOWNLOAD")
  export const AX_CODE_ENABLE_EXPERIMENTAL_MODELS = truthy("AX_CODE_ENABLE_EXPERIMENTAL_MODELS")
  export const AX_CODE_DISABLE_AUTOCOMPACT = truthy("AX_CODE_DISABLE_AUTOCOMPACT")
  export const AX_CODE_DISABLE_MODELS_FETCH = truthy("AX_CODE_DISABLE_MODELS_FETCH")
  export const AX_CODE_DISABLE_CLAUDE_CODE = truthy("AX_CODE_DISABLE_CLAUDE_CODE")
  export const AX_CODE_DISABLE_CLAUDE_CODE_PROMPT =
    AX_CODE_DISABLE_CLAUDE_CODE || truthy("AX_CODE_DISABLE_CLAUDE_CODE_PROMPT")
  export const AX_CODE_DISABLE_CLAUDE_CODE_SKILLS =
    AX_CODE_DISABLE_CLAUDE_CODE || truthy("AX_CODE_DISABLE_CLAUDE_CODE_SKILLS")
  export const AX_CODE_DISABLE_EXTERNAL_SKILLS =
    AX_CODE_DISABLE_CLAUDE_CODE_SKILLS || truthy("AX_CODE_DISABLE_EXTERNAL_SKILLS")
  export declare const AX_CODE_DISABLE_PROJECT_CONFIG: boolean
  export const AX_CODE_FAKE_VCS = process.env["AX_CODE_FAKE_VCS"]
  export declare const AX_CODE_CLIENT: string
  export const AX_CODE_SERVER_PASSWORD = process.env["AX_CODE_SERVER_PASSWORD"]
  export const AX_CODE_SERVER_USERNAME = process.env["AX_CODE_SERVER_USERNAME"]
  export const AX_CODE_ENABLE_QUESTION_TOOL = truthy("AX_CODE_ENABLE_QUESTION_TOOL")
  export declare const AX_CODE_ISOLATION_MODE: "read-only" | "workspace-write" | "full-access" | undefined
  export declare const AX_CODE_ISOLATION_NETWORK: boolean | undefined

  // Native Rust addons — default ON (opt-out with =0 or =false)
  // These dispatch CPU-bound operations to Rust native addons via NAPI-RS.
  // If the native addon isn't installed, the TypeScript fallback runs
  // transparently via try/catch in each dispatch point.
  export const AX_CODE_NATIVE_INDEX = !falsy("AX_CODE_NATIVE_INDEX")
  export const AX_CODE_NATIVE_FS = !falsy("AX_CODE_NATIVE_FS")
  export const AX_CODE_NATIVE_DIFF = !falsy("AX_CODE_NATIVE_DIFF")
  export const AX_CODE_NATIVE_PARSER = !falsy("AX_CODE_NATIVE_PARSER")
  // Debug-engine native scanners run larger worktree scans through the
  // @ax-code/fs addon. A native process crash cannot be caught by JS, so
  // keep this path opt-in until it has crash-isolation coverage.
  export const AX_CODE_DEBUG_ENGINE_NATIVE_SCAN = truthy("AX_CODE_DEBUG_ENGINE_NATIVE_SCAN")

  // LSP response cache (Semantic Trust Layer PRD §S2). Opt-in for the
  // first release window. When on, LSP.referencesEnvelope and
  // LSP.documentSymbolEnvelope check code_intel_lsp_cache before
  // issuing an LSP RPC and populate it on every successful `full`
  // result. Correctness is content-addressable (see schema comment).
  export const AX_CODE_LSP_CACHE = truthy("AX_CODE_LSP_CACHE")

  // Semantic audit write mode (Semantic Trust Layer PRD §S3).
  // Off (default): queue-by-default. AI tool calls never block on
  //   audit write. Queue is flushed on tick boundary and on session
  //   teardown; last ~50ms of rows may be lost on a hard crash.
  // On (=1 / true): synchronous write. Blocks tool completion until
  //   the row is durable. Compliance mode only.
  export const AX_CODE_AUDIT_SYNC = truthy("AX_CODE_AUDIT_SYNC")

  // Nerd Font glyphs in the TUI. Tri-state:
  //   AX_CODE_NERD_FONT=1/true  → force ON
  //   AX_CODE_NERD_FONT=0/false → force OFF
  //   unset                     → fall through to user kv preference
  // Resolved at runtime in src/cli/cmd/tui/ui/glyphs.ts.
  export const AX_CODE_NERD_FONT_ENV = (() => {
    const value = process.env["AX_CODE_NERD_FONT"]?.toLowerCase()
    if (value === "1" || value === "true") return true
    if (value === "0" || value === "false") return false
    return undefined
  })()

  // Experimental
  export const AX_CODE_EXPERIMENTAL = truthy("AX_CODE_EXPERIMENTAL")
  export const AX_CODE_EXPERIMENTAL_FILEWATCHER = Config.boolean("AX_CODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  )
  export const AX_CODE_EXPERIMENTAL_DISABLE_FILEWATCHER = Config.boolean(
    "AX_CODE_EXPERIMENTAL_DISABLE_FILEWATCHER",
  ).pipe(Config.withDefault(false))
  export const AX_CODE_EXPERIMENTAL_ICON_DISCOVERY =
    AX_CODE_EXPERIMENTAL || truthy("AX_CODE_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["AX_CODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const AX_CODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("AX_CODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const AX_CODE_ENABLE_EXA =
    truthy("AX_CODE_ENABLE_EXA") || AX_CODE_EXPERIMENTAL || truthy("AX_CODE_EXPERIMENTAL_EXA")
  export const AX_CODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("AX_CODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const AX_CODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("AX_CODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const AX_CODE_EXPERIMENTAL_OXFMT = AX_CODE_EXPERIMENTAL || truthy("AX_CODE_EXPERIMENTAL_OXFMT")
  export const AX_CODE_EXPERIMENTAL_LSP_TY = truthy("AX_CODE_EXPERIMENTAL_LSP_TY")
  export const AX_CODE_EXPERIMENTAL_LSP_TOOL = AX_CODE_EXPERIMENTAL || truthy("AX_CODE_EXPERIMENTAL_LSP_TOOL")
  export declare const AX_CODE_EXPERIMENTAL_QUALITY_SHADOW: boolean
  export declare const AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL: string | undefined
  export declare const AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS: string | undefined
  // Code Intelligence (v3 graph-backed symbol index) and the Debugging &
  // Refactoring Engine default to ON as of v2.3.4. DRE depends on code
  // intelligence, so they graduate together — shipping DRE on without
  // its data source would produce uniformly empty results and look
  // broken. Users who hit problems can opt out with
  // `AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE=0` or
  // `AX_CODE_EXPERIMENTAL_DEBUG_ENGINE=0`, matching the pattern
  // AX_CODE_EXPERIMENTAL_MARKDOWN already uses (default-on with a
  // negative opt-out). See PRD-debug-refactor-engine-ui-tier-3.md §6.6
  // for the graduation record.
  export const AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE = !falsy("AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE")
  export const AX_CODE_EXPERIMENTAL_DEBUG_ENGINE = !falsy("AX_CODE_EXPERIMENTAL_DEBUG_ENGINE")
  // Auto-index fires a background code-intelligence index when a
  // session starts against an empty or missing graph, so users no
  // longer need to run `ax-code index` manually before DRE tools
  // produce useful results. Opt-out via `AX_CODE_DISABLE_AUTO_INDEX=1`
  // if the automatic run is undesirable (e.g. very large projects
  // where a user wants to control indexing timing, CI environments,
  // or debugging the indexer itself). Default-on so the DRE UI
  // rows populate themselves without user intervention. See v2.3.9
  // release notes.
  export const AX_CODE_DISABLE_AUTO_INDEX = truthy("AX_CODE_DISABLE_AUTO_INDEX")
  export const AX_CODE_DISABLE_FILETIME_CHECK = Config.boolean("AX_CODE_DISABLE_FILETIME_CHECK").pipe(
    Config.withDefault(false),
  )
  export const AX_CODE_EXPERIMENTAL_PLAN_MODE = AX_CODE_EXPERIMENTAL || truthy("AX_CODE_EXPERIMENTAL_PLAN_MODE")
  export const AX_CODE_EXPERIMENTAL_WORKSPACES = AX_CODE_EXPERIMENTAL || truthy("AX_CODE_EXPERIMENTAL_WORKSPACES")
  export const AX_CODE_EXPERIMENTAL_MARKDOWN = !falsy("AX_CODE_EXPERIMENTAL_MARKDOWN")
  export const AX_CODE_MODELS_URL = process.env["AX_CODE_MODELS_URL"]
  export const AX_CODE_MODELS_PATH = process.env["AX_CODE_MODELS_PATH"]
  export const AX_CODE_DB = process.env["AX_CODE_DB"]
  export const AX_CODE_DISABLE_CHANNEL_DB = truthy("AX_CODE_DISABLE_CHANNEL_DB")
  export const AX_CODE_SKIP_MIGRATIONS = truthy("AX_CODE_SKIP_MIGRATIONS")
  export const AX_CODE_STRICT_CONFIG_DEPS = truthy("AX_CODE_STRICT_CONFIG_DEPS")

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for AX_CODE_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "AX_CODE_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("AX_CODE_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for AX_CODE_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "AX_CODE_TUI_CONFIG", {
  get() {
    return process.env["AX_CODE_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for AX_CODE_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "AX_CODE_CONFIG_DIR", {
  get() {
    return process.env["AX_CODE_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for AX_CODE_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "AX_CODE_CLIENT", {
  get() {
    return process.env["AX_CODE_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for AX_CODE_ISOLATION_MODE
// Must be evaluated at access time because --sandbox CLI flag
// sets the env var in yargs middleware after module load
Object.defineProperty(Flag, "AX_CODE_ISOLATION_MODE", {
  get() {
    const v = process.env["AX_CODE_ISOLATION_MODE"]
    if (v === "read-only" || v === "workspace-write" || v === "full-access") return v
    return undefined
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for AX_CODE_ISOLATION_NETWORK
Object.defineProperty(Flag, "AX_CODE_ISOLATION_NETWORK", {
  get() {
    const v = process.env["AX_CODE_ISOLATION_NETWORK"]?.toLowerCase()
    if (v === "true" || v === "1") return true
    if (v === "false" || v === "0") return false
    return undefined
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for AX_CODE_EXPERIMENTAL_QUALITY_SHADOW
// This must be evaluated at access time so tests and internal tools can
// enable or disable live shadow logging without reloading the module graph.
Object.defineProperty(Flag, "AX_CODE_EXPERIMENTAL_QUALITY_SHADOW", {
  get() {
    return truthy("AX_CODE_EXPERIMENTAL_QUALITY_SHADOW")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS
// The path is consumed by the runtime shadow logger and may be injected
// by wrappers or tests after module load.
Object.defineProperty(Flag, "AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL", {
  get() {
    return process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS
// The path is consumed by the runtime shadow logger and may be injected
// by wrappers or tests after module load.
Object.defineProperty(Flag, "AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS", {
  get() {
    return process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS"]
  },
  enumerable: true,
  configurable: false,
})
