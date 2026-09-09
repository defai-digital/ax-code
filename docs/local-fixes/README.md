# Local fixes on AX Code 7.14.11

This branch starts at the official `v7.14.11` tag (commit `ce0ea3b3d`) and ports the locally installed snapshot performance improvement into TypeScript source.

The subsequent [session-load issue report](issue-session-load-large-rpc.md) documents the fix for large transcript RPC responses being truncated by the process transport, including reproduction, implementation, and installed-runtime verification.

The [Windows restart mojibake issue report](issue-windows-console-restart-mojibake.md) documents independent input/output code-page drift, the native console repair, and real Ctrl+C/restart validation.

Windows snapshot staging enumerates indexed and untracked paths in one tagged, NUL-delimited Git command. Unsupported historical paths still fail without removing index entries. Unsupported untracked paths retain the upstream exclusion and warning behavior. Restore protection and the upstream command-line-length handling remain intact.

The official base already includes the Windows doctor process checks, structured log severity, complete recent-log scanning, effective configuration and inline credential discovery, Windows reserved-path handling, and nested SQLite busy-error retry fixes. Its session creation timeout is 52 seconds; the earlier local source used 57 seconds. Both cover the configured three-attempt lock-wait budget.

## Original workspace changes

`original-worktree.patch` preserves all 30 locally modified or added source, test, and documentation files against original commit `468813176`. This is an archival patch, **not a patch to apply wholesale to this branch**. It includes the earlier desktop fixes, session cleanup concurrency change, and pre-upgrade CLI implementations. Desktop was removed upstream before 7.14.11; those desktop changes are preserved here for review and migration, not reinstated as a runnable desktop application. The original working tree and its staging state were retained.

To inspect the original changes, use a separate checkout of `468813176` and apply this patch there. The `nul` reproduction artifact, local credentials, logs, installed bundles, dependency trees, and machine-specific backups are not included.

## Validation

`installed-verification.json` records fresh verification of the installed 7.14.11 bundle corresponding to this source optimization: 46 equal snapshot trees, matching warnings, 92 to 46 enumeration calls, historical-index protection, doctor regression checks, and injected-callback SQLite retry checks. The recorded scan timing is a local observation, not an end-to-end performance guarantee. Database callback tests do not take a real lock on a user's database.

The snapshot test suite additionally checks that staging uses the combined enumeration while capturing newly added files. Two doctor test fixtures now accept Windows path separators.

Source validation on Windows with Node 26.8.1:

- TypeScript typecheck and formatting checks passed.
- The Windows snapshot, doctor health, doctor configuration, and database suites passed: 44 tests passed, 1 platform-specific test skipped.
- The source optimization compiles identically to the verified installed function after normalizing bundle symbol names.
- The archival patch passes a reverse-application check against the original worktree.
- The broader snapshot suite passed 44 tests and skipped 7, with 14 Windows test limitations: 12 missing POSIX utility invocations, one unsupported tab-containing filename, and one error-message expectation. The latter failure was independently reproduced against unmodified official 7.14.11 source. This broader suite is not claimed to be fully green.
