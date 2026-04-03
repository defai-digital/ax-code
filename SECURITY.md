# Security Policy

## Reporting a Vulnerability

We take security seriously. If you discover a vulnerability, please report it responsibly:

1. **GitHub Advisory** (preferred): Use the ["Report a Vulnerability"](https://github.com/defai-digital/ax-code/security/advisories/new) tab.
2. **Discord**: Report it in our Discord: https://discord.gg/cTavsMgu

We will acknowledge your report within **6 business days** and keep you informed of progress toward a fix.

> **Note:** We do not accept AI-generated security reports. Submitting one will result in a ban from the project. Please ensure your report includes specific reproduction steps and demonstrates a real impact.
>
> Use Discord for security reports, support, and general discussion: https://discord.gg/cTavsMgu

---

## Threat Model

### Overview

ax-code is an AI-powered coding assistant that runs locally on your machine. It provides an agent system with access to powerful tools including shell execution, file operations, and web access.

### No Sandbox

ax-code does **not** sandbox the agent. The permission system is a UX feature that prompts for confirmation before executing commands, writing files, etc. It is not designed to provide security isolation.

If you need true isolation, run ax-code inside a Docker container or VM.

### Server Mode

Server mode is opt-in. When enabled, set `AX_CODE_SERVER_PASSWORD` to require HTTP Basic Auth. Without this, the server runs unauthenticated (with a warning). Securing the server is the end user's responsibility.

### API Key Storage

API keys are encrypted at rest using AES-256-GCM with a machine-derived key. Keys are stored in the user's config directory and are never sent anywhere other than the configured LLM provider.

---

## Scope

### In Scope

| Category | Examples |
| --- | --- |
| **Remote code execution** | Crafted input that executes arbitrary commands without user confirmation |
| **Authentication bypass** | Circumventing `AX_CODE_SERVER_PASSWORD` in server mode |
| **Key exfiltration** | Extracting stored API keys without local machine access |
| **Path traversal** | Tools reading/writing outside the intended working directory |
| **Dependency vulnerabilities** | Known CVEs in bundled dependencies with a viable attack path |

### Out of Scope

| Category | Rationale |
| --- | --- |
| **Server access when opted-in** | If you enable server mode without a password, open access is expected |
| **Sandbox escapes** | The permission system is not a sandbox (see above) |
| **LLM provider data handling** | Data sent to your configured provider is governed by their policies |
| **MCP server behavior** | External MCP servers you configure are outside our trust boundary |
| **Malicious config files** | Users control their own config; modifying it requires local access |
| **Social engineering** | Prompt injection via untrusted repos is a known LLM-agent limitation |
