## ax-code risk map

- bootstrap: 2 files (2 deterministic, 0 live)
- sandbox: 3 files (3 deterministic, 0 live)
- provider: 5 files (4 deterministic, 1 live)
- persistence: 6 files (6 deterministic, 0 live)
- migration: 2 files (2 deterministic, 0 live)

Files:
- bootstrap: test/cli/boot.test.ts, test/cli/smoke.test.ts
- sandbox: test/isolation/isolation.test.ts, test/tool/bash.test.ts, test/permission/next.test.ts
- provider: test/provider/models.test.ts, test/provider/transform.test.ts, test/session/llm.test.ts, test/session/structured-output.test.ts, test/session/structured-output-integration.test.ts
- persistence: test/session/diff-recovery.test.ts, test/session/message-recovery.test.ts, test/session/prompt-flow.test.ts, test/session/prompt-resume.test.ts, test/session/revert-compact.test.ts, test/session/session-recovery.test.ts
- migration: test/cli/boot.test.ts, test/storage/json-migration.test.ts
