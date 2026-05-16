# HTTP and OpenAPI SDKs

Status: Active
Scope: current-state
Last reviewed: 2026-04-28
Owner: ax-code sdk

AX Code has two integration paths:

- Use [`@ax-code/sdk`](../packages/sdk/js/README.md) for first-party TypeScript and JavaScript embedding.
- Use `ax-code serve` plus the OpenAPI contract when another language or process boundary is required.

The HTTP/OpenAPI path is the recommended cross-language integration surface today. It lets Python, Go, Java, Rust, and other clients call the same server API without AX Code committing to maintain a full official package for every language.

## Choose a Path

| Need                                             | Recommended path                                   | Why                                                                                             |
| ------------------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| TypeScript or JavaScript in the same process     | `@ax-code/sdk` with `createAgent()`                | Lowest startup overhead and access to programmatic helpers, custom tools, and testing utilities |
| TypeScript or JavaScript with a service boundary | `@ax-code/sdk/http` or `createAxCodeClient()`      | Keeps typed client ergonomics while using `ax-code serve`                                       |
| Python, Go, Java, Rust, or another runtime       | Generate a client from `packages/sdk/openapi.json` | Reuses the HTTP contract without adding first-party package maintenance for every language      |
| CI, automation, or one-off scripts               | HTTP calls against `ax-code serve`                 | Simple deployment model and easy process isolation                                              |

## What Is Official Today

- `@ax-code/sdk` is the first-party TypeScript and JavaScript SDK.
- `@ax-code/sdk/http` is the first-party TypeScript and JavaScript client for the server path.
- `packages/sdk/openapi.json` is the OpenAPI snapshot for generated HTTP clients.
- Generated non-JavaScript clients are supported as integrations over HTTP, but they are not first-party published packages unless a package owner, tests, and release workflow exist.

## Basic HTTP Flow

Start the server:

```bash
ax-code serve --hostname=127.0.0.1 --port=4096
```

Check server health:

```bash
curl http://127.0.0.1:4096/global/health
```

Create generated clients from the OpenAPI snapshot after validating the snapshot as JSON and OpenAPI:

```bash
openapi-python-client generate --path packages/sdk/openapi.json
```

```bash
oapi-codegen -package axcode -generate types,client packages/sdk/openapi.json > axcode.gen.go
```

```bash
openapi-generator-cli generate -i packages/sdk/openapi.json -g java -o ./ax-code-java
```

## Generation Guardrails

Treat the OpenAPI document as the language-neutral contract. Do not hand-maintain large wrappers around individual routes unless a small ergonomic layer is needed.

Pin the AX Code version and generated client version together. If the server route schema changes, regenerate the client and release it with a clear compatibility note.

Keep generated code separate from handwritten helpers. Generated files should be easy to replace, while handwritten files should hold only authentication, defaults, retries, and higher-level convenience APIs.

Preserve the service-boundary behavior. Non-JavaScript clients use the HTTP server path and do not get in-process `createAgent()`, JavaScript custom tool execution, or `@ax-code/sdk/testing` utilities.

Cover the hard parts before promoting a generated client to first-party status:

1. OpenAPI validation runs in CI.
2. A contract test starts `ax-code serve` and calls representative routes.
3. Streaming or SSE behavior is tested if the client exposes event APIs.
4. Directory scoping headers and authentication behavior are documented.
5. Publishing, versioning, and ownership are explicit.

The SDK package includes a lightweight local guard for the current snapshot:

```bash
pnpm run check:openapi
```

The package-level command is also available when working inside the SDK package:

```bash
pnpm --dir packages/sdk/js run validate:openapi
```

This validates that `packages/sdk/openapi.json` is parseable JSON, declares OpenAPI 3.x, and contains the core routes needed by generated clients.

## Recommended Investment

The high-value path is to make the OpenAPI contract reliable, documented, and easy to generate from before adding official packages for more languages. Promote a Python or Go SDK only after there is concrete user demand and the generated-client workflow has contract tests.
