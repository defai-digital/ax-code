# Protocol Steps: auth

- Slug: `auth`
- Lane: `codex-sol`
- Date: `2026-08-11`

## Step 1 Map

The unit exposes the `Auth` namespace and its `Info`, `Oauth`, `Api`, `WellKnown`, `all`, `get`, `set`, and `remove` surfaces from `packages/ax-code/src/auth/index.ts:227-439`. Its cryptographic boundary is implemented by `encrypt`, `decrypt`, field helpers, and canary helpers in `packages/ax-code/src/auth/encryption.ts:140-359`, while `packages/ax-code/src/project/instance.ts:81-260` supplies the per-project state and disposal semantics used by the read cache.

## Step 2 Threat model

Credential plaintext crosses from provider callers into `Auth.set`, is encrypted before persistence, and later crosses back through `Auth.get`; theft or replacement of `auth.json`, `.install-secret`, or the lock file are the principal local storage threats (`packages/ax-code/src/auth/index.ts:22-224`, `packages/ax-code/src/auth/encryption.ts:50-138`). Concurrent processes are a separate trust boundary because stale-lock recovery could otherwise unlink a newly acquired lock, and legacy ciphertext plus malformed records must fail closed without erasing still-recoverable entries (`packages/ax-code/src/auth/index.ts:98-224`, `packages/ax-code/src/auth/index.ts:299-393`).

## Step 3 Correctness

`Auth.all()` coalesces concurrent reads, `loadAll()` validates the canary, and legacy migration re-reads the raw file under both the in-process and filesystem locks before requiring exact text equality (`packages/ax-code/src/auth/index.ts:299-409`). `set` and `remove` reject corrupt JSON rather than replacing it, serialize mutation, and refresh the canary before atomically writing the complete map (`packages/ax-code/src/auth/index.ts:411-439`). The stale-lock path claims a snapshot and revalidates both body and mtime before unlinking, while fresh malformed or partial lock bodies receive a grace period (`packages/ax-code/src/auth/index.ts:98-224`).

## Step 4 Performance

PBKDF2 is intentionally on the credential read/write path: version 2 uses the random installation secret with 10,000 iterations, while the compatibility version uses 600,000 iterations against weaker machine identity material (`packages/ax-code/src/auth/encryption.ts:107-196`). The module avoids repeating that work through an installation-secret cache and `Auth.all()` promise coalescing (`packages/ax-code/src/auth/encryption.ts:54-103`, `packages/ax-code/src/auth/index.ts:395-409`); the credentials file is expected to remain small, so whole-file JSON mutation is appropriate.

## Step 5 Design

Cryptography is cohesive in `packages/ax-code/src/auth/encryption.ts`, while schema validation, locking, migration, and provider-key normalization live in `packages/ax-code/src/auth/index.ts`; this keeps callers from handling ciphertext directly. The layered locks are justified because the local `Lock` protects awaits in one process and the tokenized `auth.json.lock` protects competing processes, with `packages/ax-code/src/project/instance.ts:81-260` separately owning cache lifetime.

## Step 6 Dead code/hygiene

No TODO, FIXME, or empty `catch {}` was found in the two auth implementation files; expected filesystem failures are classified or logged in `packages/ax-code/src/auth/index.ts:98-224` and `packages/ax-code/src/auth/encryption.ts:63-94`. The test-only cache reset at `packages/ax-code/src/auth/encryption.ts:96-103` is explicitly named and used by `packages/ax-code/test/auth/encryption.test.ts:37-42`, so it is not an orphaned production surface.

## Step 7 Tests

`packages/ax-code/test/auth/encryption.test.ts:44-116` covers version-2 round trips, legacy decryption, malformed envelopes, re-encryption marking, and the warned fallback when the installation secret is unavailable. `packages/ax-code/test/auth/auth.test.ts:73-259` covers corrupt-file preservation, canary coalescing, stale and partial locks, concurrent writes during migration, and stale-snapshot revalidation. A remaining gap is a real multi-process contention test using two OS processes; current tests exercise the algorithm and source regression but not filesystem scheduling between independent runtimes.

## Step 8 Findings

Three existing findings were rechecked: `docs/module-quality-audit/modules/auth/findings/AUDIT-auth-001.md` is Medium and verified-fixed by warning on installation-secret fallback, while `AUDIT-auth-002.md` and `AUDIT-auth-003.md` are High and verified-fixed by fresh-lock grace/revalidation and exact-content migration checks. Their regression evidence is present in `packages/ax-code/test/auth/encryption.test.ts:86-116` and `packages/ax-code/test/auth/auth.test.ts:196-259`. No new finding was accepted because the remaining multi-process test gap does not demonstrate a violated runtime invariant, and this unit has no Critical finding requiring `reverify.md`.

## Step 9 Verification

I ran `AX_TEST_FILES=test/auth/encryption.test.ts,test/auth/auth.test.ts,test/config/config.test.ts,test/config/markdown.test.ts,test/config/permission-env.test.ts,test/config/tui.test.ts pnpm --dir packages/ax-code exec vitest run`; all six files and 186 tests passed, including the auth regressions in `packages/ax-code/test/auth/auth.test.ts`. I also ran `pnpm --dir packages/ax-code run typecheck`, which passed; a release audit could additionally repeat the auth tests from a second process to exercise the lock boundary.
