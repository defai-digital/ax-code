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

User-controlled input used in file paths without normalization or a containment check against the intended root directory. Look for string concatenation or path joins with external input that are never validated against a project, workspace, upload, or sandbox boundary.

### 2. Symlink escape

File operations that follow symlinks without resolving `realpath` against a root boundary. A symlink inside the project pointing outside it (e.g. `/etc/passwd`) bypasses logical path checks. Fix: resolve with `fs.realpath` and re-check containment after resolution.

### 3. Command injection

User input that changes shell command structure, flags, redirections, pipes, environment, or executable selection. Prioritize string-based shell execution (`exec`, `spawn` with `shell: true`, or command text assembled from untrusted input). Prefer fixed executables with argument arrays and explicit allowlists. Do not flag safe argument-array usage just because an argument value came from user input.

### 4. Isolation bypass

Permission checks that compare logical paths without also comparing canonical (`realpath`) paths. A symlink can make a protected path appear to be an approved bypass target. Reuse the repository's existing canonical-path or sandbox-boundary helper when one exists.

### 5. SSRF / URL validation

URLs constructed from user input without an allowlist or SSRF guard. Check for `fetch(userInput)` or similar. Prefer the repository's existing SSRF guard, URL allowlist, or network policy helper when one exists.

### 6. Untrusted deserialization

Data from external sources (plugins, config files, remote indexes, API responses, or extension boundaries) parsed without schema validation. Fix: gate external data through the repository's established schema or validation library before use.

### 7. Tool scope creep

Tool, plugin, command, or integration implementations that read or write outside the declared project/worktree boundary without going through the repository's containment or permission checks.

### 8. Secret or credential exposure

Secrets, API keys, tokens, or credentials written to logs, telemetry, error messages, persisted config, generated reports, or model-visible prompts without redaction.

### 9. Auth, session, or permission bypass

Routes, commands, workflow actions, or MCP/tool calls that trust caller-supplied project/session/user identifiers without checking project ownership, auth state, permission policy, or isolation mode.

## For each confirmed finding

- State: `file:line` - vulnerability class - trust boundary - concrete exploitation scenario.
- Cite the missing or insufficient guard and any existing guard that does not cover the scenario.
- Patch the minimal fix without broad refactors or behavior changes outside the security boundary.
- Add or update a focused regression test when the exploit path is locally testable.
- After patching, confirm the fix with the most specific relevant test or verification command for the current repository.
- Run the repository's local typecheck or equivalent static validation when the change touches typed code.
- Run broader workspace validation when the change crosses package, workspace, or shared library boundaries.
- If no focused test is practical, say why and describe the static/runtime evidence used instead.

## Skip

- Issues already addressed by existing guards such as containment checks, permission checks, allowlists, escaping, or sandbox policy.
- Theoretical findings with no concrete exploitation path in the current codebase.
- Style or correctness issues that are not security-relevant.
- Findings based only on keyword matches without a reachable trust boundary and sink.
