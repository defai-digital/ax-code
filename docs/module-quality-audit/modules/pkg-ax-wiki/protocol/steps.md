# Nine-step review: pkg-ax-wiki

## Step 1 Scope and execution map

The reviewed unit is `pkg-ax-wiki`, rooted at `packages/ax-wiki`. Its barrel exposes the path, discovery, planning, protected-section, validation, build, artifact, instruction-pointer, and prompt-protocol surfaces (`packages/ax-wiki/src/index.ts:1-14`). The central request/result contract puts model generation and optional graph context behind callbacks (`packages/ax-wiki/src/types.ts:29-53`, `packages/ax-wiki/src/types.ts:123-148`), while `buildAxWiki` coordinates the engine (`packages/ax-wiki/src/build.ts:112-303`). Tests and the Vitest configuration were included in the review, as were the CLI/runtime consumers and the existing module audit.

## Step 2 Threat and failure model

The important assets are repository files, generated Markdown, the manifest, maintainer-owned protected blocks, and instruction files. Relative paths reject absolute paths and `..`, and resolved outputs are checked against the repository root (`packages/ax-wiki/src/paths.ts:13-37`). Output path segments are rejected when symlinked or non-directories (`packages/ax-wiki/src/safety.ts:9-27`); source discovery also ignores symlinks whose real target leaves the repository (`packages/ax-wiki/src/discovery.ts:144-165`). Instruction updates refuse symlinked `AGENTS.md` or `CLAUDE.md` and use temporary-file renames (`packages/ax-wiki/src/agents.ts:47-77`). Residual local TOCTOU risk exists between checks and writes, but no practical exploit or Critical finding was established for this local compiler.

## Step 3 Correctness and lifecycle

Incremental updates compare current source hashes with the prior manifest and regenerate when a page is absent, the plan changes, or a changed source matches its selectors (`packages/ax-wiki/src/build.ts:62-86`, `packages/ax-wiki/src/build.ts:121-155`). Manual changes outside protected blocks become conflicts unless forced (`packages/ax-wiki/src/build.ts:137-160`), while named protected sections are merged back into regenerated content (`packages/ax-wiki/src/protected.ts:50-67`). The complete candidate and new manifest are assembled and validated before filesystem mutation (`packages/ax-wiki/src/build.ts:193-242`). Writes are atomic, obsolete pages are conservatively selected, and the catch path restores previously written or deleted page content if a later operation fails (`packages/ax-wiki/src/build.ts:244-289`).

## Step 4 Performance and scale

Discovery prefers one NUL-delimited `git ls-files` call with a 32 MiB buffer, then falls back to a recursive walk (`packages/ax-wiki/src/discovery.ts:77-105`, `packages/ax-wiki/src/discovery.ts:139-149`). Default source size is capped at 512,000 bytes and binary content is skipped (`packages/ax-wiki/src/discovery.ts:151-180`). Per-page evidence is limited both to 32,000 characters per file and to a total byte budget (`packages/ax-wiki/src/discovery.ts:185-200`); source selection sorts by relevance and applies a configurable count limit (`packages/ax-wiki/src/plan.ts:164-183`). Planning caps generated pages at 40 (`packages/ax-wiki/src/plan.ts:66-70`). The sequential source reads and page generation loops favor deterministic ordering; within these explicit bounds, no unbounded hot path requiring a finding was observed.

## Step 5 Design and dependency boundaries

The core package remains model-agnostic: `WikiPageGenerator` and `WikiGraphContextProvider` are injected contracts (`packages/ax-wiki/src/types.ts:42-53`), and the AX Code integration supplies provider-backed generation at `packages/ax-code/src/wiki/native.ts:172`. The session layer consumes only the compact protocol helper (`packages/ax-code/src/session/system.ts:195-205`), and CLI operations use the core artifact/status APIs rather than duplicating their rules (`packages/ax-code/src/cli/cmd/wiki.ts:90-100`, `packages/ax-code/src/cli/cmd/wiki.ts:265-288`). This matches the ownership statement in `packages/ax-wiki/README.md:3-7`: deterministic compilation stays in the package, while credentials and runtime orchestration stay outside it.

## Step 6 Hygiene and dead-code review

Exports in `packages/ax-wiki/src/index.ts:1-14` correspond to implemented subsystems and have observed consumers in the CLI, session prompt, and native integration. Error handling is generally deliberate: invalid non-missing core configuration is rethrown with context (`packages/ax-wiki/src/build.ts:39-50`), while invalid manifests are treated as absent (`packages/ax-wiki/src/build.ts:31-37`, `packages/ax-wiki/src/build.ts:53-59`). Temporary files are removed on failed atomic writes (`packages/ax-wiki/src/build.ts:95-104`; `packages/ax-wiki/src/agents.ts:69-77`). No TODO/FIXME marker, abandoned branch, or duplicate implementation was found in the reviewed source. The broad read suppression in Markdown enumeration (`packages/ax-wiki/src/artifacts.ts:19-37`) is a diagnosability tradeoff, not shown to corrupt generated output.

## Step 7 Test quality and gaps

The lifecycle suite proves full generation, unchanged-update skipping, selector-based regeneration, protected-text retention, conflict refusal, pre-write validation, staleness detection, symlink refusal, and invalid-config reporting (`packages/ax-wiki/test/build.test.ts:40-121`). Artifact tests cover frontmatter, managed pointer replacement, incomplete-marker repair, and instruction-file symlink defense (`packages/ax-wiki/test/artifacts.test.ts:15-67`); planning tests cover deterministic module pages, unsafe directory fallback, recursive globs, and the required quickstart (`packages/ax-wiki/test/plan.test.ts:8-35`). The configured glob really does discover these tests (`packages/ax-wiki/vitest.config.ts:3-8`), contrary to the stale “none auto-matched” entry in `docs/module-quality-audit/modules/pkg-ax-wiki/MODULE-AUDIT.md:68-69`. Direct tests are still absent for cards, related-page lookup, status/protocol rendering, discovery fallback, and rollback after a mid-write failure.

## Step 8 Finding register reconciliation

The existing register records no accepted finding (`docs/module-quality-audit/modules/pkg-ax-wiki/MODULE-AUDIT.md:83-87`), and the unit’s `findings/` directory was empty at review time. Independent inspection found no reproducible correctness, security, performance, or ownership defect that warranted creating a finding. The coverage gaps and residual TOCTOU/diagnostic considerations above remain review notes, not confirmed failures. Because there is no Critical severity evidence file, the conditional `protocol/reverify.md` is not applicable.

## Step 9 Verification and exit

The package declares separate `tsc --noEmit` and `vitest run` scripts (`packages/ax-wiki/package.json:10-12`). On 2026-08-11, `pnpm --dir packages/ax-wiki run typecheck` exited 0, and `pnpm --dir packages/ax-wiki run test` exited 0 with 3 test files and 13 tests passing. This resolves all nine review stages for `pkg-ax-wiki`; only the three requested protocol artifacts were written, and no other audit unit was edited.
