---
name: security-harden
description: Audit changed and surrounding code for security vulnerabilities, then implement patches for confirmed findings. Focuses on path traversal, symlink escape, injection, and isolation bypass.
argument-hint: [file, directory, or leave empty to audit current branch diff]
---

Audit $ARGUMENTS for security vulnerabilities and patch confirmed findings. If no argument is given, audit the files changed in the current branch (`git diff --name-only main`).

## Audit checklist

Work through each class for every file in scope:

### 1. Path traversal

User-controlled input used in file paths without normalization or a containment check (`Filesystem.contains`). Look for string concatenation or `path.join` with external input that is never validated against a root boundary.

### 2. Symlink escape

File operations that follow symlinks without resolving `realpath` against a root boundary. A symlink inside the project pointing outside it (e.g. `/etc/passwd`) bypasses logical path checks. Fix: resolve with `fs.realpath` and re-check containment after resolution.

### 3. Command injection

User input interpolated into shell commands - template literals passed to `exec`, `spawn`, or Bun's `$` tag without argument array form. Fix: use array argument form (`spawn([cmd, ...args])`) instead of shell interpolation.

### 4. Isolation bypass

Permission checks that compare logical paths without also comparing canonical (`realpath`) paths. A symlink can make a protected path appear to be an approved bypass target. Reference the existing `resolveClosestExistingPath` + `securityPaths` pattern in `src/isolation/index.ts`.

### 5. SSRF / URL validation

URLs constructed from user input without an allowlist or SSRF guard. Check for `fetch(userInput)` or similar. Reference `src/util/ssrf.ts` for the correct guard.

### 6. Untrusted deserialization

Data from external sources (MCP, config files, remote skill indexes) parsed without schema validation. Fix: gate all external data through a Zod schema before use.

### 7. Tool scope creep

Tool implementations (`src/tool/`) that read or write outside the declared project/worktree boundary without going through `assertSymlinkInsideProject` or `Instance.containsPath`.

## For each confirmed finding

- State: `file:line` - vulnerability class - concrete exploitation scenario (not theoretical).
- Patch: implement the minimal fix.
- After patching, confirm the fix with `bun test test/path/to/related.test.ts`.

## Skip

- Issues already addressed by existing guards (e.g. paths already checked via `Isolation.isAllowed`).
- Theoretical findings with no concrete exploitation path in the current codebase.
- Style or correctness issues that are not security-relevant.
