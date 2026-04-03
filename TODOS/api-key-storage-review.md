# API Key Storage Review

Date: 2026-04-02

Reviewed statement:

> API keys are encrypted at rest using AES-256-GCM with a machine-derived key. Keys are stored in the user's config directory and are never sent anywhere other than the configured LLM provider.

## Verdict

The current statement is too strong and partially inaccurate.

It should be revised before being used in README, SECURITY docs, or marketing copy.

## What the Code Actually Does

### Provider API keys

Implementation:
- API keys are encrypted before writing `auth.json` in [auth/index.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/auth/index.ts#L93)
- Encryption uses AES-256-GCM in [encryption.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/auth/encryption.ts#L17)
- The encryption key is derived from `hostname + platform + arch` via PBKDF2 in [encryption.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/auth/encryption.ts#L34) and [encryption.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/auth/encryption.ts#L38)
- The encrypted file is written with mode `0600` in [auth/index.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/auth/index.ts#L97)

### Storage location

The current statement says “config directory”, but the code stores credentials in the XDG data directory:
- `auth.json` path: [auth/index.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/auth/index.ts#L11)
- `Global.Path.data`: [global/index.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/global/index.ts#L9) and [global/index.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/global/index.ts#L15)

So this part is factually wrong today.

### Other sensitive credentials

The security copy is also incomplete because not all stored secrets follow the same protection model:
- MCP OAuth tokens and client info are stored in `mcp-auth.json` in plaintext JSON with `0600` permissions in [mcp/auth.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/mcp/auth.ts#L32) and [mcp/auth.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/mcp/auth.ts#L66)
- Account access and refresh tokens are stored in SQLite plaintext columns in [account/account.sql.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/account/account.sql.ts#L6) and persisted in [account/repo.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/account/repo.ts#L111)

So the current posture is not “secret storage is encrypted at rest”; it is narrower:
- provider API keys in `auth.json` are encrypted
- other credentials are not consistently encrypted

## Main Problems

### 1. “Machine-derived key” is weak wording unless threat model is explicit

The encryption key is derived from:
- hostname
- platform
- architecture

That means:
- it protects against casual accidental disclosure
- it does not provide strong protection against host compromise
- it is not equivalent to OS keychain or hardware-backed secret storage

The code comment already admits this in [encryption.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/auth/encryption.ts#L8), but the public statement does not.

### 2. Storage location is documented incorrectly

The statement says “config directory”.

Actual path:
- XDG data directory via `Global.Path.data`

This should be fixed immediately.

### 3. The statement implies a stronger consistency than the code provides

Today:
- `auth.json` API keys: encrypted
- `mcp-auth.json` OAuth tokens/client info: plaintext JSON
- `account` table access/refresh tokens: plaintext in SQLite

That inconsistency is a bigger issue than the crypto primitive choice.

### 4. “Never sent anywhere other than the configured LLM provider” is too absolute

This is risky wording for a local agent system with:
- plugin auth flows
- custom providers
- well-known auth flows
- server mode APIs that can accept credential writes

Even if the normal path is provider-bound, the sentence is broader than the guarantee the code can safely make.

### 5. Some CLI surfaces still reveal credential fragments

Example:
- MCP command prints the first 20 chars of the access token in [mcp.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/cli/cmd/mcp.ts#L688)

That is unnecessary disclosure and should be removed or replaced with redacted metadata.

## Recommended Rewrite

### Minimum accurate wording

Use this if you want a conservative statement that matches the code more closely:

> Provider API keys stored by AX Code are encrypted at rest using AES-256-GCM and written with user-only file permissions. The encryption key is derived from local machine attributes, so this protects mainly against casual offline disclosure, not against a local attacker with access to the host. Stored credentials currently live under AX Code’s local data directory.

### Better wording after implementation cleanup

Use this only after the follow-up work below is done:

> AX Code stores credentials using platform-appropriate secure storage. Where OS keychain integration is unavailable, AX Code falls back to local encrypted storage with restricted file permissions. Sensitive tokens are redacted in logs and CLI output.

## Recommendation

Do not keep iterating on the current machine-derived-key design as the long-term answer.

Best direction:

1. Use OS-native secure storage by default.
2. Keep encrypted-file fallback only for environments where keychain integration is unavailable.
3. Unify protection across:
   - provider API keys
   - MCP OAuth tokens
   - account access/refresh tokens
4. Fix public wording so it reflects the actual threat model.

## Proposed Design

### Preferred storage hierarchy

Order:

1. OS keychain / credential vault
   - macOS Keychain
   - Windows Credential Manager / DPAPI-backed secret storage
   - Linux Secret Service / libsecret
2. Encrypted local fallback
   - if no keychain is available
   - must use a user-supplied or OS-protected wrapping secret if possible
3. Plaintext local fallback
   - avoid
   - only allow behind explicit dev/test mode

### Unification target

Move all secret-bearing data behind one credential storage abstraction:

- provider API keys
- MCP OAuth access/refresh tokens
- account access/refresh tokens
- provider “wellknown” bearer tokens
- client secrets where stored

Suggested abstraction:

```ts
CredentialStore.get(scope, key)
CredentialStore.set(scope, key, value)
CredentialStore.remove(scope, key)
CredentialStore.list(scope)
```

Metadata that is not sensitive can still stay in JSON/SQLite.

### Split secret from metadata

Recommended pattern:
- JSON / DB stores identifiers and non-secret metadata
- secrets go into credential storage

Examples:
- `auth.json` keeps provider IDs and credential type, but not raw secret blobs
- `mcp-auth.json` keeps server URL and expiry metadata, but token bodies go into credential storage
- `account` table keeps account id, URL, email, expiry, org state; tokens move out

## Concrete Problems To Fix

### P0

- Fix public wording in [SECURITY.md](/Users/akiralam/code/ax-code/SECURITY.md) and [README.md](/Users/akiralam/code/ax-code/README.md)
- Stop saying “config directory”; change to actual location or generic “local AX Code data directory”
- Remove token prefix display from [mcp.ts](/Users/akiralam/code/ax-code/packages/ax-code/src/cli/cmd/mcp.ts#L688)
- Add a clear threat-model note: machine-derived encryption does not protect against local host compromise

### P1

- Introduce a `CredentialStore` abstraction
- Move MCP OAuth tokens out of plaintext JSON
- Move account access/refresh tokens out of plaintext SQLite
- Centralize redaction rules for logs, TUI, debug output, and errors

### P2

- Add OS keychain support
- Keep encrypted-file fallback for unsupported environments
- Add migration from existing `auth.json`, `mcp-auth.json`, and `account` DB tokens into the new store
- Add doctor/debug output that reports storage backend without exposing values

## Suggested Rollout

### Phase 1: correct the claim

- Update docs with accurate wording
- Add explicit threat-model language
- Remove partial token printing from CLI

### Phase 2: centralize secret handling

- Build `CredentialStore`
- Route provider API keys through it first
- Add tests for redaction and migration

### Phase 3: migrate all tokens

- MCP OAuth tokens
- account tokens
- client secrets

### Phase 4: harden and document

- add backend diagnostics
- add secure export/import story if needed
- document fallback behavior clearly

## Bottom Line

The current design is acceptable as a short-term “better than plaintext in a JSON file” measure for provider API keys.

It is not strong enough to justify broad security language, and it is not applied consistently across all credential types.

The real improvement path is:
- accurate wording now
- unified credential abstraction next
- OS keychain by default after that
