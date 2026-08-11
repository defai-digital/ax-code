# Nine-step review: desktop-web-magic-prompts

Reviewer: codex-sol  
Verifier lane: ax-code-glm

## Step 1 Scope and Public Surface

The `desktop-web-magic-prompts` unit owns the HTTP adapter, JSON persistence runtime, and its focused runtime test. `desktop/packages/web/server/lib/magic-prompts/routes.js:3-61` registers four operations: read all overrides, set one override, reset one override, and reset all overrides. The runtime returned at `desktop/packages/web/server/lib/magic-prompts/runtime.js:124-129` exposes the corresponding state operations, while `desktop/packages/web/server/lib/magic-prompts/runtime.test.js:8-76` is the only unit-local behavioral suite. Route composition is confirmed outside the unit at `desktop/packages/web/server/lib/ax-code/feature-routes-runtime.js:277-284`, where the desktop data directory and filesystem dependencies are supplied.

## Step 2 Trust Boundaries and Input Validation

User-controlled route parameters and JSON text cross into local persistent state. `desktop/packages/web/server/lib/magic-prompts/routes.js:21-26` rejects a missing or non-string `text`, and `desktop/packages/web/server/lib/magic-prompts/runtime.js:76-89` trims the identifier, enforces a 160-character restricted alphabet, forbids blank `.visible` prompts, and caps prompt text at 200,000 characters. The routes are behind the global `/api` authentication middleware at `desktop/packages/web/server/lib/ax-code/core-routes.js:423-429`, registered before feature routes by `desktop/packages/web/server/index.js:1213-1279`, and the API also receives rate limiting at `desktop/packages/web/server/lib/ax-code/bootstrap-runtime.js:64-67`. The boundary stores prompt content but does not handle credentials, spawn processes, or accept filesystem paths from the request.

## Step 3 State and Control-Flow Correctness

Identifier normalization is applied symmetrically when setting and resetting (`desktop/packages/web/server/lib/magic-prompts/runtime.js:76-80` and `101-105`), and both mutations clone the current `Map` before changing it (`runtime.js:91-98` and `107-117`). Serialization consistently emits `{ version: 1, overrides: object }` at `runtime.js:26-33`. A reliability concern remains: `readMutablePromptState` catches malformed JSON and every non-ENOENT read failure, logs it, and substitutes an empty state (`runtime.js:40-55`). A subsequent successful mutation can therefore replace a corrupt file with a mostly empty one rather than surfacing the damage to the route. The file's incoming `version` is also ignored at `runtime.js:42-48`, so there is no explicit incompatible-version path.

## Step 4 Concurrency and Resource Behavior

Mutation concurrency within the single registered runtime is serialized by the promise chain at `desktop/packages/web/server/lib/magic-prompts/runtime.js:38` and `65-74`; using `then(run, run)` also lets later writes proceed after an earlier rejection. The concurrent-update regression at `desktop/packages/web/server/lib/magic-prompts/runtime.test.js:61-75` confirms two simultaneous sets are preserved. Reads do not join that lock, however, and persistence writes directly to the canonical file with `writeFile` (`runtime.js:58-63`) instead of a temporary-file-plus-rename protocol. A read concurrent with a write or a process interruption can thus encounter partial JSON and be converted to an empty successful response by the broad catch. Per-entry text is bounded, but the regex admits unlimited distinct identifiers (`runtime.js:2-3`, `76-93`), so authenticated repeated writes can grow the state file without a total-size or known-ID bound.

## Step 5 Design and Ownership

Dependency injection keeps the persistence code independently testable: the runtime receives `fsPromises`, `path`, and `filePath` at `desktop/packages/web/server/lib/magic-prompts/runtime.js:35-36`, while the adapter alone chooses `magic-prompts.json` under the application data directory at `desktop/packages/web/server/lib/magic-prompts/routes.js:3-10`. The main ownership mismatch is the identifier contract. The UI has a closed `MagicPromptId` union at `desktop/packages/ui/src/lib/magicPrompts.ts:3-43` and a definition registry beginning at `magicPrompts.ts:61`, but the server accepts any value matching its generic regex at `runtime.js:3` and `78-80`. Sharing or validating against one authoritative catalog would prevent unknown persistent keys and remove the current client/server contract drift.

## Step 6 Failure Handling and Code Hygiene

The adapter consistently translates known validation failures into HTTP 400 and other failures into 500 (`desktop/packages/web/server/lib/magic-prompts/routes.js:28-38` and `41-49`). That classification depends on matching fragments of exception text, so renaming a runtime message can silently change the status code. The read route has a 500 handler at `routes.js:12-18`, but ordinary filesystem and parse failures never reach it because the runtime absorbs them at `desktop/packages/web/server/lib/magic-prompts/runtime.js:49-55`; callers instead receive an empty 200 response. The three candidate files contain no TODO marker or empty catch body, and state conversion is factored through `overridesToMap`, `sanitizeOverrides`, and `serializeState` (`runtime.js:7-33`) rather than duplicated across route handlers.

## Step 7 Behavioral Coverage

The focused suite verifies trimmed identifiers on both set and reset (`desktop/packages/web/server/lib/magic-prompts/runtime.test.js:30-44`), exact on-disk serialization plus readback (`runtime.test.js:46-59`), and two concurrent updates (`runtime.test.js:61-75`). It does not exercise any handler in `desktop/packages/web/server/lib/magic-prompts/routes.js:12-61`, nor the invalid-ID, non-string, empty-visible, or maximum-length branches at `desktop/packages/web/server/lib/magic-prompts/runtime.js:76-89`. Important persistence gaps are malformed JSON, permission/read failure, write failure, reset-all behavior, recovery after a rejected queued write, and a read racing a write. These gaps explain why the resilience concerns in Steps 3 and 4 are not guarded by regression tests.

## Step 8 Findings Disposition

The checked module register says `_none accepted_` at `docs/module-quality-audit/modules/desktop-web-magic-prompts/MODULE-AUDIT.md:54-58`, and there are no files beneath this unit's `findings/` directory. This pass found no Critical security or correctness defect. It records broad read-error recovery, non-atomic persistence, an unbounded unknown-ID namespace, and missing route/failure tests as non-Critical reliability and hardening follow-ups. Because there is no Critical finding to independently confirm, no `protocol/reverify.md` is created.

## Step 9 Verification and Handoff

`pnpm --dir desktop/packages/web exec vitest run server/lib/magic-prompts/runtime.test.js` completed with one file and all three tests passing; the package's test entry is Vitest at `desktop/packages/web/package.json:17-27`. `node --check` also succeeded for `routes.js`, `runtime.js`, and `runtime.test.js`, covering the reviewed JavaScript syntax. The existing audit header still lists the opposite provisional role order at `docs/module-quality-audit/modules/desktop-web-magic-prompts/MODULE-AUDIT.md:11-16`; these protocol artifacts follow the explicit unit assignment of reviewer `codex-sol` and verifier `ax-code-glm`. With nine steps documented and focused verification green, the review is ready for the verifier lane.
