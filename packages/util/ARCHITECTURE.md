# Util Architecture

## Purpose

`packages/util` contains small shared utilities with minimal dependencies and broad reuse across the repo.

## Modules

- `binary` — sorted-array binary search and insertion (`Binary`)
- `error` — `NamedError` base class and `NamedError.create()` factory for typed, schema-backed errors
- `identifier` — monotonic base62/hex identifiers with ascending and descending sort order (`Identifier`)
- `lazy` — memoizing thunk that retries after synchronous failure
- `module` — Node module resolution helpers, including manifest-based entry resolution (`Module`)
- `slug` — random adjective-noun slug generation (`Slug`)

## Allowed Dependencies

- should remain dependency-light

## Placement

- only add code here if it is generic and reusable across packages
- do not turn this package into a dumping ground for unrelated helpers
- do not re-add helpers that duplicate `packages/ax-code/src/util/*` unless cross-package reuse is proven

## Testing

- unit tests are colocated under `test/` and run with `pnpm --dir packages/util run test`
- `Module` resolution additionally has integration coverage in `packages/ax-code/test/util/module.test.ts`
