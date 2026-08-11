# Review protocol: cli-cmd-import

## Step 1 Scope and entry points

The reviewed surface is `packages/ax-code/src/cli/cmd/import.ts`: it exports the text formatter at line 8 and the yargs command at line 21. The command is wired into the executable command list through `packages/ax-code/src/cli/boot.ts:27` and `packages/ax-code/src/cli/boot.ts:89`. Related reads covered the compatibility engine, the delegated session importer, bootstrap lifecycle, command typing, and focused tests.

## Step 2 Inputs, outputs, and trust boundaries

The positional value is required and typed as a string at `packages/ax-code/src/cli/cmd/import.ts:26-30`; `--write` and `--json` are the only added options at lines 31-38. Compatibility mode reads beneath a provider-specific project directory and may write into `.ax-code` (`packages/ax-code/src/import/compatibility.ts:32-42`, `:63-66`). The CLI emits either JSON or a human report at `packages/ax-code/src/cli/cmd/import.ts:52-56`. No credential, network, or subprocess boundary is introduced here; filesystem contents and paths are the principal untrusted inputs.

## Step 3 Control-flow correctness

`CompatibilityImport.Source.safeParse` separates the three provider tokens from ordinary file paths at `packages/ax-code/src/cli/cmd/import.ts:40-43`. File paths delegate to the established storage handler, while provider tokens execute within bootstrap, forwarding the current directory and making writes opt-in via `args.write === true` at lines 46-51. JSON output returns before the human formatter at lines 52-55. One deliberate edge remains: a session file literally named `opencode`, `claude`, or `codex` selects compatibility mode; callers can disambiguate with a path such as `./opencode`.

## Step 4 Failure and performance behavior

Planning performs three glob scans in sequence at `packages/ax-code/src/import/compatibility.ts:44-46`, then warning inspection is parallelized per command by `Promise.all` at lines 71-80. Writes are sequential at lines 63-66, limiting concurrent filesystem pressure at the cost of linear latency for large imports. Existing targets are classified before writing at lines 112-120, so normal runs do not overwrite them. The existence check and later write are not atomic, leaving a narrow concurrent-change race, but no Critical severity issue is present in this unit's findings register.

## Step 5 Ownership and dependency design

The CLI module remains an adapter: provider discovery/copy rules live in `packages/ax-code/src/import/compatibility.ts:38-69`, and legacy session validation/import remains in `packages/ax-code/src/cli/cmd/storage/import.ts:43-67` and `:80-100`. `packages/ax-code/src/cli/bootstrap.ts:4-16` owns instance setup and guaranteed disposal. This separation keeps yargs parsing and presentation in the reviewed file while preserving the storage command instead of duplicating its schema or persistence logic.

## Step 6 Maintainability and defensive handling

The formatter constructs deterministic lines and appends the platform EOL at `packages/ax-code/src/cli/cmd/import.ts:8-18`. Candidate reports use zod schemas for source, kind, action, counts, and candidate shape at `packages/ax-code/src/import/compatibility.ts:8-30`. Parse failures become an `invalid_frontmatter` warning at lines 124-131, while scan failures collapse to an empty candidate list at lines 134-141; that behavior makes absent and unreadable source trees look the same, an operational observability limitation rather than an accepted Critical finding.

## Step 7 Test evidence and gaps

`packages/ax-code/test/cli/import.test.ts:9-49` proves dry-run does not write, reports both command and skill candidates, detects shell interpolation, and formats the summary. Its second case at lines 51-67 proves write mode preserves an existing target. `packages/ax-code/test/import-compatibility.test.ts:8-22` protects dotted agent-directory handling. The fallback reader's corrupt, unprintable, and schema-invalid inputs are covered at `packages/ax-code/test/cli/storage-transfer.test.ts:22-61`. Direct handler-level assertions for token-versus-file routing and JSON stdout remain useful future additions.

## Step 8 Findings disposition

The audit register states `_none accepted_` at `docs/module-quality-audit/modules/cli-cmd-import/MODULE-AUDIT.md:61-65`, and enumeration of the unit's `findings/` directory produced no finding files. Independent review of the write gate, stdout branches, delegation, scan error handling, and existing-target behavior found no Critical item requiring secondary re-verification. The namespace collision, non-atomic existence check, and silent scan fallback are documented above as bounded residual risks/coverage opportunities.

## Step 9 Verification and exit assessment

The focused command `AX_TEST_FILES=test/cli/import.test.ts,test/import-compatibility.test.ts,test/cli/storage-transfer.test.ts pnpm --dir packages/ax-code exec vitest run` passed 3 files and 8 tests. `pnpm --dir packages/ax-code run typecheck` also passed. These results exercise the evidence cited in `packages/ax-code/test/cli/import.test.ts:38-48` and `packages/ax-code/test/cli/storage-transfer.test.ts:63-127`; together with the source review, they support reviewer completion of all nine steps for `cli-cmd-import`.
