# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AX Code Desktop, please report it responsibly.

**Email:** [techsupport@defai.digital](mailto:techsupport@defai.digital)

Please include:

- Description of the vulnerability
- Steps to reproduce
- Affected version(s)
- Potential impact

I'll acknowledge receipt within 48 hours and aim to provide a fix or mitigation as quickly as possible.

**Please do not open public GitHub issues for security vulnerabilities.**

## Scope

AX Code Desktop handles sensitive context including:

- UI authentication (password-protected sessions, JWT tokens)
- Loopback-only server and IPC boundaries
- Terminal access (PTY sessions)
- Git credentials and SSH keys
- File system operations

Security reports related to any of these areas are especially appreciated.

AX Code Desktop is local-only. SSH instance access, remote host switching, LAN binding, reverse proxies, and public tunnels are unsupported and disabled at runtime.

## Supported Versions

Security fixes are applied to the latest release. There is no LTS or backport policy at this time.
