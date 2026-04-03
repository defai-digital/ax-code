# BUG: TUI Thread Directory Resolution Test Fails Due to Mocking Issue

**Date:** 2026-04-03
**Severity:** Low
**Status:** Open (test-only, no runtime impact)

## Symptoms

- Test cases in `packages/ax-code/test/cli/tui/thread.test.ts` fail
- Tests expect temp directory path but receive repo root path
- Bun's `mock.module` does not work with dynamic imports

## Root Cause

Bun's `mock.module` does not intercept dynamic `await import()` calls. The test dynamically imports `TuiThreadCommand` but the mock for `@/project/instance` isn't applied.

## Impact

Test-only issue. No runtime impact — the actual TUI thread works correctly.

## Suggested Fix

Refactor test to use static imports or Bun-compatible mocking approach.

## Files Involved

- `packages/ax-code/test/cli/tui/thread.test.ts`
