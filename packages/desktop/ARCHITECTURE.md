# AX Code Desktop Architecture

`packages/desktop` owns the host shell for the AX Code app.

Boundary rules:

- The desktop host starts or attaches to AX Code through `@ax-code/sdk/headless`.
- The AX Code server must remain a sidecar process for the first implementation; do not run it in-process inside
  Electron main.
- Privileged host actions are exposed only through typed bridge commands with schema validation and sender validation.
- The renderer must not receive raw Electron, filesystem, shell, process, or IPC access.
- Browser preview, remote/tunnel, PWA, and VS Code surfaces use separate capability profiles from the trusted local
  desktop app. Only the trusted local app profile exposes desktop bridge commands.

The current beta host uses Electron with a sandboxed renderer, typed preload bridge, sidecar/attach backend lifecycle,
trusted `app://ax-code` packaged content, and loopback-only backend defaults.

Internal maintainer beta setup, packaging, validation, diagnostics, and known limitations are tracked in
[`BETA.md`](./BETA.md).
