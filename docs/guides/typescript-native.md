# TypeScript native support

Status: Active in source; packaged runtime release pending
Scope: current-state source toolchain and language service
Last reviewed: 2026-09-14
Owner: AX Code maintainers

AX Code uses the official Go-based TypeScript 7.0.2 compiler for workspace
checks, SDK emission, and its built-in JavaScript/TypeScript language server.
The language server runs the shipped native executable directly with
`--lsp --stdio`. It does not invoke a registry runner or download a floating
language-server version. No Go toolchain is required to use AX Code.

Install dependencies with `pnpm install`, including optional dependencies.
The native compiler needs its matching OS/CPU package. Standalone builds stage
and verify that package before delivery. A missing or mismatched binary produces
an actionable error instead of silently starting a JavaScript server.

## Compiler API compatibility

The workspace pins `@typescript/native` to `npm:typescript@7.0.2` and keeps
`typescript` aliased to `npm:@typescript/typescript6@6.0.2` for tools that import
the legacy JavaScript Compiler API. Type checks and SDK emission use the native
compiler. The compatibility API is not the default language server.

Framework tooling for Vue, Svelte, and Astro uses its own server integration;
TypeScript library compatibility does not establish compiler-plugin support.
SolidJS JSX transformation continues through Babel. Runtime tests and emitted
artifacts must pass independently of a successful type check.

## Diagnostics and memory

Native TypeScript uses pull diagnostics. AX Code requests them when a caller
asks to wait for diagnostics or collects the diagnostic inventory. Synchronizing
a file alone does not wait for type checking. Edits invalidate dependent cached results; stale, pending, or failed
inventories are reported as partial/degraded by the aggregated diagnostics API.
A successful pull refreshes that file. Server refresh requests mark cached results
stale; the next diagnostic request refreshes them on demand. Background server
traffic does not renew the idle lifetime. File edits can still refresh previously
requested documents in the background. The raw record API refreshes stale
results within a bounded collection budget and rejects incomplete inventories;
edit tools disclose this condition without losing the successful file edit.
Other language servers retain their
existing push diagnostics behavior.

Overlapping explicit diagnostic waits for the same file share a request only
within the same workspace generation. Sequential requests still refresh; a
workspace change prevents reuse of an older in-flight request. Background and
inventory refreshes recheck freshness after waiting for a document lock.

Successful patch deletions and moves close the removed source documents in the
language service. Failed patch transactions retain their document state. Cleanup has a shared
two-second deadline and skips paths recreated by a later operation in the same
patch. Incomplete cleanup is disclosed without undoing saved edits. If delivery
to the server times out, diagnostics remain incomplete until that client restarts.

Idle language servers are reclaimed after 30 minutes in the normal memory
profile, or five minutes with `AX_CODE_MEMORY_PROFILE=low`. Reclamation runs on
the existing one-minute health-check interval and waits for active and queued
requests to settle. Servers restart on demand. `AX_CODE_LSP_IDLE_MS` overrides
the idle duration in milliseconds; `0` disables idle reclamation. Invalid values
use the profile default. These settings do not impose a process RAM ceiling or
a machine-wide budget. Speculative prewarming remains opt-in.

Reclaiming a server discards its diagnostic inventory. Aggregated results remain
marked degraded until previously open documents have been reopened and checked,
or explicitly removed. The raw inventory API rejects incomplete coverage.
The coverage ledger is limited to 2,000 paths; overflow remains conservatively
incomplete until the project instance is disposed. Reclaiming an empty server
loses no coverage. Edit tools preserve saved
changes and disclose that diagnostics are incomplete. Use a full project type
check to establish whether the project is clean.

Native compilation does not guarantee a particular resident-memory reduction.
Compare the same project, open documents, requests, and process-tree RSS before
making a memory claim.

## Explicit server override

An existing trusted `lsp.typescript.command` configuration still overrides the
built-in native server. For a legacy server, install and pin the server and its
compatible TypeScript SDK in the project, then set `command` to that installed
executable with `--stdio`. Avoid unpinned `npx` commands. The override is explicit;
AX Code does not automatically fall back when the native compiler is unavailable.

Upstream: [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).

## TypeScript 7.0.2 saved-document compatibility

The native 7.0.2 server can return an earlier diagnostic snapshot when file-watch
traffic overlaps saved edits. AX Code closes and reopens changed documents for
that exact server version before requesting diagnostics. One bounded document
query flushes the deferred close before reopening; other queries wait for this
replacement. This sends the full changed document; unchanged documents still reuse overlapping requests. Other
server versions keep their negotiated synchronization mode. An interrupted
replacement remains incomplete until the language server restarts.
