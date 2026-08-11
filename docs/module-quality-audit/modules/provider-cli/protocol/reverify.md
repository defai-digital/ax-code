# Independent Critical Re-verification: provider-cli

Verifier: ax-code-glm

- Finding: `AUDIT-provider-cli-001`
- Date: `2026-08-11`
- Verdict: `verified-fixed`

## Evidence re-read

The stdin helper creates its drain/error state at `packages/ax-code/src/provider/cli/cli-language-model.ts:87-99`, then attaches `error` and `close` listeners at lines 100-117 before the first `stdin.write(text)` at line 120. An emitted error records the event, clears any pending drain listener, and rejects the blocked write at lines 100-106. The close handler removes the long-lived error listener at lines 107-112, while the comments and catch branch at lines 114-140 deliberately preserve that handler long enough to consume an `EPIPE` emitted after `end()`.

The regression at `packages/ax-code/test/provider/cli/cli-language-model.test.ts:477-510` returns `false` from `write`, schedules an `EPIPE` followed by `close`, expects the model call to reject with code `EPIPE`, and verifies that both error and drain listener counts return to zero. This matches the failure mode and cleanup invariant recorded in `docs/module-quality-audit/modules/provider-cli/findings/AUDIT-provider-cli-001.md:17-30`.

## Independent execution

I ran only the named stdin regression with its file selected through `AX_TEST_FILES`; it passed. I then ran all seven focused `test/provider/cli` files; all 116 tests passed. `pnpm --dir packages/ax-code run typecheck` also passed.

## Verdict

`AUDIT-provider-cli-001` remains verified-fixed. Listener ordering prevents an uncaught EventEmitter error, backpressure converts the broken pipe into the awaited rejection, and close removes the retained listeners.
