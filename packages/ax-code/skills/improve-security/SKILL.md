---
name: improve-security
description: Audit changed and surrounding code for confirmed security vulnerabilities, then implement minimal hardening patches. Focuses on exploitability, path traversal, symlink escape, injection, isolation bypass, SSRF, and unsafe external input handling.
argument-hint: "[file, directory, or leave empty to audit current branch diff]"
---

Audit $ARGUMENTS for security vulnerabilities and patch confirmed findings. If no argument is given, start from files changed in the current branch (`git diff --name-only main`) and narrow the security-relevant scope before editing.

## Scope selection

- List candidate files first and exclude generated files, snapshots, lockfiles, vendored files, build outputs, and unrelated docs.
- Prefer files that handle untrusted input, file paths, permissions, isolation, process execution, networking, secrets, auth/session state, config loading, MCP/tool boundaries, or remote data.
- If the changed-file set crosses unrelated domains, choose one coherent security slice and report the rest as follow-up candidates.
- Do not patch style, maintainability, or general correctness issues unless they create a concrete security risk.

## Exploitability gate

Classify each suspected issue before patching:

- **Confirmed vulnerability**: there is a reachable path from attacker-controlled or lower-trust input to a security-sensitive sink, no existing guard blocks it, and the impact is concrete.
- **Defense-in-depth hardening**: no direct exploit is proven, but a small guard clearly strengthens a trust boundary without changing intended behavior.
- **False positive / already guarded**: an existing containment, allowlist, schema, auth, isolation, or escaping layer blocks the scenario.
- **Needs more evidence**: exploitability depends on unknown runtime state, caller guarantees, or external configuration.

Patch only confirmed vulnerabilities and low-risk defense-in-depth hardening. Do not present `needs more evidence` or theoretical findings as vulnerabilities.

## Audit checklist

Work through each class for every file in scope:

### 1. Path traversal

User-controlled input used in file paths without normalization or a containment check (`Filesystem.contains`). Look for string concatenation or `path.join` with external input that is never validated against a root boundary.

### 2. Symlink escape

File operations that follow symlinks without resolving `realpath` against a root boundary. A symlink inside the project pointing outside it (e.g. `/etc/passwd`) bypasses logical path checks. Fix: resolve with `fs.realpath` and re-check containment after resolution.

### 3. Command injection

User input that changes shell command structure, flags, redirections, pipes, environment, or executable selection. Prioritize string-based shell execution (`exec`, `spawn` with `shell: true`, or command text assembled from untrusted input). Prefer fixed executables with argument arrays and explicit allowlists. Do not flag safe argument-array usage just because an argument value came from user input.

### 4. Isolation bypass

Permission checks that compare logical paths without also comparing canonical (`realpath`) paths. A symlink can make a protected path appear to be an approved bypass target. Reference the existing `resolveClosestExistingPath` + `securityPaths` pattern in `src/isolation/index.ts`.

### 5. SSRF / URL validation

URLs constructed from user input without an allowlist or SSRF guard. Check for `fetch(userInput)` or similar. Reference `src/util/ssrf.ts` for the correct guard.

### 6. Untrusted deserialization

Data from external sources (MCP, config files, remote skill indexes) parsed without schema validation. Fix: gate all external data through a Zod schema before use.

### 7. Tool scope creep

Tool implementations (`src/tool/`) that read or write outside the declared project/worktree boundary without going through `assertSymlinkInsideProject` or `Instance.containsPath`.

### 8. Secret or credential exposure

Secrets, API keys, tokens, or credentials written to logs, telemetry, error messages, persisted config, generated reports, or model-visible prompts without redaction.

### 9. Auth, session, or permission bypass

Routes, commands, workflow actions, or MCP/tool calls that trust caller-supplied project/session/user identifiers without checking project ownership, auth state, permission policy, or isolation mode.

## For each confirmed finding

- State: `file:line` - vulnerability class - trust boundary - concrete exploitation scenario.
- Cite the missing or insufficient guard and any existing guard that does not cover the scenario.
- Patch the minimal fix without broad refactors or behavior changes outside the security boundary.
- Add or update a focused regression test when the exploit path is locally testable.
- After patching, confirm the fix with the relevant focused test from `packages/ax-code/` and run `bun run typecheck` for package-local TypeScript changes.
- Run root `pnpm typecheck` when the change crosses workspace packages or shared package boundaries.
- If no focused test is practical, say why and describe the static/runtime evidence used instead.

## Skip

- Issues already addressed by existing guards (e.g. paths already checked via `Isolation.isProtected`).
- Theoretical findings with no concrete exploitation path in the current codebase.
- Style or correctness issues that are not security-relevant.
- Findings based only on keyword matches without a reachable trust boundary and sink.
