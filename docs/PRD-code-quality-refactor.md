# Product Requirements Document (PRD)
# AX Code — Code Quality & Maintainability Refactor

**Document Version:** 1.0
**Date:** 2026-04-02
**Author:** Engineering Team
**Status:** Draft

---

## 1. Overview

### 1.1 Problem Statement

The AX Code codebase (inherited from OpenCode + ax-cli merge) has accumulated significant technical debt that impairs maintainability, increases the risk of bugs, and slows down feature development:

- **Code duplication** — identical functions and constants defined in 2-4 places
- **Hardcoded values** — 40+ URLs, 30+ magic numbers, 15+ filenames scattered across 100+ files instead of centralized
- **Large monolithic files** — 6 files exceed 1,000 LOC (largest: 2,284 LOC with 62 imports)
- **Deep directory nesting** — up to 14 levels, causing `../../../..` import chains
- **No centralized constants** — changing a default port, URL, or limit requires editing 8+ files
- **Repetitive patterns** — tool registration, agent definitions, and provider setup follow identical boilerplate that isn't abstracted

### 1.2 Goals

1. **Centralize all hardcoded values** into constant/config modules so any value can be changed in one place
2. **Eliminate code duplication** — shared functions, constants, and patterns defined exactly once
3. **Externalize configuration** into YAML files for values that may change per deployment or over time
4. **Improve module structure** — break large files, flatten directories, reduce coupling
5. **Reduce boilerplate** in repetitive patterns (tools, agents, providers)

### 1.3 Non-Goals

- Rewriting business logic (only restructuring)
- Changing public APIs or CLI behavior
- Performance optimization (unless it falls out of refactoring naturally)
- Adding new features

### 1.4 Success Criteria

| Metric | Before | Target |
|--------|--------|--------|
| Files with duplicate constants | 12+ | 0 |
| Hardcoded URL instances | 40+ | 1 per URL (in constants file) |
| Hardcoded magic numbers | 30+ | 0 (all in constants or YAML) |
| Max file LOC | 2,284 | < 500 |
| Max directory depth | 14 | 7 |
| Files with > 30 imports | 6 | 0 |
| Duplicate function implementations | 2+ (levenshtein, diagnostics) | 0 |

---

## 2. Audit Findings

### 2.1 Duplicate Constants

| Constant | Value | Defined In | Should Be |
|----------|-------|------------|-----------|
| `MAX_DIAGNOSTICS_PER_FILE` | 20 | `constants.ts`, `write.ts`, `edit.ts`, `apply_patch.ts` | `constants.ts` only |
| `MAX_LINE_LENGTH` | 2000 | `constants.ts`, `read.ts`, `grep.ts` | `constants.ts` only |
| `MAX_BYTES` | 50×1024 | `constants.ts`, `read.ts` | `constants.ts` only |
| Default port | 4096 | 8 locations across CLI, server, app, plugin | `constants/server.yaml` |
| `DEFAULT_TIMEOUT` | 30000 | `webfetch.ts`, `bash.ts`, `mcp/index.ts` | `constants/timeouts.yaml` |
| `MAX_*_SESSIONS` | 20 | 4 app components | `constants/cache.yaml` |

### 2.2 Duplicate Functions

| Function | Locations | Resolution |
|----------|-----------|------------|
| `levenshtein()` | `provider/provider.ts:32`, `tool/edit.ts:179` | Extract to `util/levenshtein.ts` |
| Diagnostic limiting logic | `write.ts`, `edit.ts`, `apply_patch.ts` | Use shared `diagnostics.ts` (already exists, not used everywhere) |
| Session cache eviction | 4 app components | Extract `LRUSessionCache` utility |

### 2.3 Hardcoded Values by Category

**URLs (40+ instances):**
- `ax-code.ai` — 15+ references (docs, zen, install, config schema, changelog, favicon)
- `api.ax-code.ai` — 5+ references (OIDC, GitHub app, token exchange)
- `app.ax-code.ai` — proxy target in server
- `opncd.ai` — enterprise fallback
- `models.dev` — model schema
- `mcp.exa.ai` — MCP discovery

**Filenames (15+ instances):**
- `ax-code.json`, `ax-code.jsonc` — config files referenced in 10+ places
- `.ax-code/` — directory name in 8+ places
- `AX.md` — context file in 10+ places
- `tui.json` — TUI config in 3+ places

**Magic Numbers (30+ instances):**
- Token limits: 2000, 500, 200, 50, 5000, 200000, 4000
- Timeouts: 5000, 30000, 120000, 2147483647
- Limits: 20, 100, 500, 2000
- Ports: 4096, 19876

**Provider IDs (scattered):**
- `"google"`, `"xai"`, `"groq"`, `"ax-code"` used as string literals in 10+ files

### 2.4 Large Files

| File | LOC | Imports | Problem |
|------|-----|---------|---------|
| `cli/cmd/tui/routes/session/index.tsx` | 2,284 | 62 | UI god component |
| `session/prompt.ts` | 2,106 | 53 | Orchestration hub doing everything |
| `lsp/server.ts` | 2,093 | — | LSP protocol complexity |
| `agent/agent.ts` | 1,743 | 27 | Agent definitions + permission setup |
| `cli/cmd/github.ts` | 1,633 | — | GitHub integration |
| `config/config.ts` | 1,472 | 34 | Config loading + validation + schema |
| `provider/provider.ts` | 1,021 | 28 | Provider registration monolith |

---

## 3. Solution Design

### Phase 1: Centralize Constants & Eliminate Duplication (1-2 days)

#### 3.1 Create YAML Config Files

Create `packages/ax-code/src/constants/` with YAML files for values that may change:

**`urls.yaml`:**
```yaml
domains:
  base: "https://ax-code.ai"
  api: "https://api.ax-code.ai"
  app: "https://app.ax-code.ai"
  dev: "https://dev.ax-code.ai"
  enterprise: "https://opncd.ai"
  models: "https://models.dev"

paths:
  docs: "/docs"
  zen: "/zen"
  install: "/install"
  configSchema: "/config.json"
  tuiSchema: "/tui.json"
  changelog: "/changelog.json"
  download: "/download"
  themes: "/docs/themes/"
  agents: "/docs/agents"
  commands: "/docs/commands"
  providers: "/docs/providers/"

mcp:
  exa: "https://mcp.exa.ai/mcp"
```

**`limits.yaml`:**
```yaml
tool:
  maxDiagnosticsPerFile: 20
  maxProjectDiagnosticsFiles: 5
  maxLineLength: 2000
  maxBytes: 51200  # 50 * 1024
  maxReadLines: 2000
  grepLimit: 100
  fileLimit: 100
  codesearchDefaultTokens: 5000

session:
  globalStepLimit: 200
  maxConsecutiveErrors: 3
  contextOver200kThreshold: 200000

token:
  basePerPhase: 2000
  perObjective: 500
  coordinationOverhead: 200
  perSecond: 50
  defaultMemory: 4000

cache:
  maxSessions: 20
  maxStash: 50
  maxHistory: 1000
  maxViewFiles: 500
  maxFrecency: 1000
```

**`timeouts.yaml`:**
```yaml
webfetch: 30000
webfetchMax: 120000
sqliteBusy: 5000
mcpDefault: 30000
retryMaxDelay: 2147483647
retryMaxDelayNoHeaders: 30000
retryInitialDelay: 2000
```

**`server.yaml`:**
```yaml
defaultPort: 4096
defaultHost: "127.0.0.1"
oauthCallbackPort: 19876
oauthCallbackPath: "/mcp/oauth/callback"
```

**`filenames.yaml`:**
```yaml
config:
  main: "ax-code.json"
  mainJsonc: "ax-code.jsonc"
  tui: "tui.json"
  context: "AX.md"
  memory: "memory.json"

directories:
  root: ".ax-code"
  plans: ".ax-code/plans"
  agents: ".ax-code/agent"
  commands: ".ax-code/command"
```

**`github.yaml`:**
```yaml
workflowFile: ".github/workflows/ax-code.yml"
agentUsername: "ax-code-agent[bot]"
agentEmailDomain: "users.noreply.github.com"
ideExtensionId: "sst-dev.ax-code"
```

#### 3.2 Create TypeScript Loader

**`packages/ax-code/src/constants/index.ts`:**
```typescript
import urls from "./urls.yaml"
import limits from "./limits.yaml"
import timeouts from "./timeouts.yaml"
import server from "./server.yaml"
import filenames from "./filenames.yaml"
import github from "./github.yaml"

export const URLS = urls
export const LIMITS = limits
export const TIMEOUTS = timeouts
export const SERVER = server
export const FILENAMES = filenames
export const GITHUB = github
```

#### 3.3 Fix Duplicate Functions

- Extract `levenshtein()` to `packages/ax-code/src/util/levenshtein.ts` (use the optimized O(n) space version from `edit.ts`)
- Update `provider/provider.ts` and `tool/edit.ts` to import from shared module
- Ensure all tool files import `MAX_DIAGNOSTICS_PER_FILE` from `tool/constants.ts` instead of redefining

#### 3.4 Update All References

Systematically replace hardcoded values with imports from the constants module. Estimated ~80 files affected.

---

### Phase 2: Break Large Files (3-5 days)

#### 3.5 Split `session/prompt.ts` (2,106 LOC → 5 files)

```
session/
├── prompt.ts              (~400 LOC) Core orchestration loop
├── prompt-builder.ts      (~300 LOC) System/user message construction
├── tool-executor.ts       (~400 LOC) Tool execution + error handling
├── llm-caller.ts          (~300 LOC) LLM API call wrapper + retry
├── permission-handler.ts  (~200 LOC) Permission check + user prompts
└── step-tracker.ts        (~200 LOC) Step counting, abort, limits
```

#### 3.6 Split `provider/provider.ts` (1,021 LOC → loader-per-file)

```
provider/
├── provider.ts            (~300 LOC) Core provider interface + merge logic
├── registry.ts            (~200 LOC) Provider registration + discovery
├── env-loader.ts          (~100 LOC) Environment variable loading
├── loaders/
│   ├── index.ts           (barrel export)
│   ├── ax-code.ts
│   ├── xai.ts
│   ├── bedrock.ts
│   ├── sap-ai-core.ts
│   └── ...                (one file per custom loader)
└── (existing files: schema.ts, transform.ts, error.ts, auth.ts)
```

#### 3.7 Split `agent/agent.ts` (1,743 LOC → definitions + builder)

```
agent/
├── agent.ts               (~200 LOC) Agent interface + loader
├── builder.ts             (~100 LOC) createAgent() factory with permission presets
├── permission-presets.ts  (~100 LOC) Reusable permission configs
├── definitions/
│   ├── build.ts
│   ├── plan.ts
│   ├── security.ts
│   ├── architect.ts
│   ├── debug.ts
│   ├── perf.ts
│   ├── react.ts
│   ├── general.ts
│   └── explore.ts
└── (existing files: router.ts, prompt/)
```

#### 3.8 Split TUI Session Route (2,284 LOC)

```
cli/cmd/tui/routes/session/
├── index.tsx              (~300 LOC) Main layout + composition
├── header.tsx             (~200 LOC) Session header, model info
├── transcript.tsx         (~400 LOC) Message list rendering
├── input.tsx              (~300 LOC) Prompt input area
├── permission.tsx         (~200 LOC) Permission dialogs
├── sidebar.tsx            (keep as is)
└── ...
```

---

### Phase 3: Reduce Boilerplate Patterns (2-3 days)

#### 3.9 Tool Registration Factory

Replace per-tool boilerplate with a factory:

```typescript
// Before (each tool file):
export const BashTool = Tool.define("bash", async () => ({
  description: DESCRIPTION,
  parameters: z.object({ ... }),
  execute: async (params, ctx) => { ... }
}))

// After (tool factory handles description loading, registration):
export const BashTool = Tool.create({
  id: "bash",
  parameters: z.object({ ... }),
  execute: async (params, ctx) => { ... }
})
```

The factory auto-loads `bash.txt` description file, registers in the tool registry, and handles common patterns (diagnostics, file tracking).

#### 3.10 Agent Builder

Replace repetitive agent definitions:

```typescript
// Before (per agent, ~30 lines each):
build: {
  name: "build",
  description: "The default agent...",
  permission: Permission.merge(defaults, Permission.fromConfig({
    question: "allow", plan_enter: "allow"
  }), user),
  mode: "primary",
  native: true,
}

// After:
build: Agent.build("build", {
  description: "The default agent...",
  permissions: { question: "allow", plan_enter: "allow" },
  mode: "primary",
})
```

#### 3.11 App Session Cache Abstraction

Replace 4 identical cache implementations with shared utility:

```typescript
// Before (repeated in 4 components):
const sessions = new Map<string, Data>()
function getOrCreate(sessionID: string) { ... }
function evict() { if (sessions.size > 20) ... }

// After:
const sessions = new SessionCache<Data>(LIMITS.cache.maxSessions)
sessions.getOrCreate(sessionID, () => createData())
```

---

### Phase 4: Flatten Directory Structure (1-2 days)

#### 3.12 CLI Directory Restructuring

```
BEFORE (14 levels max):
cli/cmd/tui/component/prompt/part.tsx
cli/cmd/tui/routes/session/index.tsx
cli/cmd/tui/context/theme/aura.json

AFTER (7 levels max):
cli/tui/components/prompt-part.tsx
cli/tui/routes/session.tsx
cli/tui/themes/aura.json
```

Update all imports. Use TypeScript path aliases (`@tui/*`) to keep imports clean.

---

## 4. Implementation Plan

### Phase 1: Constants & Deduplication (Priority: Critical)

| Task | Effort | Files Affected |
|------|--------|----------------|
| Create YAML config files (6 files) | 2h | New files |
| Create constants loader (`constants/index.ts`) | 1h | New file |
| Replace hardcoded URLs across codebase | 4h | ~25 files |
| Replace hardcoded limits/timeouts | 3h | ~20 files |
| Replace hardcoded filenames | 2h | ~15 files |
| Extract shared `levenshtein()` | 30m | 3 files |
| Fix duplicate constants in tool files | 30m | 4 files |
| Fix duplicate diagnostic logic | 1h | 3 files |

**Total: ~14 hours (1-2 days)**

### Phase 2: Large File Decomposition (Priority: High)

| Task | Effort | Risk |
|------|--------|------|
| Split `session/prompt.ts` | 8h | Medium (core orchestration) |
| Split `provider/provider.ts` | 6h | Medium (provider loading) |
| Split `agent/agent.ts` | 4h | Low (definitions only) |
| Split TUI session route | 6h | Medium (UI state) |
| Split `config/config.ts` | 4h | Low |

**Total: ~28 hours (3-5 days)**

### Phase 3: Pattern Reduction (Priority: Medium)

| Task | Effort | Risk |
|------|--------|------|
| Tool registration factory | 4h | Low |
| Agent builder pattern | 3h | Low |
| App session cache abstraction | 2h | Low |
| Provider plugin extension point | 4h | Medium |

**Total: ~13 hours (2-3 days)**

### Phase 4: Directory Flattening (Priority: Low)

| Task | Effort | Risk |
|------|--------|------|
| Flatten CLI/TUI directories | 4h | Low (import updates) |
| Update path aliases | 1h | Low |
| Verify no broken imports | 2h | Low |

**Total: ~7 hours (1-2 days)**

---

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Import breakage during refactor | High | Medium | Run `bun typecheck` after each phase |
| Runtime behavior change | Medium | High | No logic changes — only restructuring. Run full test suite after each phase |
| Merge conflicts with parallel work | Medium | Medium | Do one phase at a time, merge to main before starting next |
| YAML loader adds startup overhead | Low | Low | YAML files are small (<1KB), loaded once at startup |

---

## 6. Testing Strategy

Each phase must pass before proceeding:

1. **Type checking**: `bun typecheck` — zero errors
2. **Test suite**: `bun test` — all existing tests pass
3. **Smoke test**: `ax-code --version`, `ax-code serve`, TUI launch
4. **Grep verification**: `grep -rn "HARDCODED_VALUE" src/` returns 0 matches for migrated values

---

## 7. Timeline

| Phase | Duration | Depends On |
|-------|----------|------------|
| Phase 1: Constants & Dedup | 1-2 days | — |
| Phase 2: File Decomposition | 3-5 days | Phase 1 |
| Phase 3: Pattern Reduction | 2-3 days | Phase 2 |
| Phase 4: Directory Flattening | 1-2 days | Phase 3 |
| **Total** | **7-12 days** | |

---

## 8. Appendix: File Inventory

### Constants to Create

| YAML File | Keys | Replaces |
|-----------|------|----------|
| `urls.yaml` | 15 | 40+ hardcoded URL strings |
| `limits.yaml` | 20 | 30+ magic numbers |
| `timeouts.yaml` | 7 | 10+ scattered timeout values |
| `server.yaml` | 4 | 8+ port/host references |
| `filenames.yaml` | 9 | 15+ filename strings |
| `github.yaml` | 3 | 5+ GitHub-specific constants |

### Functions to Deduplicate

| Function | From | To |
|----------|------|----|
| `levenshtein()` | `provider/provider.ts`, `tool/edit.ts` | `util/levenshtein.ts` |
| Diagnostic limiter | `write.ts`, `edit.ts`, `apply_patch.ts` | `tool/diagnostics.ts` (existing) |
| Session cache eviction | 4 app components | `utils/session-cache.ts` |

### Files to Split

| File | Current LOC | Target Files | Target LOC Each |
|------|-------------|-------------|-----------------|
| `session/prompt.ts` | 2,106 | 5 | ~400 |
| `provider/provider.ts` | 1,021 | 3 + loaders/ | ~300 |
| `agent/agent.ts` | 1,743 | 3 + definitions/ | ~200 |
| TUI session route | 2,284 | 5 | ~400 |
| `config/config.ts` | 1,472 | 3 | ~500 |
