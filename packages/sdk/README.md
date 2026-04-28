# AX Code SDK Surfaces

Status: Active
Scope: current-state
Last reviewed: 2026-04-28
Owner: ax-code sdk

This directory owns the SDK and OpenAPI integration surfaces for AX Code.

## Surfaces

| Path | Role |
| --- | --- |
| [`js/`](js/README.md) | First-party TypeScript and JavaScript SDK, including in-process `createAgent()` and HTTP client helpers |
| [`openapi.json`](openapi.json) | OpenAPI snapshot for HTTP clients and generated cross-language integrations |

The first-party package today is `@ax-code/sdk`. Other languages should integrate through `ax-code serve` and generated clients based on `openapi.json` until a language has an owner, tests, and a release workflow.

## Cross-Language Policy

Use OpenAPI as the contract for Python, Go, Java, Rust, and other non-JavaScript integrations. Keep generated clients replaceable, pin them to the AX Code version they target, and promote them to first-party packages only when there is sustained demand and an explicit maintenance owner.
