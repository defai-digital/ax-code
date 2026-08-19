---
name: api-contract
description: Evolve an HTTP, RPC, or schema contract without silently breaking callers. Use when changing OpenAPI, protobuf, GraphQL, tRPC, or public API types, status codes, or error shapes.
agent: architect
argument-hint: <API change, e.g. "add optional locale to GET /users">
---

Handle the contract change in $ARGUMENTS. Local typecheck is not proof that callers still work.

## Phase 1 - Inventory

- Find the contract source of truth (OpenAPI, proto, GraphQL schema, exported types, generated clients).
- List in-repo consumers: handlers, generated clients, tests, frontend callers. Note versioning (URL, header, package).

## Phase 2 - Classify

- **Additive** (optional field, new endpoint) vs **breaking** (rename, type change, remove, status/error change).
- Can the current client talk to the new server, and the new client talk to the old server?

If the change is breaking and the user did not accept a major version or coordinated deploy, stop and propose an additive path.

## Phase 3 - Implement

- Prefer optional/additive fields. Do not reuse field names for a new meaning.
- Update generated clients and contract tests in the same change when the repo generates them.
- Keep error/status semantics explicit. Do not silently map new failures onto old codes.

## Phase 4 - Verify

- Run contract tests or the smallest suite that exercises the changed endpoint/schema.
- Report: files, additive vs breaking, callers updated, and any remaining out-of-repo clients.

## Constraints

- Do not deploy. Do not guess undocumented production clients.
- Do not claim compatibility from TypeScript compile alone when HTTP/RPC tests exist.
