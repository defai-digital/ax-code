# `AUDIT-account-002`: `decryptToken` silently treats non-encrypted stored values as plaintext tokens

| Field | Value |
|-------|-------|
| ID | `AUDIT-account-002` |
| Module | [account](../MODULE-AUDIT.md) |
| Primary category | `quality` |
| Secondary tags | `security`, `defense-in-depth`, `silent-error` |
| Severity | `Low` |
| Status | `accepted` |
| Origin | `new` |
| Reporter / owner | ax-code-glm (independent verifier pass) / unassigned |
| First observed | `39e1210ec5c638d15e3f453a5cc30e846f8057fb` on `2026-08-11` |
| Source | `packages/ax-code/src/account/repo.ts:24-39` |
| Impacted units | `account` |
| Target / expiry | deferral — see below |
| Fix / test | pending |
| Independent verifier | not required (Low) |

## Summary

`decryptToken()` in `account/repo.ts` checks whether a stored token parses as
an `EncryptedValue`; if it does not, it calls `make(raw)` and returns the raw
stored string as a branded token. This is documented as backward compatibility
with legacy plaintext tokens, but it means a corrupted, downgraded, or
tampered token row that fails `isEncrypted` is silently accepted and used as
a live credential rather than rejected. There is no warning log on this
fallback path (only the `catch` branch at line 30 logs). Combined with
`AUDIT-account-001`, a host that silently downgraded its encryption key would
also silently accept the resulting ciphertext as a "plaintext" token if the
`isEncrypted` shape check happens to fail.

## Evidence

### Source and control/data flow

- Reviewed commit: `39e1210ec5c638d15e3f453a5cc30e846f8057fb`
- Primary location: `packages/ax-code/src/account/repo.ts:24-39`
- Callers: `decryptRow` (line 102) → used by `AccountRepo.getRow` (line 145)
  → `Account.resolveAccess` / `resolveToken` (`account/index.ts:259,317`).
- Failure sink: the raw stored string flows into `AccessToken.make` /
  `RefreshToken.make` and is then sent as a `Bearer` token to the account
  server (`bearer()` at line 223, used in `fetchOrgs`/`fetchUser`/`config`).

Static proof:

1. `parseEncryptedToken(raw)` (line 15) runs `parseJsonRecord(raw)` then
   `decodeEncryptedTokenValue` → `isEncrypted(value)`.
2. `isEncrypted` (`auth/encryption.ts:263-272`) returns false for any value
   whose `encrypted/iv/tag/version` fields are not all present-and-typed —
   including valid JSON records that happen to omit a field, or any non-JSON
   string.
3. On the false branch, `decryptToken` returns `make(raw)` (line 27) with no
   log line, so the caller cannot distinguish "legacy plaintext token" from
   "corrupted/tampered ciphertext".

### Reproduction or failing test

Unsafe to reproduce dynamically (would require writing a malformed token to
the live account DB). Static proof is sufficient and unambiguous.

## Impact and severity

- Affected users/systems: any account row whose stored token is not a valid
  `EncryptedValue` (legacy plaintext rows; rows corrupted by a partial write;
  rows migrated incorrectly).
- Reachability/frequency: rare on normal flows; the encrypt path always
  writes a valid `EncryptedValue`. Relevant for disaster/recovery and
  migration scenarios.
- Blast radius: the token for a single account row.
- Data/security consequence: a tampered token is sent to the auth server
  (which will reject it) rather than failing locally with a clear "token
  corrupted" error. No credential disclosure; the user-visible symptom is an
  opaque auth failure instead of an actionable local error.
- Workaround: re-login.
- Severity rationale: Low — the auth server rejects invalid tokens, so there
  is no privilege escalation; the impact is observability/diagnosability plus
  a thin defense-in-depth gap. Filed because the program policy requires
  silent-error paths to be classified, not because exploit is likely.

## Root cause and violated invariant

Required invariant:

> A stored credential that fails to decrypt must produce a distinct, logged
> error. It must not be silently re-interpreted as a plaintext credential.

Root cause: the legacy-plaintext migration path and the corruption path share
the same code branch (`if (!encrypted) return make(raw)`) with no logging and
no marker to distinguish them.

Prior-art lineage: none linked.

## Recommended fix

### Minimal approach

1. On the `!encrypted` branch in `decryptToken`, emit
   `log.warn("stored token is not encrypted; treating as legacy plaintext", { accountID })`
   so the fallback is observable (mirror the style of the existing
   `log.warn("failed to decrypt token", …)` on line 31).
2. (Optional, larger) require an explicit `allowPlaintextFallback` flag for
   the migration window and remove the unconditional fallback once legacy
   rows are migrated. Defer if migration status is unknown.
3. Regression test: store a non-`EncryptedValue` string in a test account
   row and assert that (a) `getRow` returns it and (b) a `log.warn` is
   captured.

Why this is the smallest safe change: additive logging only; no behavior or
schema change.

### Alternatives considered

| Alternative | Benefit | Cost/risk | Decision |
|-------------|---------|-----------|----------|
| Reject non-encrypted tokens outright | Strongest invariant | Breaks legacy plaintext migration | reject without migration audit |
| Log only (this proposal) | Observable, zero behavior change | Operator must read logs | select |
| Gated flag + later removal | Self-cleaning | Requires migration tracking | defer |

Compatibility, migration, rollback: none required for the logging-only change.

## Test and verification plan

### Regression test

- Test path/name: `packages/ax-code/test/account/repo.test.ts` —
  `decryptToken warns when stored value is not encrypted`.
- Before fix: no warning.
- After fix: `log.warn` captured with `service: "account.repo"`.

### Commands

```bash
cd packages/ax-code
AX_TEST_FILES=test/account/repo.test.ts pnpm exec vitest run
pnpm --dir packages/ax-code run typecheck
```

## Resolution record

| Event | Date | Actor | Evidence/notes |
|-------|------|-------|----------------|
| Candidate created | 2026-08-11 | ax-code-glm (independent verifier pass) | static proof above |
| Accepted | 2026-08-11 | ax-code-glm | Low-severity silent-error classification |
| Fix ready | — | — | pending |
| Verification complete | — | — | pending |
| Closed/deferred | 2026-08-11 | ax-code-glm | deferred (Low, no behavior change mandated) |

### Verification result

- Source re-read at fix commit: pending
- Regression command/result: pending
- Package/wave gates: not yet run (no code change)
- Residual risk: none beyond the existing diagnosability gap.

### Independent Critical verification

Not required — Low severity.

## Deferral

- Why a verified fix cannot land now: the finding is Low severity with no
  exploitable path (the auth server rejects invalid tokens). The minimal fix
  is additive logging that can be bundled into the next `account`/`auth`
  change to avoid a standalone churn commit, and the larger "reject legacy
  plaintext" path requires a migration audit that belongs in the `auth`
  (W1-01) scope.
- Interim mitigation: none required; re-login recovers.
- Residual risk accepted by: pending `account`/`auth` owner.
- Owner: `account` module owner (W1-02).
- Review/expiry date: `2026-09-15` (next Wave 1 gate).
- Trigger for reopening: any incident where a corrupted token caused a
  non-actionable auth failure.
- ADR: N/A.
