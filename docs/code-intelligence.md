# Code Intelligence Graph

AX Code builds a persistent code graph from LSP data — symbols, call edges, and cross-file references stored in SQLite for instant queries. Once indexed, agents can look up functions by name, trace callers and callees, estimate blast radius before a change, and plan multi-file refactors — all without re-reading files or making live LSP round-trips.

> **Experimental feature.** Set `AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE=1` to enable the graph, the `code-intelligence` tool, auto-indexing, and the file watcher.

---

## Quick Start

```bash
# 1. Enable the feature
export AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE=1

# 2. Index your project (respects .gitignore)
ax-code index

# 3. Launch the TUI — agents can now use the graph
ax-code
```

After the initial index, a file watcher keeps the graph up to date as you save files. You can also re-run `ax-code index` at any time; unchanged files are skipped automatically via content-hash matching.

---

## Indexing

### How It Works

1. **File discovery** — Ripgrep walks the project (respects `.gitignore`), filtering by known source extensions.
2. **LSP probe** — One representative file per language is opened to check whether a language server is available. A readiness table prints before the batch so missing servers are visible upfront.
3. **Per-file indexing** — For each file, the indexer:
   - Computes a content hash (SHA + size). If it matches the stored hash and the file was previously fully indexed, the file is skipped (no LSP work).
   - Opens the file in the language server (`touchFile`).
   - Extracts symbols via `documentSymbol` (functions, classes, methods, interfaces, types, etc.).
   - Calls `references` for each container symbol to discover call sites and cross-references.
   - Stores nodes and edges in SQLite within an atomic transaction.
4. **Orphan pruning** — Files that no longer exist on disk have their nodes and edges removed from the graph.

### Supported Languages

The graph works with any language that has an LSP server. Common setups:

| Language | Server | Notes |
|----------|--------|-------|
| TypeScript/JavaScript | typescript-language-server | Bundled with ax-code |
| Go | gopls | `go install golang.org/x/tools/gopls@latest` |
| Rust | rust-analyzer | `rustup component add rust-analyzer` |
| Python | pyright | `pip install pyright` |
| Ruby | solargraph | `gem install solargraph` |
| Java | JDTLS | Bundled — needs JDK on PATH |
| Swift | sourcekit-lsp | Ships with Xcode |
| C/C++ | clangd | Install via package manager |

Run `ax-code index` to see the probe table — it tells you exactly which languages are ready and which are missing a server.

### CLI Reference

```bash
ax-code index                     # Index the current project
ax-code index --concurrency 8     # Use 8 parallel LSP jobs (default: 4)
ax-code index --limit 100         # Index only the first 100 files (benchmarking)
ax-code index --no-probe          # Skip the LSP pre-flight check
ax-code index --json              # Output a machine-readable JSON report
ax-code index --native-profile    # Collect native bridge timings
```

### Incremental Indexing

Second and subsequent runs skip unchanged files automatically:

- Each file's content hash and size are stored in the graph database.
- If both match and the previous index was complete ("full" completeness), no LSP work runs for that file.
- Only modified, added, or deleted files trigger work.

Between explicit index runs, the **file watcher** re-indexes changed files in the background (1-second debounce, up to 4 concurrent jobs). Deleted files are purged immediately.

### Auto-Indexing

When you start a session in a project that has never been indexed (zero nodes in the graph), ax-code automatically triggers a background index run. Disable this with `AX_CODE_DISABLE_AUTO_INDEX=1`.

### Reading the Output

A typical index run prints:

```
Indexing code intelligence graph
  project:   proj_abc123
  directory: /Users/you/myproject
  worktree:  /Users/you/myproject

Probing LSP servers...
  ✓ typescript (312 files)
  ✓ go (48 files)
  ✗ python (15 files) — install pyright: pip install pyright

15 file(s) across 1 language(s) will be skipped due to missing LSP servers.

Indexing in progress. This takes several minutes for larger projects.

  [5s]  42/360 files · 1,204 symbols (+1,204 interval)
  [10s] 98/360 files · 2,891 symbols (+1,687 interval)
  ...

Indexing complete
  nodes:     8,432
  edges:     12,107
  files:     360 indexed, 0 unchanged, 15 skipped, 0 failed
  elapsed:   47,200ms
```

Key fields:
- **nodes** — Total symbols in the graph (functions, classes, methods, etc.)
- **edges** — Total relationships (calls, references)
- **unchanged** — Files skipped because their content hash matched (fast on re-runs)
- **skipped** — Files with no LSP server available
- **failed** — Files where LSP returned errors (check log for details)

---

## Querying the Graph

Once indexed, agents use the `code-intelligence` tool automatically when appropriate. You can also direct them explicitly: *"use code-intelligence to find all callers of handleRequest"*.

### Operations

#### findSymbol — Look up a symbol by exact name

Find a function, class, method, or any other symbol by its name. Optionally filter by kind.

```
"Find the symbol named SessionProcessor"
"Use code-intelligence findSymbol to look up the handleRequest function"
```

Returns: symbol metadata including file path, line range, signature, and index freshness.

#### findSymbolByPrefix — Fuzzy discovery

Find symbols whose names start with a prefix. Useful when you know part of a name.

```
"Find all symbols starting with 'Session'"
```

#### symbolsInFile — List all symbols in a file

Get every indexed symbol in a specific file, ordered by line number.

```
"List all symbols in src/session/processor.ts"
```

#### findReferences — Where is this symbol used?

Find every non-call reference to a symbol (imports, type annotations, assignments). Requires a symbol ID from a previous `findSymbol` query.

```
"Find all references to the Config type"
```

#### findCallers — Who calls this function?

Find every function or method that calls the given symbol. Direct callers only (depth 1).

```
"Who calls the handleRequest method?"
```

#### findCallees — What does this function call?

Find every function or method called by the given symbol. Direct callees only (depth 1).

```
"What functions does processMessage call?"
```

### Completeness Levels

Every query result includes an `explain` field with a `completeness` indicator:

| Level | Meaning |
|-------|---------|
| **full** | Symbols and cross-references both indexed. Call/reference queries are complete. |
| **lsp-only** | Symbols indexed but reference resolution failed. Call/reference queries may be incomplete. |
| **partial** | LSP returned limited data. Treat results as best-effort. |

### When to Use Code Intelligence vs. Other Tools

| Task | Best tool | Why |
|------|-----------|-----|
| Find a function by name | `code-intelligence findSymbol` | Instant lookup from indexed graph |
| Find all callers of a function | `code-intelligence findCallers` | Graph traversal, no file reading |
| Find text patterns in code | `grep` | Regex search, not symbol-aware |
| Get type info for a specific position | `lsp hover` | Real-time LSP query, always current |
| Jump to definition at a cursor position | `lsp goToDefinition` | Real-time, position-based |
| Understand call relationships across a codebase | `code-intelligence` | Pre-computed, fast |
| Check impact before changing a shared function | `impact_analyze` | BFS over graph edges |

The graph is fast but reflects the state at last index. LSP tools are always current but slower for cross-file queries. Use both — the graph for broad codebase understanding, LSP for precise position-based queries.

---

## Analysis Tools (DRE)

The Debugging & Refactoring Engine (DRE) tools build on the code graph for deterministic analysis — no LLM, no cloud calls.

### impact_analyze — Blast radius estimation

Before changing a widely-used function, check how far the change ripples:

```
"Run impact_analyze on the parseConfig function"
"What's the blast radius if I change the Session.send method?"
```

**How it works:** BFS walks upstream from the seed symbols over "calls" and "references" edges, returning every dependent symbol up to a configurable depth.

**Output includes:**
- Affected symbols with BFS distance (1 = direct caller, 2 = caller's caller, etc.)
- Affected files
- API boundaries hit (public symbols in the affected set)
- Risk score: low / medium / high
- Whether the walk was truncated by the depth or visit cap

**Parameters:**
- `depth` — BFS depth cap (default 3, max 6). Deeper = more transitive callers.
- `maxVisited` — Hard cap on nodes visited (default 2,000, max 10,000).

### debug_analyze — Stack trace resolution

Paste a stack trace and get every frame resolved to a real symbol in the graph:

```
"Analyze this error: [paste stack trace]"
"Why is handleRequest failing? Here's the trace..."
```

**Output:** A chain of resolved stack frames with roles (failure / intermediate / entry), a confidence score based on how many frames resolved to real graph nodes, and guidance for the agent on which frames are trustworthy.

### refactor_plan — Plan before you edit

For multi-file refactors, generate an auditable plan before any files are changed:

```
"Plan a refactor to extract a PricingService from these functions"
"Create a refactor plan to rename handleRequest to processIncoming"
```

**Output:** A persistent plan with classified edits (create_symbol, replace_call_site, delete_symbol, move_file, update_signature), affected files, affected symbols, and risk level.

**Refactor kinds:** extract, rename, collapse, move, inline, other.

This tool **never writes files** — it only reads the graph and persists the plan for review.

### refactor_apply — Safe, verified refactoring

Apply a refactor plan with safety checks:

```
"Apply the refactor plan" (after reviewing a refactor_plan output)
```

**How it works:**
1. Opens a scratch git worktree
2. Applies the patch
3. Runs typecheck (never skipped), lint, and tests
4. Only if **every check passes**, applies the patch to the real worktree
5. If any check fails, nothing is written — the real worktree stays byte-identical

**Modes:**
- `safe` (default) — runs all checks
- `aggressive` — allows skipping lint and tests (typecheck still runs)

### Proactive Scanners

These scanners work independently of the graph but complement it for code quality:

| Scanner | What it finds |
|---------|---------------|
| **race_scan** | TOCTOU bugs, non-atomic counters, conflicting mutations in `Promise.all`, stale event listeners |
| **lifecycle_scan** | Leaked event listeners, uncleaned timers, orphaned subscriptions, unbounded Map growth |
| **security_scan** | Path traversal, command injection, SSRF, missing request validation, env variable leaks |
| **dedup_scan** | Duplicate/near-duplicate functions using signature bucketing and token-Jaccard similarity |
| **hardcode_scan** | Magic numbers, inline URLs, hardcoded paths, high-entropy strings that look like secrets |

All scanners are deterministic (regex + structural heuristics), run locally, and require no cloud calls.

```
"Scan for race conditions in src/session/"
"Run a security scan on the server code"
"Find duplicate functions across the project"
"Check for hardcoded values"
"Scan for resource leaks"
```

---

## Typical Workflows

### "I need to change a shared utility"

1. `findSymbol` to locate it
2. `findCallers` to see who depends on it
3. `impact_analyze` to estimate full blast radius
4. Make the change with confidence

### "I need to refactor across multiple files"

1. `findSymbol` to identify target symbols
2. `refactor_plan` to generate the plan
3. Review the plan (affected files, call sites, risk)
4. `refactor_apply` to apply with safety checks

### "Something is broken and I have a stack trace"

1. `debug_analyze` with the stack trace
2. The resolved chain tells you exactly which symbols are involved
3. `findCallees` on the failure frame to understand what it was trying to do

### "I want to clean up technical debt"

1. `dedup_scan` to find duplicated logic
2. `hardcode_scan` to find values that should be in config
3. `lifecycle_scan` to find resource leaks
4. `race_scan` to find concurrency bugs
5. `security_scan` before deploying

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE` | Enable the graph system (required) |
| `AX_CODE_DISABLE_AUTO_INDEX` | Disable background auto-indexing on session start |
| `AX_CODE_NATIVE_INDEX` | Enable Rust-accelerated queries (automatic fallback to Drizzle) |
| `AX_CODE_PROFILE_NATIVE` | Collect native bridge timings (also via `--native-profile` flag) |

---

## Troubleshooting

### "No symbols were extracted"

The most common cause is a missing language server. Run `ax-code index` and check the probe table:

```
  ✓ typescript (312 files)
  ✗ python (15 files) — install pyright: pip install pyright
```

Install the missing server and re-run.

### "Indexing finished but produced no symbols"

- Check that your project has source files with recognized extensions (`.ts`, `.go`, `.py`, `.rs`, etc.)
- Check `~/.local/share/ax-code/log/` for LSP spawn errors
- Try `ax-code index --no-probe` to bypass the pre-flight check and see raw errors

### Stale results after editing files

The file watcher should keep the graph current. If results seem stale:
- Re-run `ax-code index` — unchanged files skip instantly, only modified files re-index
- Check that `AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE=1` is set (the watcher only runs when enabled)

### "Another ax-code process is currently indexing"

Only one index run can happen per project at a time. Wait for the other process to finish, or check for a stale lockfile under `~/.local/share/ax-code/locks/`.

### Queries return empty results

- Run `ax-code index` first — queries return nothing until the graph is populated
- Check that the feature flag is set: `AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE=1`
