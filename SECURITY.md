# Security Policy

## Supported Versions

Only the latest minor line receives security patches. Upgrade to the current
minor before reporting a vulnerability against an older line.

| Version | Supported |
| ------- | --------- |
| 7.1.x   | Yes       |
| < 7.1   | No        |

## Reporting a Vulnerability

We take security seriously. If you discover a vulnerability, please report it responsibly:

1. **GitHub Advisory** (preferred): Use the ["Report a Vulnerability"](https://github.com/defai-digital/ax-code/security/advisories/new) tab.
2. **Discord**: Report it in our Discord: https://discord.gg/gf9UyPxaN2

We will acknowledge your report within **6 business days** and keep you informed of progress toward a fix.

> **Note:** We do not accept AI-generated security reports. Submitting one will result in a ban from the project. Please ensure your report includes specific reproduction steps and demonstrates a real impact.

---

## Threat Model

### Overview

ax-code is an AI-powered coding assistant that runs locally on your machine. It provides an agent system with access to powerful tools including shell execution, file operations, and web access.

The runtime isolation default is `workspace-write` with network disabled. This is the default safe posture for local repository work: the agent can edit inside the workspace, but writes outside the workspace, protected-path writes, and network tools require an explicit boundary change.

### Execution Isolation Sandbox

ax-code includes a built-in execution isolation sandbox that restricts what the AI agent can access. Three modes are available:

| Mode                          | Behavior                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Workspace write** (default) | Allows writes only inside the workspace; `.git` and `.ax-code` are always protected; network disabled by default |
| **Read-only**                 | Blocks all file mutations and shell commands                                                                     |
| **Full access**               | Disables isolation entirely                                                                                      |

Key properties:

- **Default behavior** — AX Code starts in `workspace-write` unless `--sandbox`, `AX_CODE_ISOLATION_MODE`, or config sets a different mode
- **Explicit unrestricted mode** — use `full-access` only when you intentionally want to disable isolation
- **Tool-level enforcement** — all mutation tools (bash, edit, write, apply_patch) and network tools (webfetch, websearch, codesearch) check isolation policy before executing
- **Protected paths** — `.git` and `.ax-code` directories are always protected from writes, even in workspace-write mode
- **Escalation prompts** — isolation violations present an approval dialog instead of silently failing; users can allow a blocked operation once without changing their config
- **CLI control** — `--sandbox read-only`, `--sandbox workspace-write`, `--sandbox full-access`
- **Environment variable** — `AX_CODE_ISOLATION_MODE`

#### Isolation backends

| Backend           | Behavior                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **app** (default) | Portable application-layer checks on every tool                                                                                                                   |
| **os**            | App checks **plus** kernel sandbox for bash (macOS Seatbelt via `sandbox-exec`, Linux bubblewrap when `bwrap` is installed). Fails closed if OS tools are missing |
| **auto**          | Prefer OS bash wrap when available; fall back to app-layer only                                                                                                   |

```json
{
  "isolation": {
    "mode": "workspace-write",
    "network": false,
    "backend": "auto"
  }
}
```

Or set `AX_CODE_ISOLATION_BACKEND=os|auto|app`.

OS isolation for bash denies writes outside the workspace roots and denies network when `network: false`. App-layer checks still always run. On platforms without Seatbelt/bubblewrap, use `backend: "app"` or a container/VM.

### Server Security

- **Localhost only by default** — the server binds to `127.0.0.1`, inaccessible from the network
- **Password required for network access** — binding to `0.0.0.0` or any non-localhost address requires `AX_CODE_SERVER_PASSWORD` to be set; the server refuses to start without it
- **Basic auth enforced** — when `AX_CODE_SERVER_PASSWORD` is set, HTTP Basic Auth is required on all API endpoints
- **CORS configurable** — additional allowed origins can be specified via `--cors`

### Credential Storage

Provider API keys are encrypted at rest using AES-256-GCM with PBKDF2 key derivation and stored in the local AX Code data directory (`~/.local/share/ax-code/`) with user-only file permissions (`0600`).

The encryption key is derived from local machine attributes (hostname, platform, architecture). This protects against casual offline disclosure (e.g., accidental file sharing) but does **not** protect against a determined attacker with access to the host. It is not equivalent to OS keychain or hardware-backed secret storage.

MCP OAuth tokens, client secrets, and account access/refresh tokens are also encrypted at rest using the same mechanism. Non-sensitive metadata (server URLs, expiry timestamps, email, account IDs) remains in plaintext.

### Release Artifact Verification

Both the Bash installer (`install`) and the Windows PowerShell installer (`install.ps1`) verify downloaded GitHub release archives with minisign before extraction. Release archives and the PowerShell installer script itself carry detached signatures. The pinned AX Code release public key is:

```text
RWSlDu++afxCz01OqhYWhfo8+L8pVbSYXJBEb2zoWBuK0WACIzbGVZRO
```

Each installer downloads the matching `.minisig` asset for the selected archive and fails closed when verification fails. If `minisign` is not already on PATH, the installers bootstrap a pinned official jedisct1 minisign release (SHA-256 verified into a local tools cache) and use it for signature checks. Set `AX_CODE_SKIP_MINISIGN_VERIFY=1` only when you intentionally accept an unverifiable release download.

The convenience one-liner `irm …/install.ps1 | iex` does not verify the installer script before execution. For security-sensitive installs, download `install.ps1` and `install.ps1.minisig`, verify the script with minisign, then run it locally (see [Installation and Runtime Channels](docs/getting-started/install-runtime.md)).

Maintainers should keep the minisign secret key encrypted. For local release signing on macOS, store the passphrase in Keychain instead of a plaintext file:

```bash
security add-generic-password -U -a ax-release -s ax-minisign -w
```

Release tooling reads that Keychain item automatically when `AX_CODE_MINISIGN_PASSWORD` is not set.

The tag-driven GitHub release workflow signs archives before upload. It requires
these repository secrets:

```text
AX_CODE_MINISIGN_SECRET_KEY_B64
AX_CODE_MINISIGN_PASSWORD
```

`AX_CODE_MINISIGN_SECRET_KEY_B64` must be the base64-encoded contents of the
encrypted `ax.minisign.key` minisign secret key (the local path may be a symlink
to `ax.sec`). The workflow writes it to a
temporary `0600` key file, verifies the pinned public key, signs each release
archive, and uploads the matching `.minisig` assets with the archives.

For macOS CLI archives, the workflow requires and imports the Apple Developer ID
certificate using these repository secrets:

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_TEAM_ID
APPLE_API_KEY_B64
APPLE_API_KEY_ID
APPLE_API_ISSUER
```

In that path, bundled native libraries are signed with the imported Developer
ID Application identity, the macOS ZIP is submitted to Apple's notary service,
and the unchanged ZIP is then protected by the detached minisign signature. ZIP
archives cannot be stapled, so notarization must happen before artifact upload
and before `.minisig` generation. Release builds fail closed when any Apple
signing or notarization credential is missing.

### Release signing key history

| Effective date | Key ID             | Public key                                                 | Status      |
| -------------- | ------------------ | ---------------------------------------------------------- | ----------- |
| 2026-07-19     | `CF42FC69BEEF0EA5` | `RWSlDu++afxCz01OqhYWhfo8+L8pVbSYXJBEb2zoWBuK0WACIzbGVZRO` | **Current** |
| 2026-07-19     | `2D5140E0904E48B3` | `RWSzSE6Q4EBRLeUmabk1YM6bzP/wn54tXE09il3d2srulrCfaB4Uyt1n` | Rotated out |
| 2026-06-16     | `5B7AB63CD6D674BE` | `RWS+dNbWPLZ6W9TH486c9zdH84NiiuFnm4VpVTRlXoMHClyQx/fY7W2A` | Rotated out |
| pre-2026-06-16 | `8138FAD32CAD95BA` | `RWS6la0s0/o4gdFUZ0Bk/BkrnN8qC2CFOfLXVP5OtQTrvm1BQeOvXgao` | Rotated out |

The release signing key was most recently rotated on 2026-07-19. The installer
and release workflow pin only the current key, so archives signed with a retired
key fail signature verification. After a rotation, maintainers must re-sign
historical release archives with `script/resign-release-assets.ts` so every
published release verifies against the pinned key without trusting retired keys.

To re-sign and re-upload an existing release's `.minisig` assets with the
current key:

```bash
tsx script/resign-release-assets.ts --tag v5.5.0 --key-dir ~/signkey
```

---

## Scope

### In Scope

| Category                       | Examples                                                           |
| ------------------------------ | ------------------------------------------------------------------ |
| **Sandbox bypass**             | Executing commands or writing files outside allowed boundaries     |
| **Authentication bypass**      | Circumventing `AX_CODE_SERVER_PASSWORD` in server mode             |
| **Key exfiltration**           | Extracting stored API keys without local machine access            |
| **Path traversal**             | Tools reading/writing outside the intended working directory       |
| **Command injection**          | Crafted input that executes arbitrary commands bypassing isolation |
| **Dependency vulnerabilities** | Known CVEs in bundled dependencies with a viable attack path       |

### Out of Scope

| Category                       | Rationale                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------- |
| **LLM provider data handling** | Data sent to your configured provider is governed by their policies               |
| **MCP server behavior**        | External MCP servers you configure are outside our trust boundary                 |
| **Malicious config files**     | Users control their own config; modifying it requires local access                |
| **Social engineering**         | Prompt injection via untrusted repos is a known LLM-agent limitation              |
| **OS-level sandbox escapes**   | The isolation sandbox operates at the application layer, not the OS process layer |

## Enterprise Security Capabilities

AX Code is designed for enterprise use with the following hardening features:

- **Fine-grained Permissions**: Agent-specific and pattern-based rulesets (`allow`/`deny`/`ask`). Security agent defaults to read-only. Rules evaluated across project, agent, and approved lists.
- **Session Audit Trails**: Every tool call, permission decision, and file change is recorded in SQLite with snapshots. Supports replay, fork, and export for compliance reviews.
- **Deterministic Refactoring (DRE)**: `impact_analyze`, `refactor_plan`, and `refactor_apply` (shadow worktree + lint/typecheck/tests) provide auditable, reversible changes.
- **Credential Management**: AES-256-GCM encryption for all keys/tokens. Per-directory isolation via `InstanceState`.
- **Default Sandbox Enforcement**: Application-level isolation with bash command parsing (tree-sitter). The runtime defaults to `workspace-write` with network disabled; protected paths (`.git`, `.ax-code`) apply in sandboxed modes.
- **Server Hardening**: Localhost-only by default; password-protected remote access with Basic Auth.
- **Code Intelligence & Scanning**: Built-in secret/hardcode detection, dependency impact analysis.

### CodeQL-Assisted Coding Feedback

The repository runs CodeQL as a background security analysis layer for pull
requests, pushes to `dev`, scheduled scans, and manual dispatches. CodeQL is not
part of the live LSP or code-intelligence path; it is a slower, deeper evidence
source for data-flow, taint, and security-quality findings that are better
handled after source changes have stabilized.

The current workflow analyzes:

- JavaScript and TypeScript product, SDK, integration, script, and desktop code.
- GitHub Actions workflows and local composite actions.
- Rust crates under `crates/` with a manual Cargo build so native-addon and TUI
  code is extracted consistently.

The intended developer experience is:

1. PR authors get CodeQL alerts in GitHub code scanning alongside existing
   typecheck, deterministic tests, OSV dependency scanning, and repo-structure
   guards.
2. Maintainers triage initial results before treating CodeQL as a hard merge
   gate, so new findings are useful rather than noisy.
3. Future AX Code review/debug flows can ingest CodeQL SARIF or GitHub code
   scanning alerts as explicit security evidence with provenance fields such as
   `source: "codeql"`, rule id, severity, file, line, data-flow trace, and
   analyzed commit SHA.
4. CodeQL evidence should be shown beside local `security_scan`,
   `hardcode_scan`, LSP diagnostics, and graph-backed impact analysis, not as a
   hidden replacement for any of them.

When adding custom CodeQL queries, prefer repository-specific security
boundaries over broad lint-style checks. High-value targets include sandbox
escape paths, command execution with unsanitized arguments, path traversal
around workspace containment, secret/env propagation to child processes,
missing server route validation, and unsafe Electron IPC bridges.

For full enterprise governance (RBAC, policy-as-code, SIEM export, cryptographic audit), integrate with **AX Trust** (roadmap item).

See [docs/guides/sandbox.md](docs/guides/sandbox.md) for isolation configuration and runtime behavior.
