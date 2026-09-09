# Redo restores messages without fully restoring file changes

## Problem and reproduction

AX Code 7.14.11 could show restored messages while leaving files in an earlier undone state. The defects were reproduced on Windows using real temporary Git repositories, SQLite session storage, and the production SessionRevert/Snapshot implementations.

1. Turn one modifies a file, adds `added.txt`, and deletes `deleted.txt`.
2. Turn two modifies the shared file again and creates `second.txt`.
3. Undo both turns, then redo only turn one.
4. Messages and the shared modified file return to turn one, but `added.txt` remains missing and `deleted.txt` remains present.
5. Full redo restores additions and modifications, but can still leave `deleted.txt` present when it should be deleted.

The original focused suites passed 31 tests, but the added multi-turn integration test exposed three failed file assertions covering these two defects.

## Cause

Partial redo uses `session.revert` with the next user-message boundary. Its plan previously included only patches after the new boundary. Files affected exclusively by the earlier hidden turn were absent from that plan, so the current undone worktree never reapplied their changes.

Full redo used `Snapshot.restore`, whose successful checkout restores files present in the target tree without removing files absent from it. This left files resurrected by undo on disk, even after the revert marker was cleared.

## Fix

`SessionRevert.plan` now combines the new boundary's patches with a fallback for paths affected by the previous boundary. New-boundary patches retain precedence; remaining affected paths restore their state from the snapshot saved before the first undo. Preview uses the same plan without writing files.

`SessionRevert.unrevert` now restores only the affected paths using `Snapshot.revert`. This operation handles additions, modifications, and deletions, and preserves unrelated manual edits and new files. The general-purpose `Snapshot.restore` behavior is unchanged. The fix does not perform a blanket worktree reset or clean.

Before full redo, a snapshot captures the current state. If clearing the session's revert metadata fails, affected files roll back to that state and the existing revert marker remains available for retry. Snapshot's existing path validation and file-operation rollback remain in use.

## Validation — 2026-09-09

- Seven focused suites passed: **32 tests, zero failures**, comprising the original 31 tests and the new integration scenario.
- The integration scenario was extended with direct full redo from the earliest boundary and rerun successfully. This is an additional run of the same test, not a 33rd distinct test.
- Covered two-level undo, partial redo, full redo with and without an intermediate partial redo, file addition/modification/deletion, Chinese filenames containing spaces, CRLF content, and message visibility boundaries.
- Verified that undo retains messages for redo; cleanup removes the reverted tail before new user-message insertion.
- Verified preview does not modify files and reports the missing first-turn changes.
- Verified unrelated files edited or created after undo survive redo.
- Injected failure in `Session.clearRevert` and verified affected files and the message boundary remain at their pre-redo state; retry succeeds.
- Existing descendant rollback, busy-session protection, worktree boundary, Windows snapshot path, compact-after-revert, and TUI error-handling tests passed.
- TypeScript typecheck, formatting, and Git whitespace checks passed.

Run from `packages/ax-code` with the bundled Node runtime:

```powershell
$env:AX_TEST_FILES='test/session/redo-files.test.ts,test/session/descendant-rollback.test.ts,test/session/rollback.test.ts,test/session/revert-compact.test.ts,test/cli/tui/session-revert.test.ts,test/cli/tui/h-session-undo-redo-revert-error.test.ts,test/snapshot/windows-paths.test.ts'
node ../../node_modules/vitest/vitest.mjs run --retry=0
```

The new regression file was named `local-revert-audit.test.ts` during execution and renamed to `redo-files.test.ts` for the commit; its final test body is unchanged by the rename.

## Installed runtime and scope

The local 7.14.11 installation was backed up and updated by compiling only the corrected `SessionRevert.plan` and `unrevert` functions from the tested source. Bundle syntax, version startup, and installed SHA-256 verification passed:

`aad3d38bfafa4db5e3b65d14a5dbfb1abc315bad745c28ffb8fde2c3ec94ce1a`

The existing session-load fix, Windows console fix, and snapshot performance optimization were preserved by the scoped replacement. The deferred RPC/SSE size-limit issues were not changed.

Validation used isolated test databases and repositories and did not undo any existing user session. The filesystem integration tests ran against source; installed-runtime checks covered syntax, startup/version, and exact candidate integrity. No mouse/keyboard TUI end-to-end run or new performance benchmark is claimed.
