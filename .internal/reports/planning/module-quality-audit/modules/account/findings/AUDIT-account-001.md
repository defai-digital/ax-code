# `AUDIT-account-001`: Encryption silently degrades to publicly-knowable hostname-only key when install secret cannot be read or written

| Field | Value |
|-------|-------|
| ID | `AUDIT-account-001` |
| Module | [account](../MODULE-AUDIT.md) (cross-module: `auth`) |
| Primary category | `silent-error` |
| Secondary tags | `security`, `crypto`, `defense-in-depth` |
| Severity | `Medium` |
| Status | `accepted` |
| Origin | `new` |
| Reporter / owner | ax-code-glm (independent verifier pass) / unassigned |
| First observed | `39e1210ec5c638d15e3f453a5cc30e846f8057fb` on `2026-08-11` |
| Source | `packages/ax-code/src/auth/encryption.ts:63-89` (cross-referenced from `packages/ax-code/src/account/repo.ts:24-39`) |
| Impacted units | `account` (token storage), `auth` (W1-01, not yet audited) |
| Target / expiry | deferral review at W1-01 (`auth`) sign-off |
| Fix / test | pending — recommended owner: `auth` module owner |
| Independent verifier | recommended at fix time (security-adjacent) |

## Summary

Account access/refresh tokens and provider API keys are encrypted at rest with
AES-256-GCM keyed via PBKDF2 over a machine identifier. The intended design
derives the password from `hostname-platform-arch-<installSecret>` where
`installSecret` is a 256-bit random value persisted to
`<dataDir>/.install-secret`. When the data directory is unavailable (read
fails, write fails for any reason other than EEXIST, or `mkdirSync` throws),
`getInstallSecret()` catches **all** errors in a bare `catch {}` and sets
`installSecret = ""`. `machineId()` then degrades to
`${hostname}-${platform}-${arch}` — a value that is fully predictable to anyone
who knows the host (and partially predictable to anyone who can guess common
hostnames). Encryption continues to "succeed" using this weak key with no
`log.warn` on the degradation path, so an operator has no signal that the
per-install random secret was never used. The prior (ax-code-glm) review of the
`account` module recorded zero findings; this issue was discoverable because
`account/repo.ts` decrypts tokens through this module on every
`Account.token()` / `resolveAccess()` call.

## Evidence

### Source and control/data flow

- Reviewed commit: `39e1210ec5c638d15e3f453a5cc30e846f8057fb`
- Primary location: `packages/ax-code/src/auth/encryption.ts:63-101`
  - `getInstallSecret()` lines 63-89: bare `catch {}` at line 84 sets
    `installSecret = ""` for any failure (not just "tests" as the comment at
    line 85 claims — real filesystem permission errors, full disk, AV lock,
    sandbox denials all collapse to the same silent empty-string fallback).
  - `machineId()` lines 97-101: `if (!secret) return legacyMachineId()` — the
    empty string is falsy, so it transparently returns the hostname-only id.
  - `encrypt()` lines 131-150: picks `version = 1` (the high-iteration path)
    when there is no install secret, so the on-disk ciphertext is
    indistinguishable from a legacy v1 entry — no marker records that this
    machine never obtained a per-install secret.
- Token-load entrypoint: `packages/ax-code/src/account/repo.ts:102-108`
  (`decryptRow`) → `decryptToken` (24-39) → `auth/encryption.decrypt`.
- Failure sink: tokens are silently encrypted/decrypted under a weak,
  predictable key; operator sees only a `log.info` on first-run generation
  (line 75) and a `log.debug` per decryption attempt (lines 179-210), never a
  warning that the install secret is missing at runtime.

Static proof:

1. `Account.token(accountID)` (`account/index.ts:372`) → `resolveAccess` →
   `resolveToken` → `AccountRepo.getRow` → `decryptRow` → `decryptToken` →
   `auth.decrypt`.
2. If `Global.Path.data` is unwritable/unreadable at first run,
   `getInstallSecret()` returns `""`, `machineId()` returns the hostname-only
   string, and PBKDF2 derives a key from public inputs only.
3. AES-GCM still succeeds (it does not care about key strength), so the
   canary/decrypt path reports healthy and tokens round-trip normally — but
   the ciphertext is recoverable by any party who can read the on-disk SQLite
   store and knows the host identity. No existing defense raises an alarm: the
   `log.info("generated install secret…")` only fires on the success path.

### Reproduction or failing test

Preconditions: a process whose data directory is read-only or absent (e.g.
`HOME` pointed at a read-only path, container with a mounted read-only config
volume, sandboxed runner that denies writes outside the workspace).

```bash
# Conceptual — point the data dir at an unwritable location
AX_DATA_DIR=/proc/nonexistent ax-code account list
# (or any provider operation that triggers Account.token())
```

Expected: a `log.warn` (or refusal to encrypt with a degraded key) clearly
stating the install secret could not be persisted, so the operator knows
at-rest encryption is using the hostname-only fallback.

Observed: no warning on the degradation path; tokens are transparently
encrypted under the legacy hostname-only key. The only log lines emitted are
`log.info` (on successful first-run generation) and `log.debug` (per
decryption attempt).

Static proof is sufficient — dynamic reproduction requires an unwritable data
dir and is environment-dependent, but the control flow above is unambiguous.

## Impact and severity

- Affected users/systems: any user whose `Global.Path.data` is temporarily or
  permanently unwritable (sandboxed CI, containers with read-only rootfs,
  misconfigured permissions, full disk during first run, AV file-lock races).
- Reachability/frequency: edge on developer laptops (data dir is normally
  writable), more common in CI/containers/headless runners. Silent when it
  happens.
- Blast radius: all at-rest account tokens and (via the shared `auth`
  module — to be audited as W1-01) provider API keys encrypted on that host.
- Data/security consequence: an attacker who obtains the SQLite database file
  (backup leak, shared config, stolen laptop disk image) and knows the host's
  hostname/platform/arch can derive the key offline. Recovery requires
  re-running login on a host with a writable data dir to re-encrypt.
  AES-256-GCM otherwise holds; the weakness is solely the key-derivation
  password entropy.
- Workaround: ensure the data directory is writable; rotate credentials if a
  host was ever run in the degraded state.
- Severity rationale: per PRD rubric this is Medium — not Critical (GCM still
  provides confidentiality/integrity against remote attackers without the DB
  file; the host identity is not universally public), but above Low because the
  degradation is completely silent and the fallback password is low-entropy
  and partially predictable. The bare `catch {}` also violates the program's
  silent-error policy.

## Root cause and violated invariant

Required invariant:

> At-rest credential encryption must either use the per-install random secret
> or fail loudly. It must never silently fall back to a publicly-knowable
> hostname-only key derivation while reporting success.

Root cause: `getInstallSecret()` treats all filesystem failures as the
"unit-test, no data dir" case and returns `""`; `machineId()` treats the empty
string identically to "no secret feature available", collapsing a runtime
failure into a permanent silent downgrade. There is no distinction between
"feature disabled by environment" and "feature failed at runtime".

Prior-art lineage: none linked. The prior `account` review (Reviewer:
ax-code-glm, 2026-08-11) recorded zero findings; this issue lives one import
away in `auth/encryption.ts` and was not surfaced because the prior pass
scoped only to the four files directly under `src/account/`.

## Recommended fix

### Minimal approach

1. In `getInstallSecret()`, distinguish "first run, will create" from
   "filesystem failure". On the failure branch, emit
   `log.warn("could not persist install secret; encryption falling back to
   hostname-only key", { error })` and set a module-level `degradedFlag` so
   callers can surface it once at startup (e.g. via `account doctor` /
   `auth health`).
2. Optionally: have `encrypt()` write `version` such that a degraded key is
   detectable on disk (e.g. a `degraded: true` marker), so a later healthy
   run can re-encrypt. (Larger change; can be deferred.)
3. Regression test: simulate an unwritable data dir (e.g. `chmod 000` on a
   tmpdir, or inject a failing `writeFileSync` via dependency seam) and
   assert that (a) a `log.warn` is emitted and (b) `getInstallSecret()`
   returns `""` rather than throwing.

Why this is the smallest safe change: it does not alter the crypto or the
on-disk format — it only makes the existing degradation path observable,
satisfying the silent-error policy without breaking backward compatibility.

### Alternatives considered

| Alternative | Benefit | Cost/risk | Decision |
|-------------|---------|-----------|----------|
| Refuse to encrypt when install secret is unavailable | Strongest guarantee | Breaks first-run on read-only filesystems; many existing flows depend on best-effort encryption | reject — backward-incompatible |
| Mark degraded ciphertexts on disk and auto-re-encrypt later | Detectable + self-healing | Schema/format change; cross-module (touches `auth`) | defer to W1-01 `auth` audit |
| Only warn (this proposal) | Zero format change, observable | Operator must act on the warning | select |

Compatibility, migration, rollback: no on-disk change; warning is additive.
Cross-module: the fix lives in `auth/encryption.ts` (W1-01) but is filed
under `account` because that is where it was discovered and where the
runtime impact (token decryption) is observed. Recommend re-homing to `auth`
when W1-01 is audited, retaining this ID per the no-rename rule.

## Test and verification plan

### Regression test

- Test path/name: `packages/ax-code/test/auth/encryption.test.ts` (new or
  existing) — `getInstallSecret warns and degrades when data dir is unwritable`.
- Before fix: no warning emitted; test asserts presence of warn log.
- After fix: `log.warn` called with `service: "auth/encryption"` and a message
  matching `/could not persist install secret|fallback/i`.
- Negative case: when the data dir is writable, no degradation warning is
  emitted and `getInstallSecret()` returns a 64-char hex string.

### Commands

```bash
cd packages/ax-code
AX_TEST_FILES=test/auth/encryption.test.ts pnpm exec vitest run
pnpm --dir packages/ax-code run typecheck
```

## Resolution record

| Event | Date | Actor | Evidence/notes |
|-------|------|-------|----------------|
| Candidate created | 2026-08-11 | ax-code-glm (independent verifier pass) | static control-flow proof above |
| Accepted | 2026-08-11 | ax-code-glm | meets silent-error + defense-in-depth bars |
| Fix ready | — | — | pending |
| Verification complete | — | — | pending |
| Closed/deferred | 2026-08-11 | ax-code-glm | deferred to W1-01 `auth` audit (see below) |

### Verification result

- Source re-read at fix commit: pending
- Regression command/result: pending
- Package/wave gates: not yet run (no code change)
- Residual risk: at-rest tokens on hosts with unwritable data dirs remain
  encrypted under a predictable key until the fix lands.

### Independent Critical verification

Not required — severity is Medium. Independent verifier recommended at fix
time because the finding is security-adjacent.

## Deferral

- Why a verified fix cannot land now: the owning module is `auth` (W1-01),
  which is `NOT STARTED` in STATUS.md and was out of scope for this pass
  (mission scoped the reviewer to `account`). The fix touches
  `auth/encryption.ts`, which is shared by every provider API-key path and
  should be reviewed under the `auth` unit, not drive-by patched from the
  `account` unit.
- Interim mitigation/disabled exposure: none automatic. Operators can
  confirm health by checking that `Global.Path.data/.install-secret` exists
  and is readable after first run; if absent, the host is in the degraded
  state and credentials should be rotated after restoring writability.
- Residual risk accepted by: pending — requires `auth` module owner.
- Owner: `auth` module owner (W1-01, unassigned).
- Review/expiry date: `2026-09-15` (next Wave 1 security gate).
- Trigger for reopening: any report of credential exposure from a host where
  `.install-secret` was never written.
- ADR: N/A (not decision-level).
