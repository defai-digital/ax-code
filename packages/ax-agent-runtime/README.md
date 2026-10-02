# @ax-code/ax-agent-runtime

Incubation package for the product-neutral agent runtime (see ADR-163).
Phase 1 holds only the turn decision kernel as types and DTOs; decision
functions stay in the ax-code core and golden tables lock their behavior.

The `exports` map in `package.json` is the contract. Anything not listed
there is not importable.

| Subpath    | Exports                 | Stability |
| ---------- | ----------------------- | --------- |
| `.`        | top-level facade        | stable    |
| `host`     | `AgentRuntimeHost` port | stable    |
| `decision` | turn decision DTOs      | evolving  |

## Boundary rules

- Imports are allowlisted: `node:*` builtins and relative paths that stay
  inside `src` only. No core (`@/`, `#db/`, `@tui/`, `packages/ax-code`),
  no bare third-party imports.
- No direct `process.env`, `fs`, `os.homedir()`, or `Date.now()`; go through
  the host port.
- IDs cross the port as plain strings; branded IDs convert in the core glue.
- No executable policy: only the two host functions may be value exports.

Enforced by `script/check-agent-runtime-boundary.ts` (wired into
`check:structure`).
