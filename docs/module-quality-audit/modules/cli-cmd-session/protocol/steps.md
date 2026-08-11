# cli-cmd-session — 9-step review

Reviewer: `codex-sol`; independent verifier: `ax-code-glm`. This pass follows the `cli-cmd-session` export from its compatibility entrypoint into the command implementation and real CLI tests.

## Step 1 Scope and public surface

The scoped source is `packages/ax-code/src/cli/cmd/session.ts:1`, which re-exports `SessionCommand` from `./storage/session`. That is a real named export even though `docs/module-quality-audit/modules/cli-cmd-session/MODULE-AUDIT.md:26-29` reports zero exports. The live consumer is `packages/ax-code/src/cli/boot.ts:40`, and the resulting command is registered in the root command array at `packages/ax-code/src/cli/boot.ts:98`. I treated the export target as related evidence because the facade has no behavior of its own.

## Step 2 Trust and side-effect boundaries

The facade itself reads no environment, filesystem, stdin, or secrets; all behavior is delegated by `packages/ax-code/src/cli/cmd/session.ts:1`. The target crosses material boundaries: project cleanup writes a JSON backup at `packages/ax-code/src/cli/cmd/storage/session.ts:139-173`, confirmed deletion invokes `Session.remove` at `packages/ax-code/src/cli/cmd/storage/session.ts:251-260`, and interactive listing starts a pager subprocess at `packages/ax-code/src/cli/cmd/storage/session.ts:436-465`. These effects are reachable only through explicitly named subcommands registered at `packages/ax-code/src/cli/cmd/storage/session.ts:53-65`.

## Step 3 Command wiring and correctness

The exported object declares `session`, installs list, delete, prune, backup-project, clear-project, and project-status, then requires a subcommand at `packages/ax-code/src/cli/cmd/storage/session.ts:53-65`. The delete path validates the identifier and translates a failed lookup to exit code 1 before removal (`packages/ax-code/src/cli/cmd/storage/session.ts:385-397`). The real entrypoint exercises both successful and missing deletion at `packages/ax-code/test/cli/smoke.test.ts:231-266`, so the one-line re-export is proven to resolve through boot rather than merely type-checking in isolation.

## Step 4 Failure handling and data safety

Project clearing obtains the project-scoped session set, writes the archive, and returns on a dry run before reaching deletion (`packages/ax-code/src/cli/cmd/storage/session.ts:228-257`). Root sessions are preferred as deletion roots to avoid deleting descendants twice (`packages/ax-code/src/cli/cmd/storage/session.ts:108-113,256-258`), with a fallback for anomalous rootless data. The pager registers shutdown cleanup and removes the handlers in `finally` at `packages/ax-code/src/cli/cmd/storage/session.ts:450-468`. The two empty catches at lines 392 and 453 have narrow purposes: user-facing not-found conversion and best-effort process-tree cleanup, respectively.

## Step 5 Performance and resource behavior

Session list asks storage for roots and passes `--max-count` as the query limit (`packages/ax-code/src/cli/cmd/storage/session.ts:402-423`), avoiding child-session expansion and enabling bounded output. Pagination occurs only for an unbounded table written to a TTY (`packages/ax-code/src/cli/cmd/storage/session.ts:429-470`). Backup serialization is deliberately sequential over sessions and accumulates transfers before one JSON write (`packages/ax-code/src/cli/cmd/storage/session.ts:141-173`); this favors a coherent single archive but means memory grows with the current project's transcript history. That cost belongs to the explicit backup/cleanup operation, not import of the facade.

## Step 6 Design and maintenance hygiene

The split is coherent: `packages/ax-code/src/cli/cmd/session.ts:1` preserves the stable `./cmd/session` import used by boot, while `packages/ax-code/src/cli/cmd/storage/session.ts:53-505` owns storage-oriented session commands. The generic `cmd` helper only retains yargs typing (`packages/ax-code/src/cli/cmd/cmd.ts:1-7`), so the facade adds no hidden adapter semantics. The scoped file has no TODO, conditional, catch, or duplicate declaration. The audit inventory's zero-export claim at `docs/module-quality-audit/modules/cli-cmd-session/MODULE-AUDIT.md:24-29` is a static-extraction mismatch, not dead code, because boot imports the symbol directly.

## Step 7 Test coverage

Real-process coverage lists sessions through `session list --format json` at `packages/ax-code/test/cli/smoke.test.ts:207-229`, deletes a real session at lines 231-253, and checks malformed-row filtering at lines 289-317. Destructive project flows are tested for dry-run preservation, confirmed removal, backup-only behavior, and parent/child deletion at `packages/ax-code/test/cli/session-clear-project.test.ts:29-157`; status payload shape is checked at lines 159-188. Gaps remain for the pager branch, prune command wiring, and the project-status handler's rendered text/JSON, but the facade's import path is covered by the real entrypoint smoke tests.

## Step 8 Finding reconciliation

The register states `_none accepted_` at `docs/module-quality-audit/modules/cli-cmd-session/MODULE-AUDIT.md:60-64`, and there are no files under this unit's `findings/` path. My independent read found no defect in the compatibility export and no Critical severity evidence in its reachable wiring. The stale export count noted in Steps 1 and 6 affects audit metadata only and does not justify a product-code finding. Consequently no `reverify.md` is created for this reviewer pass.

## Step 9 Verification and sign-off

I ran `AX_TEST_FILES=test/cli/session-clear-project.test.ts,test/cli/smoke.test.ts pnpm --dir packages/ax-code exec vitest run`; Vitest reported 2 files and 18 tests passed in 58.85 seconds. Those files exercise the root entrypoint and the safety-sensitive backup/delete behavior cited above. The prior checklist still labels the protocol pending at `docs/module-quality-audit/modules/cli-cmd-session/MODULE-AUDIT.md:66-85`; these artifacts complete the primary `codex-sol` nine-step pass, with independent verifier identity retained as `ax-code-glm`.
