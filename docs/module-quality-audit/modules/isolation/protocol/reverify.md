# Independent Critical Re-verification: isolation

Verifier: ax-code-glm

- Finding: `AUDIT-isolation-001`
- Date: `2026-08-11`
- Verdict: `verified-fixed`

## Evidence re-read

The current Seatbelt profile begins with deny-default and enumerates process, sysctl-read, signal, system-socket, file-read, narrowly scoped file-write, and conditional network rules at `packages/ax-code/src/isolation/os-sandbox.ts:190-203`. It contains neither `(allow mach*)` nor `(allow ipc*)`. `wrapCommand` supplies that generated profile to `sandbox-exec` at `packages/ax-code/src/isolation/os-sandbox.ts:238-273`, and the restricted bash path reaches the wrapper only after application checks at `packages/ax-code/src/tool/bash-impl.ts:656-673`.

The fix provenance named by `docs/module-quality-audit/modules/isolation/findings/AUDIT-isolation-001.md:13-18` was independently compared with the current tree: commit `8a38b90b950855545c6b2479220274357904f111` removes exactly the two wildcard grants and adds negative regression assertions. Those assertions remain at `packages/ax-code/test/isolation/os-sandbox.test.ts:31-47`.

## Independent execution

The focused command covering `isolation.test.ts`, `os-sandbox.test.ts`, and `os-sandbox-integration.test.ts` passed all 48 tests in 3 files after the macOS integration fixture was granted its required home-directory access. This exercised actual `sandbox-exec` behavior: workspace and temporary writes succeeded and an outside write was denied as asserted at `packages/ax-code/test/isolation/os-sandbox-integration.test.ts:79-89`. `pnpm --dir packages/ax-code run typecheck` also passed.

## Verdict

`AUDIT-isolation-001` remains verified-fixed. The formerly unrestricted Mach and IPC capabilities are absent from production policy, guarded by source-level negative tests, and the narrowed Seatbelt profile still supports the documented workload under a live macOS integration run.
