# TypeScript native support

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
A successful pull refreshes that file. Server refresh requests trigger coalesced
refreshes of previously requested documents. The raw record API refreshes stale
results within a bounded collection budget and rejects incomplete inventories;
edit tools disclose this condition without losing the successful file edit.
Other language servers retain their
existing push diagnostics behavior.

Existing memory-profile, idle-reaping, and opt-in prewarm controls still apply.
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
