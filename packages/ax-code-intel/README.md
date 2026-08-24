# @ax-code/ax-code-intel

Language Server Protocol client and server orchestration for AX Code.

This package is the compiler-grade code-intelligence layer: it spawns local
language servers on demand over stdio JSON-RPC, negotiates document sync per
server capability, and surfaces diagnostics, navigation, references, symbols,
call hierarchy, a graph-backed result cache, and prewarm. It is
environment-agnostic — everything host-specific (workspace paths, runtime
executables, feature flags, the event bus, the cache store) is injected
through the host port in `src/host.ts`. The AX Code core wires the production
host in `packages/ax-code/src/lsp-glue.ts`.

The package is the output of the intel stabilization milestone
(D1–D3 closed: cache identity, sync conformance, typed semantic results);
see the architecture pointer below for status.

## Public API

The `exports` map in `package.json` is the contract. Anything not listed
there is not importable.

| Subpath            | Exports                                                           | Stability |
| ------------------ | ----------------------------------------------------------------- | --------- |
| `.`                | `LSP` facade (index-impl re-exported for convenience)             | stable    |
| `host`             | `CodeIntelHost` port, `configureCodeIntelHost`, event/cache types | stable    |
| `index-impl`       | `LSP` facade implementation                                       | evolving  |
| `client`           | `LSPClient` (per-server JSON-RPC client, sync negotiation)        | evolving  |
| `server`           | `LSPServer` types + server definition registry                    | evolving  |
| `server-config`    | `LSPServerConfig` (config overlay resolution)                     | evolving  |
| `server-profile`   | server startup profiles                                           | evolving  |
| `server-defs`      | individual language-server definitions                            | evolving  |
| `server-releases`  | pinned release/asset download + checksum verification helpers     | evolving  |
| `server-helpers`   | spawn/path/venv/managed-tool helpers                              | evolving  |
| `language`         | language detection from file paths                                | evolving  |
| `prewarm-profile`  | prewarm policy profiles                                           | evolving  |
| `prewarm`          | prewarm orchestration                                             | evolving  |
| `launch`           | server process launch + kill-tree teardown                        | evolving  |
| `scheduler`        | request scheduling, inflight collapse, budget                     | evolving  |
| `selection`        | server selection per file/language                                | evolving  |
| `broken-server`    | broken-server tracking/backoff                                    | evolving  |
| `client-notify`    | client notification helpers                                       | evolving  |
| `envelope`         | result envelope types                                             | evolving  |
| `envelope-runner`  | envelope-producing query runner                                   | evolving  |
| `cache-context`    | cache identity/fingerprint context                                | evolving  |
| `cache-probe`      | cache hit/miss probing                                            | evolving  |
| `perf`             | perf ring buffer (`recordSample`, `metered`, `snapshot`)          | evolving  |
| `protocol`         | shared LSP protocol types                                         | evolving  |
| `point`            | position/point helpers                                            | evolving  |
| `references`       | typed references results                                          | evolving  |
| `diagnostics`      | typed diagnostics results                                         | evolving  |
| `document-symbol`  | typed document-symbol results                                     | evolving  |
| `workspace-symbol` | typed workspace-symbol results (resolved/unresolved)              | evolving  |
| `semantic-results` | semantic result normalization/validation                          | evolving  |
| `oxlint`           | oxlint auxiliary-server support                                   | evolving  |
| `jdtls-data-dir`   | jdtls data-directory resolution                                   | evolving  |
| `log`              | `setLogSink` / `createLogger` host logging facade                 | evolving  |

Stability tiers:

- **stable** — semantic-versioned; no breaking changes without a major bump.
- **evolving** — current contract; breaking changes are allowed in minor
  versions but require a CHANGELOG entry.
- **internal-only** — everything under `src/internal/`. Not part of the API
  surface, not exported, and may change without notice.

## Lifecycle guarantees

- The public API follows semver. The package is at `0.x`, so breaking changes
  are permitted in minor versions; from `1.0.0` they require a major bump
  plus a migration note in the CHANGELOG.
- `internal/*` is **not** API. It is not exported; importing it from outside
  the package is unsupported and may break without notice.
- Performance characteristics are recorded in
  `perf/baseline/baseline.reference.json` (see below); Phase 3 tuning deltas
  reference that file.
- Language-server binaries (tsserver via typescript-language-server, Pyright,
  rust-analyzer, and the other managed servers) are external dependencies.
  Their availability and versions are out of this package's contract; pinned
  download metadata lives in `server-releases`.

## Versioning & release

This package is independently versioned (`0.1.0` currently) and consumed by
the AX Code core as a workspace dependency. When it is published to npm, the
same semver policy applies.

## Testing

```bash
pnpm --dir packages/ax-code-intel test
```

runs the package's unit tests (`test/`), including the host-contract tests
moved out of the core suite (`test/unit/`). Those tests wire a minimal local
host via `test/harness.ts` — the package never imports the core.

Integration tests that exercise the package through the AX Code core (tools,
SSE events, config) live in `packages/ax-code/test/lsp/` and run with the
core suite.

## Performance

A manual benchmark harness lives in `perf/` (cold start, warm query latency,
peak RSS, cache hit rate, diagnostic latency, graph-builder fan-out). See
`perf/README.md` for how to run it, how to interpret results, and how to
refresh the recorded reference baseline. The harness is manual-only; it does
not run in CI.

## Architecture

Design context, defect log (D1–D5), and the phase plan are in
`.internal/prd/complete/PRD-2026-08-21-ax-code-intel-stabilization-acceleration.md`
(repo-internal). In short: LSP servers stay the single semantic authority in
their own processes; tree-sitter and SQLite remain the syntactic and
persistence layers; no compiler frontends are embedded in-process.
