# Protocol Steps: env

- Slug: `env`
- Lane: `codex-sol`
- Date: `2026-08-11`

## Step 1 Map

The entire unit is the `Env` namespace in `packages/ax-code/src/env/index.ts:3-28`, exposing `get`, `all`, `set`, and `remove`. Its only critical callee is `Instance.state` in `packages/ax-code/src/project/instance.ts:81-260`, which keys the shallow `process.env` snapshot to the active project instance and disposes it with that instance.

## Step 2 Threat model

Environment variables may contain credentials, provider routing, executable paths, and feature flags, so returning or mutating them crosses a process-global secret/configuration boundary (`packages/ax-code/src/env/index.ts:4-24`). The main failure modes are reading from the wrong project context, accidental mutation through the object returned by `all()`, and assuming `Env.set` writes back to `process.env`; the implementation instead mutates only the current instance snapshot.

## Step 3 Correctness

The initial state is a shallow copy via `{ ...process.env }`, so later direct changes to `process.env` do not retroactively affect an already-created project instance (`packages/ax-code/src/env/index.ts:4-8`). `get`, `set`, and `remove` consistently operate on the same instance-owned object (`packages/ax-code/src/env/index.ts:10-27`), but `all()` returns that object by reference, making direct caller mutation equivalent to using the namespace mutators and therefore an important undocumented invariant.

## Step 4 Performance

There is no meaningful hot-path cost beyond a property lookup after the one-time shallow environment copy in `packages/ax-code/src/env/index.ts:4-16`. The copy is O(number of environment keys) per project instance and intentionally avoids repeated process-environment enumeration; no cache eviction or unbounded collection exists in this unit.

## Step 5 Design

The module is cohesive and deliberately thin, delegating directory scoping and lifecycle to `packages/ax-code/src/project/instance.ts` instead of building another context store. Returning a mutable reference from `packages/ax-code/src/env/index.ts:15-17` weakens encapsulation, however, because callers can bypass `set` and `remove`; either documenting this as the intended bulk-mutation contract or returning a readonly/copy view would clarify the boundary.

## Step 6 Dead code/hygiene

No TODO, FIXME, empty catch, unused helper, or unreachable branch appears in `packages/ax-code/src/env/index.ts`. All four exported functions have repository consumers, including provider/config paths found during the call-site search, so none is dead even though the unit lacks its own dedicated test file.

## Step 7 Tests

The audit-listed `packages/ax-code/test/cli/tui/env.test.ts` exercises TUI environment preparation, and `packages/ax-code/test/util/env.test.ts` exercises a separate utility; neither imports `packages/ax-code/src/env/index.ts`. This leaves direct gaps for snapshot isolation between two `Instance.provide` contexts, `set`/`remove` behavior, and the mutability semantics of `all()`, so the inventory’s apparent test association should not be treated as unit coverage.

## Step 8 Findings

`docs/module-quality-audit/modules/env/MODULE-AUDIT.md` registers no accepted finding, and this review did not establish a security or correctness failure. The mutable `all()` surface and absent direct tests are design/test-gap notes rather than findings because current call sites can intentionally share the instance-local map and no caller invariant was shown to be violated.

## Step 9 Verification

I ran `pnpm --dir packages/ax-code run typecheck`, which type-checked `packages/ax-code/src/env/index.ts` and its consumers successfully. A focused verification should add a direct `test/env/index.test.ts` and run it through `AX_TEST_FILES=test/env/index.test.ts pnpm --dir packages/ax-code exec vitest run`; the existing two audit-listed env tests would not prove this namespace’s behavior.
