# AX Code SDK Surfaces

Status: Active
Scope: current-state
Last reviewed: 2026-09-02
Owner: ax-code sdk

This directory owns the SDK and OpenAPI integration surfaces for AX Code. Use it when you are embedding AX Code into another program; for interactive developer workflows, start from the root README, TUI, CLI, or VS Code integration.

## Surfaces

| Path                           | Role                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| [`js/`](js/README.md)          | First-party TypeScript and JavaScript SDK, including in-process `createAgent()`, headless app helpers, and HTTP clients |
| [`openapi.json`](openapi.json) | OpenAPI snapshot for HTTP clients and generated cross-language integrations                                             |
| [`proto/`](proto/)             | Optional gRPC/native headless contract for first-party desktop GUI integrations                                         |

The first-party JSR package [`@defai-digital/ax-code-sdk`](https://jsr.io/@defai-digital/ax-code-sdk) exists and is
linked to `defai-digital/ax-code` for OIDC; its first version has not been published. Other languages should integrate
through `ax-code serve` and generated clients based on `openapi.json` until a language has an owner, tests, and a
release workflow.

## Integration Choice

| Need                                            | Recommended path                                  |
| ----------------------------------------------- | ------------------------------------------------- |
| TypeScript or JavaScript in the same process    | `js/README.md` and `createAgent()`                |
| First-party desktop/native GUI                  | `@defai-digital/ax-code-sdk/grpc`                 |
| App UI with a local process-isolated AX backend | `@defai-digital/ax-code-sdk/headless`             |
| TypeScript or JavaScript over raw HTTP          | Generate from `openapi.json` with `ax-code serve` |
| Python, Go, Java, Rust, or another runtime      | Generate a client from `openapi.json`             |
| Interactive developer workflow                  | Root README, TUI, CLI, or VS Code integration     |

Keep this page short. Detailed cross-language guidance belongs in `docs/sdk/http-openapi.md`; detailed TypeScript examples belong in `js/README.md`.

## Cross-Language Policy

Use OpenAPI as the compatibility contract for Python, Go, Java, Rust, and other non-JavaScript integrations. Prefer the gRPC/native contract for first-party desktop GUI work where AX Code owns both ends of the transport. Keep generated clients replaceable, pin them to the AX Code version they target, and promote them to first-party packages only when there is sustained demand and an explicit maintenance owner.
