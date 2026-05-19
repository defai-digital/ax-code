# PRD: Rust Bug-Fix Verification Capability

## Status

Implemented.

## Implementation Notes

- Verification command resolution now falls back to Cargo defaults when package.json scripts or explicit overrides do not provide a command.
- Structured verification envelopes now parse rustc diagnostics, clippy diagnostics, and cargo test panic blocks as best-effort evidence while preserving raw command output.
- The clippy parser handles both attribute-style lint notes such as `#[deny(clippy::collapsible_if)]` and `-D clippy::needless-return` notes emitted by `cargo clippy -- -D warnings`.
- Unit coverage records the Cargo fallback contract and the Rust structured-failure parsing contract.

## Problem

AX Code can already edit Rust, use rust-analyzer through LSP, index Rust symbols through tree-sitter, and run arbitrary Cargo commands through bash. However, the bug-fix loop is not Rust-native enough:

- `verify_project` defaults are primarily JavaScript/package.json-oriented.
- Rust command failures are mostly raw text, so debug hypotheses and repair handoff cannot reliably classify Cargo failures as localized structured evidence.
- Existing JS/TS-oriented scanners correctly warn that Rust coverage is limited, but there is no equally strong first-class Cargo verification path.

This makes Rust bug fixing possible but less auditable than TypeScript bug fixing.

## Goals

- Make Rust projects receive useful default verification commands without requiring agents to remember Cargo overrides.
- Parse common rustc, clippy, and cargo test output into `VerificationEnvelope.structuredFailures`.
- Keep the first slice small, reversible, and compatible with existing verification envelopes.
- Avoid broad Rust semantic-analysis claims that require compiler integration.

## Non-Goals

- Do not implement a full Rust compiler semantic analyzer.
- Do not replace rust-analyzer.
- Do not create a managed rust-analyzer installer in this slice.
- Do not change JS/TS verification defaults.
- Do not run or modify unrelated race scanner work currently present in the worktree.

## Best-Practice Design

1. Verification before intelligence expansion.
   - The first improvement should make fixes auditable before adding new speculative Rust analysis tools.
2. Use Cargo as the Rust contract surface.
   - `cargo check`, `cargo clippy`, and `cargo test` are the stable project-native signals.
3. Preserve human-readable raw output.
   - Structured parsing should augment raw command output, not replace it.
4. Treat parsing as best-effort.
   - Unknown Cargo output remains raw text and does not fabricate file or test anchors.
5. Keep failure kinds compatible with existing envelope schema.
   - rustc compile failures map to `typecheck` failures.
   - clippy/rustc lint failures map to `lint` failures.
   - cargo test panics map to `test` failures.

## Initial Implementation Scope

- Update verification command resolution:
  - If no explicit override is supplied and relevant package.json scripts are absent, detect a nearby `Cargo.toml`.
  - Use `cargo check` as typecheck.
  - Use `cargo clippy --all-targets --all-features -- -D warnings` as lint.
  - Use `cargo test` as tests.
- Update verification envelope parsing:
  - Parse rustc-style diagnostics with `--> file:line:column` anchors.
  - Parse clippy/rustc lint diagnostics into lint structured failures.
  - Parse cargo test panic blocks into test structured failures.
- Add unit coverage for command resolution and envelope parsing.

## Acceptance Criteria

- A Rust-only project with `Cargo.toml` resolves non-null Cargo verification commands.
- Existing package.json-based command resolution remains unchanged.
- TypeScript/ESLint/bun:test structured parsing continues to work.
- rustc compile errors produce `kind: "typecheck"` structured failures.
- clippy warnings produce `kind: "lint"` structured failures.
- cargo test panics produce `kind: "test"` structured failures.

## Follow-Up Opportunities

- Add Rust panic/backtrace parsing to `debug_analyze`.
- Add crate-aware targeted verification such as `cargo test -p <crate>` when changed files map cleanly to one Cargo package.
- Add managed rust-analyzer fallback or a clearer remediation path when `rust-analyzer` is missing.
- Add high-signal Rust-specific review heuristics for unsafe, unwrap/expect, async blocking, process-global env mutation, and lock handling.
