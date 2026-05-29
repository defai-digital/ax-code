# AX Code Desktop Architecture

`packages/desktop` owns the host shell for the AX Code app.

Boundary rules:

- The desktop host starts or attaches to AX Code through `@ax-code/sdk/headless`.
- The AX Code server must remain a sidecar process for the first implementation; do not run it in-process inside
  Electron main.
- Privileged host actions are exposed only through typed bridge commands with schema validation and sender validation.
- The renderer must not receive raw Electron, filesystem, shell, process, or IPC access.
- Browser preview, remote/tunnel, PWA, and VS Code surfaces must use separate capability profiles from the trusted local
  desktop app.

The first slice is intentionally a security and lifecycle contract without an Electron runtime dependency. The Electron
adapter can be added after these contracts are validated and the dependency/install slice is explicit.
