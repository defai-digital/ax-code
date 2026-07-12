import { Env } from "../util/env"

function truthy(key: string) {
  return Env.parseBoolean(process.env[key]) === true
}

function falsy(key: string) {
  return Env.parseBoolean(process.env[key]) === false
}

function defineStringFlag(name: string, fallback?: string) {
  Object.defineProperty(Flag, name, {
    get() {
      return process.env[name] ?? fallback
    },
    enumerable: true,
    configurable: false,
  })
}

function defineBooleanFlag(name: string, fallback = false) {
  Object.defineProperty(Flag, name, {
    get() {
      const parsed = Env.parseBoolean(process.env[name])
      return parsed ?? fallback
    },
    enumerable: true,
    configurable: false,
  })
}

function defineBooleanFlagWithOverride(name: string, overrideName: string, fallback = false) {
  Object.defineProperty(Flag, name, {
    get() {
      const override = Env.parseBoolean(process.env[overrideName])
      if (override !== undefined) return override
      const parsed = Env.parseBoolean(process.env[name])
      return parsed ?? fallback
    },
    enumerable: true,
    configurable: false,
  })
}

export function parsePositiveIntegerFlagValue(value: string | undefined) {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

export namespace Flag {
  export const AX_CODE_GIT_BASH_PATH = process.env["AX_CODE_GIT_BASH_PATH"]
  export const AX_CODE_CONFIG = process.env["AX_CODE_CONFIG"]
  export declare const AX_CODE_TUI_CONFIG: string | undefined
  export declare const AX_CODE_CONFIG_DIR: string | undefined
  export declare const AX_CODE_CONFIG_CONTENT: string | undefined
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
  export declare const AX_CODE_AUTONOMOUS: boolean
  export declare const AX_CODE_SMART_LLM: boolean
  export declare const AX_CODE_WORKFLOW_RUNTIME: boolean
  export declare const AX_CODE_TUI_SESSION_FIRST: boolean
  export declare const AX_CODE_TUI_DISABLE_WORKFLOW_DASHBOARD_POLL: boolean
  export declare const AX_CODE_SUPER_LONG: boolean
  export declare const AX_CODE_CALLER: string | undefined
  export declare const AX_CODE_ORIGINAL_CWD: string | undefined
  export declare const AX_CODE_PROFILE_NATIVE: boolean
  export declare const AX_CODE_DEBUG: boolean
  export declare const AX_CODE_DEBUG_DIR: string | undefined
  export declare const AX_CODE_DEBUG_INCLUDE_CONTENT: boolean | undefined
  export declare const AX_CODE_PRINT_LOGS: boolean
  export declare const AX_CODE_TEST_HOME: string | undefined
  export declare const AX_CODE_TEST_MANAGED_CONFIG_DIR: string | undefined
  export const AX_CODE_FAKE_VCS = process.env["AX_CODE_FAKE_VCS"]
  export declare const AX_CODE_CLIENT: string
  export declare const AX_CODE_INTERNAL_BASE_URL: string | undefined
  export declare const AX_CODE_OTLP_ENDPOINT: string | undefined
  export const AX_CODE_SERVER_PASSWORD = process.env["AX_CODE_SERVER_PASSWORD"]
  export const AX_CODE_SERVER_USERNAME = process.env["AX_CODE_SERVER_USERNAME"]
  export declare const AX_CODE_ENABLE_HTTP_DOCS: boolean
  // Acknowledge and suppress the plaintext-Basic-Auth-over-non-loopback warning.
  // See #250.
  export declare const AX_CODE_ALLOW_INSECURE_NETWORK_AUTH: boolean
  export const AX_CODE_ENABLE_QUESTION_TOOL = truthy("AX_CODE_ENABLE_QUESTION_TOOL")
  export declare const AX_CODE_ISOLATION_MODE: "read-only" | "workspace-write" | "full-access" | undefined
  export declare const AX_CODE_ISOLATION_NETWORK: boolean | undefined
  export declare const AX_CODE_ISOLATION_BACKEND: "app" | "os" | "auto" | undefined

  // Native Rust addons — default ON (opt-out with =0 or =false).
  // These dispatch CPU-bound operations to Rust native addons via NAPI-RS.
  // If the native addon isn't installed, the TypeScript fallback runs
  // transparently via try/catch in each dispatch point.
  //
  // Defined as runtime getters (see defineBooleanFlag below) so test
  // harnesses and embedders that mutate process.env after module load
  // see the new value. The previous `export const` form captured the
  // flag at import time and could not be flipped at runtime.
  export declare const AX_CODE_NATIVE_INDEX: boolean
  export declare const AX_CODE_NATIVE_FS: boolean
  export declare const AX_CODE_NATIVE_DIFF: boolean
  export declare const AX_CODE_NATIVE_PARSER: boolean
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
    const value = Env.parseBoolean(process.env["AX_CODE_NERD_FONT"])
    return value
  })()

  // Experimental
  export const AX_CODE_EXPERIMENTAL = truthy("AX_CODE_EXPERIMENTAL")
  export declare const AX_CODE_EXPERIMENTAL_FILEWATCHER: boolean
  export declare const AX_CODE_EXPERIMENTAL_DISABLE_FILEWATCHER: boolean
  export const AX_CODE_EXPERIMENTAL_ICON_DISCOVERY =
    AX_CODE_EXPERIMENTAL || truthy("AX_CODE_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["AX_CODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const AX_CODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : Env.parseBoolean(copy) === true
  export const AX_CODE_ENABLE_EXA =
    truthy("AX_CODE_ENABLE_EXA") || AX_CODE_EXPERIMENTAL || truthy("AX_CODE_EXPERIMENTAL_EXA")
  export const AX_CODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("AX_CODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const AX_CODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("AX_CODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  // Alibaba (DashScope + Token Plan) reserves `prompt + max_tokens` against a
  // sliding short-window quota *before* generation. Set this to lower the
  // per-request output cap below the built-in default — e.g. 2048 for noisy
  // accounts, 1024 for very aggressive throttling.
  export const AX_CODE_ALIBABA_OUTPUT_TOKEN_MAX = number("AX_CODE_ALIBABA_OUTPUT_TOKEN_MAX")
  // Groq rate limits are also evaluated against requested output reservation.
  // Set before launching ax-code to lower/raise the built-in Groq request cap.
  export const AX_CODE_GROQ_OUTPUT_TOKEN_MAX = number("AX_CODE_GROQ_OUTPUT_TOKEN_MAX")
  export const AX_CODE_EXPERIMENTAL_OXFMT = AX_CODE_EXPERIMENTAL || truthy("AX_CODE_EXPERIMENTAL_OXFMT")
  export const AX_CODE_EXPERIMENTAL_LSP_TY = truthy("AX_CODE_EXPERIMENTAL_LSP_TY")
  export const AX_CODE_EXPERIMENTAL_LSP_TOOL = AX_CODE_EXPERIMENTAL || truthy("AX_CODE_EXPERIMENTAL_LSP_TOOL")
  // Ratatui TUI (ADR-035): Experimental native Rust TUI client that connects
  // to the headless ax-code server via HTTP/SSE. Enable with =1 to access the
  // lean terminal UI for testing and development.
  export const AX_CODE_EXPERIMENTAL_RATATUI_TUI = truthy("AX_CODE_EXPERIMENTAL_RATATUI_TUI")
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
  export declare const AX_CODE_DISABLE_FILETIME_CHECK: boolean
  export const AX_CODE_EXPERIMENTAL_PLAN_MODE = AX_CODE_EXPERIMENTAL || truthy("AX_CODE_EXPERIMENTAL_PLAN_MODE")
  export const AX_CODE_EXPERIMENTAL_WORKSPACES = AX_CODE_EXPERIMENTAL || truthy("AX_CODE_EXPERIMENTAL_WORKSPACES")
  export const AX_CODE_EXPERIMENTAL_MARKDOWN = !falsy("AX_CODE_EXPERIMENTAL_MARKDOWN")
  export declare const AX_CODE_MODELS_URL: string | undefined
  export declare const AX_CODE_MODELS_PATH: string | undefined
  export const AX_CODE_DB = process.env["AX_CODE_DB"]
  export const AX_CODE_DISABLE_CHANNEL_DB = truthy("AX_CODE_DISABLE_CHANNEL_DB")
  export const AX_CODE_SKIP_MIGRATIONS = truthy("AX_CODE_SKIP_MIGRATIONS")
  export const AX_CODE_STRICT_CONFIG_DEPS = truthy("AX_CODE_STRICT_CONFIG_DEPS")
  // Visual Browser Agent (ADR-047): snapshot-first browser automation for
  // local web UI review and repair. Gated behind feature flag until the
  // Playwright runtime dependency and permission model are stable.
  export const AX_CODE_EXPERIMENTAL_BROWSER_AGENT = AX_CODE_EXPERIMENTAL || truthy("AX_CODE_EXPERIMENTAL_BROWSER_AGENT")
  // Visual artifact storage: enables `.ax-code/visual-runs/` directory
  // for screenshot, DOM, console, and network evidence from visual runs.
  export const AX_CODE_EXPERIMENTAL_VISUAL_ARTIFACTS =
    AX_CODE_EXPERIMENTAL || truthy("AX_CODE_EXPERIMENTAL_VISUAL_ARTIFACTS")

  function number(key: string) {
    return parsePositiveIntegerFlagValue(process.env[key])
  }
}

// Dynamic getters for runtime-injected flags.
// Keep these access-time rather than import-time so CLI middleware, test
// harnesses, and wrappers can set process.env after modules are loaded.

// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
defineBooleanFlag("AX_CODE_DISABLE_PROJECT_CONFIG")

// This must be evaluated at access time so runtime toggles (server routes/tests)
// remain immediately effective.
// On by default as the documented product posture (docs/autonomous.md):
// autonomous pairs with the default sandbox (workspace-write, network off).
// Config `autonomous: false` is reconciled into this env at config load.
defineBooleanFlag("AX_CODE_AUTONOMOUS", true)

// Evaluate each access so toggles and env overrides remain live.
defineBooleanFlag("AX_CODE_SMART_LLM")

defineBooleanFlag("AX_CODE_EXPERIMENTAL_FILEWATCHER")

defineBooleanFlag("AX_CODE_EXPERIMENTAL_DISABLE_FILEWATCHER")

// Dynamic workflow runtime is off by default until the scheduler, storage,
// TUI, and permission surfaces are wired behind the same runtime contract.
defineBooleanFlag("AX_CODE_WORKFLOW_RUNTIME")

// Evaluate at access time so runtime toggles remain immediately effective.
// The session override is set by the Super-Long route and must match the
// route's GET precedence so the reported state and runtime behavior agree.
defineBooleanFlagWithOverride("AX_CODE_SUPER_LONG", "AX_CODE_SUPER_LONG_SESSION_OVERRIDE")

// Evaluate at access time so test/runtime overrides can be flipped
// without requiring a module reload.

// Some IDE detection paths read this at request time.
defineStringFlag("AX_CODE_CALLER")

// Keep evaluation lazy so launch-time overrides remain effective.
defineStringFlag("AX_CODE_ORIGINAL_CWD")

defineBooleanFlag("AX_CODE_PROFILE_NATIVE")

// Keep evaluation lazy so debug settings injected by bootstrap stay effective.
defineBooleanFlag("AX_CODE_DEBUG")

defineStringFlag("AX_CODE_DEBUG_DIR")

defineBooleanFlag("AX_CODE_DEBUG_INCLUDE_CONTENT")

defineBooleanFlag("AX_CODE_PRINT_LOGS")

// Keep evaluation lazy so test-only overrides set during runtime remain effective.
defineStringFlag("AX_CODE_TEST_HOME")

// Keep evaluation lazy so tests and bootstrap paths can override this at runtime.
defineStringFlag("AX_CODE_TEST_MANAGED_CONFIG_DIR")

defineStringFlag("AX_CODE_INTERNAL_BASE_URL")

defineStringFlag("AX_CODE_OTLP_ENDPOINT")

// The live OpenAPI docs route is gated at request time, so tests and
// wrappers can opt in without reloading the server module graph.
defineBooleanFlag("AX_CODE_ENABLE_HTTP_DOCS")

// Plaintext HTTP Basic Auth over non-loopback is risky; this flag lets a user
// who understands the threat model (e.g. isolated test network) acknowledge it
// and silence the startup warning. See #250.
defineBooleanFlag("AX_CODE_ALLOW_INSECURE_NETWORK_AUTH")

// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
defineStringFlag("AX_CODE_TUI_CONFIG")

// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
defineStringFlag("AX_CODE_CONFIG_DIR")

// Inline config is commonly injected by test harnesses and wrappers after
// module load, so read it at access time.
defineStringFlag("AX_CODE_CONFIG_CONTENT")

defineStringFlag("AX_CODE_MODELS_URL")

defineStringFlag("AX_CODE_MODELS_PATH")

// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
defineStringFlag("AX_CODE_CLIENT", "cli")

// Runtime-refreshable getters for the native-addon flags. Default ON:
// returns false only if the env var is explicitly set to "false" or "0".
// Matches the previous !falsy() semantic but evaluated on every access.
defineBooleanFlag("AX_CODE_NATIVE_INDEX", true)
defineBooleanFlag("AX_CODE_NATIVE_FS", true)
defineBooleanFlag("AX_CODE_NATIVE_DIFF", true)
defineBooleanFlag("AX_CODE_NATIVE_PARSER", true)

defineBooleanFlag("AX_CODE_DISABLE_FILETIME_CHECK")

// Session-first TUI launch is off by default (ADR-035). When enabled, the TUI
// auto-resumes the most recent session instead of landing on the home/new-session
// screen. Opt in with AX_CODE_TUI_SESSION_FIRST=1 for the session-first behavior.
defineBooleanFlag("AX_CODE_TUI_SESSION_FIRST")

// Periodic workflow dashboard polling adds background fetches every 10s when
// AX_CODE_WORKFLOW_RUNTIME is enabled. Disable with this flag to reduce startup
// overhead and terminal polling (ADR-035). The one-shot bootstrap fetch is unaffected.
defineBooleanFlag("AX_CODE_TUI_DISABLE_WORKFLOW_DASHBOARD_POLL")

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

// Dynamic getter for AX_CODE_ISOLATION_BACKEND (app | os | auto)
Object.defineProperty(Flag, "AX_CODE_ISOLATION_BACKEND", {
  get() {
    const v = process.env["AX_CODE_ISOLATION_BACKEND"]?.toLowerCase()
    if (v === "app" || v === "os" || v === "auto") return v
    return undefined
  },
  enumerable: true,
  configurable: false,
})

// This must be evaluated at access time so tests and internal tools can
// enable or disable live shadow logging without reloading the module graph.
defineBooleanFlag("AX_CODE_EXPERIMENTAL_QUALITY_SHADOW")

// The path is consumed by the runtime shadow logger and may be injected
// by wrappers or tests after module load.
defineStringFlag("AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL")

// The path is consumed by the runtime shadow logger and may be injected
// by wrappers or tests after module load.
defineStringFlag("AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS")
